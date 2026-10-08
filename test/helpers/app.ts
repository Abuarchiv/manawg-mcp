import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createSessionController } from '../../src/auth.js';
import type { AppConfig } from '../../src/config.js';
import { createManaWgClient } from '../../src/manawg-client.js';
import { buildServer } from '../../src/server.js';

/**
 * A stateful stand-in for the ManaWG app. It enforces what the real app enforces — Origin,
 * the Supabase auth cookie, idempotency keys, optimistic locking, strict request bodies — so
 * tests exercise the real session controller, HTTP client and MCP server end to end.
 */

export const MEMBER_A = '00000000-0000-4000-8000-00000000000a';
export const MEMBER_B = '00000000-0000-4000-8000-00000000000b';
const COOKIE = 'sb-127-auth-token';

export type Seen = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  idempotencyKey?: string;
};

type Json = Record<string, unknown>;
type Shopping = {
  id: string;
  name: string;
  bought: boolean;
  boughtAt: string | null;
  updatedAt: string;
};
type Chore = { id: string; title: string; nextDueAt: string; assignedMemberId: string | null };
type Expense = { id: string; amountCents: number; description: string; splits: Json[] };

export type StubApp = {
  origin: string;
  seen: Seen[];
  /** Number of Supabase token requests (sign-ins and refreshes). */
  tokenCalls: () => number;
  /** The next WG request answers 401 as if the session had been revoked. */
  revokeSession: () => void;
  /** Answer the next `count` WG requests with this status before behaving normally. */
  failNext: (count: number, status: number, headers?: Record<string, string>) => void;
  /** Make the app unreachable (connection refused) for subsequent requests. */
  goOffline: () => Promise<void>;
  state: { shopping: Shopping[]; chores: Chore[]; expenses: Expense[]; reactions: string[] };
  close: () => Promise<void>;
};

