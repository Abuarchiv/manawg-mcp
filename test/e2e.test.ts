import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createSessionController } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';
import { createManaWgClient } from '../src/manawg-client.js';
import { buildServer } from '../src/server.js';

// Real session controller + real HTTP client + real MCP server against a local stub that
// enforces what the ManaWG app enforces: Origin, the Supabase auth cookie and idempotency keys.

const COOKIE = 'sb-127-auth-token';
const MEMBER = '00000000-0000-4000-8000-0000000000aa';
const CHORE = '00000000-0000-4000-8000-0000000000bb';

type Seen = { method: string; url: string; body: unknown; idempotencyKey?: string };

let origin = '';
let stub: ReturnType<typeof createServer>;
let tokenCalls = 0;
let revokeNext = false;
let seen: Seen[] = [];
let cache = '';
const closers: Array<() => Promise<void> | void> = [];

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

function sessionFromCookie(header: string | undefined): { access_token?: string } | undefined {
  const match = header?.split('; ').find((part) => part.startsWith(`${COOKIE}=`));
  if (!match) {
    return undefined;
  }
  const value = match.slice(COOKIE.length + 1);
  if (!value.startsWith('base64-')) {
    return undefined;
  }
  return JSON.parse(Buffer.from(value.slice('base64-'.length), 'base64url').toString('utf8'));
}

beforeEach(async () => {
  tokenCalls = 0;
  revokeNext = false;
  seen = [];
  cache = join(tmpdir(), `manawg-e2e-${randomUUID()}.json`);
  stub = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/auth/v1/token') {
      tokenCalls += 1;
      send(res, 200, {
        access_token: `token-${tokenCalls}`,
        refresh_token: `refresh-${tokenCalls}`,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'u1' },
      });
      return;
    }
    const body = await readBody(req);
    seen.push({
      method: req.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      body,
      ...(req.headers['idempotency-key']
        ? { idempotencyKey: String(req.headers['idempotency-key']) }
        : {}),
    });

    if (req.headers.origin !== origin) {
      send(res, 403, { error: 'cross_origin_blocked' });
      return;
    }
    const session = sessionFromCookie(req.headers.cookie);
    if (!session?.access_token || revokeNext) {
      revokeNext = false;
      send(res, 401, { error: 'auth_required', code: 'auth_required' });
      return;
    }
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (method === 'POST' && path === '/api/wg') {
      send(res, 201, {
        wg: { id: 'w2', shareCode: 'NEWCODE1', name: 'Neu' },
        creator: { id: 'm' },
      });
    } else if (path === '/api/wg/mine') {
      send(res, 200, { wgs: [{ id: 'w1', memberId: MEMBER, name: 'WG', code: 'WG123' }] });
    } else if (path === '/api/wg/WG123/dashboard') {
      send(res, 200, { openShoppingCount: 2, balances: [] });
    } else if (path === '/api/wg/WG123/export' && url.searchParams.get('format') === 'csv') {
      send(res, 200, 'id,name\n1,Anna\n', 'text/csv; charset=utf-8');
    } else if (method === 'POST' && path === '/api/wg/WG123/expenses') {
      send(res, req.headers['idempotency-key'] ? 201 : 400, { expense: { id: 'e1' } });
    } else if (method === 'PATCH' && path === `/api/wg/WG123/chores/${CHORE}`) {
      send(res, 409, { error: 'chore_changed', code: 'chore_changed', secret: 'do-not-leak' });
    } else if (method === 'DELETE' && path.endsWith('/reactions')) {
      send(res, 200, { ok: true });
    } else {
      send(res, 404, { error: 'not_found' });
    }
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  closers.push(
    () => new Promise<void>((resolve) => stub.close(() => resolve())),
    () => rmSync(cache, { force: true }),
  );
});

afterEach(async () => {
  while (closers.length > 0) {
    await closers.pop()?.();
  }
});