function reply(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, code: string, extra: Json = {}) {
  reply(res, status, { error: code, code, ...extra });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function hasOnly(value: unknown, keys: string[]): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function sessionToken(header: string | undefined): string | undefined {
  const part = header?.split('; ').find((entry) => entry.startsWith(`${COOKIE}=`));
  const value = part?.slice(COOKIE.length + 1);
  if (!value?.startsWith('base64-')) {
    return undefined;
  }
  const session = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as Json;
  return typeof session.access_token === 'string' ? session.access_token : undefined;
}

export async function startStubApp(): Promise<StubApp> {
  const state: StubApp['state'] = { shopping: [], chores: [], expenses: [], reactions: [] };
  const seen: Seen[] = [];
  let tokens = 0;
  let revoke = false;
  let pendingFailures: Array<{ status: number; headers: Record<string, string> }> = [];
  let idCounter = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;
  let origin = '';

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/auth/v1/token') {
      tokens += 1;
      reply(res, 200, {
        access_token: `token-${tokens}`,
        refresh_token: `refresh-${tokens}`,
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'user-1' },
      });
      return;
    }

    const body = await readJson(req);
    const method = req.method ?? 'GET';
    const idempotencyKey = req.headers['idempotency-key'];
    seen.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
    });

    const injected = pendingFailures.shift();
    if (injected) {
      res.writeHead(injected.status, { 'content-type': 'application/json', ...injected.headers });
      res.end(JSON.stringify({ error: 'injected', secret: 'do-not-leak' }));
      return;
    }
    if (req.headers.origin !== origin) {
      return fail(res, 403, 'cross_origin_blocked');
    }
    if (!sessionToken(req.headers.cookie) || revoke) {
      revoke = false;
      return fail(res, 401, 'auth_required');
    }
    if (method !== 'GET' && typeof idempotencyKey !== 'string') {
      return fail(res, 400, 'idempotency_key_required');
    }
    route(method, url, body, res);
  });

  function route(method: string, url: URL, body: unknown, res: ServerResponse) {
    const path = url.pathname.replace(/^\/api\/wg\/?/, '');
    const parts = path.split('/').filter(Boolean);
    const input = (body ?? {}) as Json;

    // Account routes (no WG code).
    if (method === 'POST' && parts.length === 0) {
      return reply(res, 201, { wg: { id: 'w2', shareCode: 'NEWCODE1', name: input.name } });
    }
    if (parts[0] === 'mine') {
      return reply(res, 200, {
        wgs: [{ id: 'w1', memberId: MEMBER_A, name: 'WG', code: 'WG123' }],
      });
    }
    if (parts[0] !== 'WG123') {
      return fail(res, 404, 'wg_not_found');
    }
    const [, resource, id, action] = parts;
    const now = new Date().toISOString();

    if (!resource) {
      return reply(res, 200, {
        wg: { name: 'WG', shareCode: 'WG123' },
        members: [{ id: MEMBER_A }, { id: MEMBER_B }],
        currentMember: { memberId: MEMBER_A, name: 'Ada' },
      });
    }

    if (resource === 'dashboard') {
      return reply(res, 200, { openShoppingCount: state.shopping.filter((i) => !i.bought).length });
    }

    if (resource === 'shopping') {
      if (method === 'GET') return reply(res, 200, { items: state.shopping });
      if (method === 'POST') {
        if (state.shopping.some((i) => !i.bought && i.name === input.name)) {
          return fail(res, 409, 'shopping_item_duplicate');
        }
        const item = {
          id: nextId(),
          name: String(input.name),
          bought: false,
          boughtAt: null,
          updatedAt: now,
        };
        state.shopping.push(item);
        return reply(res, 201, { item });
      }
      const item = state.shopping.find((i) => i.id === id);
      if (!item) return fail(res, 404, 'item_not_found');
      if (method === 'PATCH') {
        if (
          input.expectedUpdatedAt !== item.updatedAt ||
          input.expectedBoughtAt !== item.boughtAt
        ) {
          return fail(res, 409, 'shopping_item_changed');
        }
        item.bought = Boolean(input.bought);
        item.boughtAt = item.bought ? now : null;
        item.updatedAt = new Date(Date.parse(item.updatedAt) + 1000).toISOString();
        return reply(res, 200, { item });
      }
    }

    if (resource === 'chores') {
      if (method === 'GET' && !id) return reply(res, 200, { chores: state.chores });
      if (method === 'POST' && !id) {
        const chore = {
          id: nextId(),
          title: String(input.title),
          nextDueAt: String(input.nextDueAt ?? now),
          assignedMemberId: (input.assignedMemberId as string | null | undefined) ?? null,
        };
        state.chores.push(chore);
        return reply(res, 201, { chore });
      }
      const chore = state.chores.find((c) => c.id === id);
      if (!chore) return fail(res, 404, 'chore_not_found');
      if (method === 'POST' && action === 'complete') {
        if (
          input.expectedNextDueAt !== chore.nextDueAt ||
          input.expectedAssignedMemberId !== chore.assignedMemberId
        ) {
          return fail(res, 409, 'chore_occurrence_changed');
        }
        chore.nextDueAt = new Date(Date.parse(chore.nextDueAt) + 7 * 86_400_000).toISOString();
        return reply(res, 200, { chore });
      }
    }

    if (resource === 'expenses') {
      if (method === 'GET' && !id)
        return reply(res, 200, { expenses: state.expenses, payments: [] });
      if (method === 'POST' && !id) {
        const splits = (input.splits as Json[] | undefined) ?? [];
        const total = splits.reduce((sum, split) => sum + Number(split.amountCents), 0);
        if (total !== input.amountCents) return fail(res, 400, 'splits_sum_mismatch');
        const expense = {
          id: nextId(),
          amountCents: Number(input.amountCents),
          description: String(input.description),
          splits: splits.map((split) => ({ id: nextId(), ...split })),
        };
        state.expenses.push(expense);
        return reply(res, 201, { expense });
      }
      if (id === 'settle-batch') {
        const open = state.expenses.flatMap((expense) => expense.splits);
        const total = open.reduce((sum, split) => sum + Number(split.amountCents), 0);
        if (method === 'GET') {
          return reply(res, 200, {
            currency: 'EUR',
            netCents: total,
            settleableCents: total,
            remainingCents: 0,
            splits: open.map((split) => ({
              id: split.id,
              expenseId: 'e',
              amountCents: split.amountCents,
            })),
          });
        }
        // The real route validates `expected` with a strict schema: unknown keys are a 400.
        const expected = input.expected;
        if (
          !hasOnly(expected, ['currency', 'netCents', 'settleableCents', 'splits']) ||
          !((expected as Json).splits as Json[]).every((split) =>
            hasOnly(split, ['id', 'amountCents']),
          )
        ) {
          return fail(res, 400, 'settlement_review_invalid');
        }
        for (const split of open) split.settled = true;
        return reply(res, 200, { settled: open.length });
      }
    }

    if (resource === 'chat' && id === 'messages') {
      const message = parts[3];
      if (method === 'POST' && !message) return reply(res, 201, { message: { id: nextId() } });
      if (parts[4] === 'reactions') {
        const emoji =
          method === 'POST' ? String(input.emoji) : (url.searchParams.get('emoji') ?? '');
        if (method === 'POST') state.reactions.push(emoji);
        if (method === 'DELETE') state.reactions = state.reactions.filter((r) => r !== emoji);
        return reply(res, 200, { ok: true });
      }
      if (method === 'DELETE') return reply(res, 200, { deleted: true });
    }

    if (resource === 'export' && url.searchParams.get('format') === 'csv') {
      return reply(res, 200, 'id,description\n1,Pizza\n', 'text/csv; charset=utf-8');
    }
    if (method === 'GET') {
      // Remaining collections the resources read: empty but valid.
      return reply(res, 200, { items: [] });
    }
    return fail(res, 404, 'not_found');
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let online = true;

  return {
    origin,
    seen,
    state,
    tokenCalls: () => tokens,
    revokeSession: () => {
      revoke = true;
    },
    failNext: (count, status, headers = {}) => {
      pendingFailures = Array.from({ length: count }, () => ({ status, headers }));
    },
    goOffline: async () => {
      online = false;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    close: async () => {
      if (online) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}

export type Harness = {
  app: StubApp;
  client: Client;
  /** Call a tool and return its parsed structured result; throws on tool errors. */
  call: (name: string, args?: Record<string, unknown>) => Promise<Json>;
  /** Call a tool expected to fail and return the error text. */
  callError: (name: string, args?: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
};

export async function startHarness(
  options: { allowDestructive?: boolean; retryDelaysMs?: number[] } = {},
): Promise<Harness> {
  const app = await startStubApp();
  const cache = join(tmpdir(), `manawg-flow-${randomUUID()}.json`);
  const config: AppConfig = {
    baseUrl: app.origin,
    origin: app.origin,
    wgCode: 'WG123',
    timeoutMs: 5_000,
    auth: {
      url: app.origin,
      publishableKey: 'sb_publishable_test',
      email: 'ada@example.test',
      password: 'pw',
      sessionCachePath: cache,
    },
    allowDestructive: options.allowDestructive ?? false,
    transport: 'stdio',
    http: { host: '127.0.0.1', port: 0, path: '/mcp', cors: false, drainMs: 0 },
  };
  const auth = createSessionController(config.auth);
  const manaWg = createManaWgClient(config, fetch, auth, {
    retryDelaysMs: options.retryDelaysMs ?? [1, 1],
  });
  const server = buildServer(manaWg, { allowDestructive: config.allowDestructive });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'flows', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const textOf = (result: { content?: unknown }) =>
    (result.content as Array<{ text: string }>)[0]?.text ?? '';

  return {
    app,
    client,
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        throw new Error(`${name} failed: ${textOf(result)}`);
      }
      return (result.structuredContent ?? {}) as Json;
    },
    callError: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      if (!result.isError) {
        throw new Error(`${name} unexpectedly succeeded`);
      }
      return textOf(result);
    },
    close: async () => {
      await client.close();
      await server.close();
      await app.close();
      rmSync(cache, { force: true });
    },
  };
}