async function connect(allowDestructive = true) {
  const config: AppConfig = {
    baseUrl: origin,
    origin,
    wgCode: 'WG123',
    timeoutMs: 5_000,
    auth: {
      url: origin,
      publishableKey: 'sb_publishable_test',
      email: 'ada@example.test',
      password: 'pw',
      sessionCachePath: cache,
    },
    allowDestructive,
    transport: 'stdio',
    http: { host: '127.0.0.1', port: 0, path: '/mcp', cors: false, drainMs: 0 },
  };
  const auth = createSessionController(config.auth);
  const server = buildServer(createManaWgClient(config, fetch, auth), { allowDestructive });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  closers.push(() => client.close());
  closers.push(() => server.close());
  return client;
}

it('signs in once and serves tools and resources through the session cookie', async () => {
  const client = await connect();

  const dashboard = await client.callTool({ name: 'dashboard_get', arguments: {} });
  expect(dashboard.isError).toBeFalsy();
  expect(dashboard.structuredContent).toEqual({ openShoppingCount: 2, balances: [] });

  const resource = await client.readResource({ uri: 'manawg://current/dashboard' });
  expect(JSON.parse((resource.contents[0] as { text: string }).text)).toEqual({
    openShoppingCount: 2,
    balances: [],
  });

  expect(tokenCalls).toBe(1);
  expect(seen.every((entry) => !entry.url.includes('identity'))).toBe(true);
});

it('reaches account routes and creates a WG on /api/wg', async () => {
  const client = await connect();

  const mine = await client.callTool({ name: 'wg_list', arguments: {} });
  expect(mine.structuredContent).toMatchObject({ wgs: [{ code: 'WG123' }] });

  const created = await client.callTool({
    name: 'wg_create',
    arguments: { name: 'Neu', creatorName: 'Ada' },
  });
  expect(created.isError).toBeFalsy();
  expect(seen.at(-1)).toMatchObject({ method: 'POST', url: '/api/wg' });
});

it('sends an idempotency key on writes', async () => {
  const client = await connect();

  const result = await client.callTool({
    name: 'expense_create',
    arguments: {
      amountCents: 1000,
      description: 'Pizza',
      splits: [{ debtorMemberId: MEMBER, amountCents: 1000 }],
    },
  });

  expect(result.isError).toBeFalsy();
  expect(seen.at(-1)?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

it('returns the CSV export as text', async () => {
  const client = await connect();

  const result = await client.callTool({
    name: 'export_get',
    arguments: { format: 'csv', section: 'expenses' },
  });

  expect(result.structuredContent).toEqual({
    contentType: 'text/csv; charset=utf-8',
    content: 'id,name\n1,Anna\n',
  });
});

it('signs in again after a revoked session and retries the call once', async () => {
  const client = await connect();
  await client.callTool({ name: 'dashboard_get', arguments: {} });
  revokeNext = true;

  const result = await client.callTool({ name: 'dashboard_get', arguments: {} });

  expect(result.isError).toBeFalsy();
  expect(tokenCalls).toBe(2);
});

it('surfaces upstream conflicts as an allowlisted code without leaking the body', async () => {
  const client = await connect();

  const result = await client.callTool({
    name: 'chore_update',
    arguments: { id: CHORE, intervalDays: 3 },
  });

  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain('chore_changed');
  expect(JSON.stringify(result.content)).not.toContain('do-not-leak');
});

it('removes a chat reaction through DELETE with the emoji query', async () => {
  const client = await connect();

  const result = await client.callTool({
    name: 'chat_unreact',
    arguments: { id: CHORE, emoji: '👍' },
  });

  expect(result.isError).toBeFalsy();
  expect(seen.at(-1)).toMatchObject({
    method: 'DELETE',
    url: `/api/wg/WG123/chat/messages/${CHORE}/reactions?emoji=${encodeURIComponent('👍')}`,
  });
});
