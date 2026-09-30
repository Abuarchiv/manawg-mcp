import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionController } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';
import { ManaWgError, type WgRequest, createManaWgClient } from '../src/manawg-client.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validConfig: AppConfig = {
  baseUrl: 'https://example.test',
  origin: 'https://example.test',
  wgCode: 'WG123',
  memberId: '00000000-0000-4000-8000-000000000001',
  memberToken: 'a'.repeat(64),
  timeoutMs: 10_000,
  auth: {
    url: 'https://project.supabase.co',
    publishableKey: 'sb_publishable_key_abc',
    email: 'member@example.test',
    password: 'correct horse battery',
    sessionCachePath: '/tmp/manawg-mcp-test-session.json',
  },
  identityCachePath: '/tmp/manawg-mcp-test-identity.json',
  allowDestructive: false,
  transport: 'stdio',
  http: { host: '127.0.0.1', port: 8080, path: '/mcp', cors: false, drainMs: 5000 },
};

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeAuth(overrides: Partial<SessionController> = {}): SessionController {
  return {
    cookieHeader: vi.fn().mockResolvedValue('sb-project-auth-token=cookie-value'),
    ingest: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(),
    ...overrides,
  };
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ManaWgError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('Expected promise to reject');
}

it('sends member headers, origin and reads dashboard JSON', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(validConfig, fetchMock);

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });

  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.test/api/wg/WG123/dashboard',
    expect.objectContaining({ headers: expect.any(Headers), signal: expect.any(AbortSignal) }),
  );

  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(validConfig.memberId);
  expect(headers.get('x-manawg-member-token')).toBe(validConfig.memberToken);
  expect(headers.get('origin')).toBe(validConfig.origin);
  expect(headers.get('cookie')).toBeNull();
});

it('url-encodes the WG code and path segments', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
  const client = createManaWgClient({ ...validConfig, wgCode: 'WG 1/2' }, fetchMock);

  await client.call({ path: ['chores', 'chore/1', 'complete'], method: 'POST', body: {} });

  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://example.test/api/wg/WG%201%2F2/chores/chore%2F1/complete',
  );
});

it('serializes query parameters and drops empty ones', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ events: [] }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.call({
    path: ['events'],
    query: { from: '2026-09-01', to: undefined, limit: 25, empty: '' },
  });

  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://example.test/api/wg/WG123/events?from=2026-09-01&limit=25',
  );
});

it('forwards the session cookie and ingests rotated cookies', async () => {
  const auth = fakeAuth();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }));
  const client = createManaWgClient(validConfig, fetchMock, auth);

  await client.call({ path: ['shopping'] });

  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get('cookie')).toBe('sb-project-auth-token=cookie-value');
  expect(auth.ingest).toHaveBeenCalledTimes(1);
});

it('rejects redirects before member headers can reach another origin', async () => {
  let targetHeaders: IncomingMessage['headers'] | undefined;
  const targetBaseUrl = await listen((request, response) => {
    targetHeaders = request.headers;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ openShopping: [] }));
  });
  const sourceBaseUrl = await listen((_request, response) => {
    response.statusCode = 302;
    response.setHeader('location', `${targetBaseUrl}/capture`);
    response.end();
  });

  const client = createManaWgClient(
    { ...validConfig, baseUrl: sourceBaseUrl },
    undefined,
    undefined,
    {
      retryDelaysMs: [1, 1],
    },
  );

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('upstream_network_error');
  expect(targetHeaders).toBeUndefined();
});

it('sends POST JSON with an idempotency key', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ item: { id: '1' } }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.call({
    path: ['shopping'],
    method: 'POST',
    body: { name: 'Milch', quantity: '2' },
  });

  const options = fetchMock.mock.calls[0]?.[1];
  if (!options) {
    throw new Error('Expected a fetch call');
  }
  const headers = options.headers as Headers;
  expect(options.method).toBe('POST');
  expect(options.body).toBe(JSON.stringify({ name: 'Milch', quantity: '2' }));
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('idempotency-key')).toMatch(UUID_PATTERN);
});

it('sends DELETE bodies so routes can read optional payloads', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ deleted: 1 }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.call({ path: ['shopping'], method: 'DELETE' });

  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{}');
});

it('never attaches an idempotency key to GET requests', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.call({ path: ['shopping'] });

  expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('idempotency-key')).toBeNull();
});

it.each([502, 503, 504])(
  'retries one transient write for HTTP %i with the same key',
  async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, status))
      .mockResolvedValueOnce(jsonResponse({ item: { id: '1' } }));
    const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

    await client.call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(firstHeaders.get('idempotency-key')).toBe(secondHeaders.get('idempotency-key'));
  },
);

it('retries reads on a transient status and fails after the attempts', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('internal_error');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('retries a read after a network failure and then succeeds', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('socket hang up'))
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  [400, 'name_invalid'],
  [400, 'expected_occurrence_invalid'],
  [400, 'expected_state_invalid'],
  [401, 'member_id_invalid'],
  [403, 'member_not_verified'],
  [404, 'wg_not_found'],
  [409, 'shopping_item_duplicate'],
  [409, 'chore_occurrence_changed'],
  [409, 'shopping_item_changed'],
] as const)('does not retry HTTP %i writes and returns the safe code', async (status, code) => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ error: `secret:${validConfig.memberToken}`, code }, status));
  const client = createManaWgClient(validConfig, fetchMock);

  const thrown = await client
    .call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } })
    .then(() => undefined)
    .catch((error: unknown) => error);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(thrown).toBeInstanceOf(ManaWgError);
  expect((thrown as ManaWgError).code).toBe(code);
  expect(String((thrown as ManaWgError).message)).not.toContain(validConfig.memberToken);
});

it('retries a rate-limited write with the same key and surfaces the safe code', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ code: 'too_many_requests' }, 429));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const thrown = await client
    .call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } })
    .then(() => undefined)
    .catch((error: unknown) => error);

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect((thrown as ManaWgError).code).toBe('too_many_requests');
  const keys = fetchMock.mock.calls.map((call) =>
    (call[1]?.headers as Headers).get('idempotency-key'),
  );
  expect(new Set(keys).size).toBe(1);
});

it('falls back to the HTTP status when the upstream error has no stable code', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ error: `secret:${validConfig.memberToken}` }, 500));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('internal_error');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('falls back to the HTTP status when the upstream code is unknown or secret-bearing', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      jsonResponse({ error: 'conflict', code: `secret:${validConfig.memberToken}` }, 409),
    );
  const client = createManaWgClient(validConfig, fetchMock);

  const code = await errorCode(
    client.call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } }),
  );

  expect(code).toBe('upstream_http_409');
  expect(code).not.toContain(validConfig.memberToken);
});

it('keeps retry-after seconds from rate limits', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      jsonResponse({ error: 'slow down', code: 'too_many_requests' }, 429, { 'retry-after': '17' }),
    );
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const thrown = await client
    .call({ path: ['dashboard'] })
    .then(() => undefined)
    .catch((error: unknown) => error);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(thrown).toBeInstanceOf(ManaWgError);
  expect((thrown as ManaWgError).retryAfterSeconds).toBe(17);
  expect((thrown as ManaWgError).details).toBeUndefined();
});

it('forwards validation details without leaking unrelated fields', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse(
      {
        error: 'validation failed',
        code: 'validation_errors',
        details: { errors: [{ path: 'name', message: 'too short' }] },
      },
      400,
    ),
  );
  const client = createManaWgClient(validConfig, fetchMock);

  const thrown = await client
    .call({ path: ['shopping'], method: 'POST', body: {} })
    .then(() => undefined)
    .catch((error: unknown) => error);

  expect((thrown as ManaWgError).details).toContain('too short');
});

it('sanitizes response body read failures', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: false,
    status: 500,
    json: vi.fn().mockRejectedValue(new Error(`secret:${validConfig.memberToken}`)),
    clone() {
      return this;
    },
  } as unknown as Response);
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('internal_error');
});

it('sanitizes thrown transport errors', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error(`network:${validConfig.memberToken}`));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const code = await errorCode(client.call({ path: ['dashboard'] }));

  expect(code).toBe('upstream_network_error');
  expect(code).not.toContain(validConfig.memberToken);
});

it('retries once on an auth-required 401 with a fresh cookie', async () => {
  const auth = fakeAuth();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ error: 'please sign in', code: 'auth_required' }, 401))
    .mockResolvedValueOnce(jsonResponse({ items: [] }));
  const client = createManaWgClient(validConfig, fetchMock, auth);

  await expect(client.call({ path: ['shopping'] })).resolves.toEqual({ items: [] });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(auth.invalidate).toHaveBeenCalledTimes(1);
  expect(auth.cookieHeader).toHaveBeenCalledTimes(2);
});

it('does not loop beyond one retry when the app keeps rejecting the session', async () => {
  const auth = fakeAuth();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ error: 'nope', code: 'auth_required' }, 401));
  const client = createManaWgClient(validConfig, fetchMock, auth);

  expect(await errorCode(client.call({ path: ['shopping'] }))).toBe('auth_required');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(auth.invalidate).toHaveBeenCalledTimes(1);
});

it('keeps identity errors like member_id_invalid on a single request', async () => {
  const auth = fakeAuth();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ error: 'bad', code: 'member_id_invalid' }, 401));
  const client = createManaWgClient(validConfig, fetchMock, auth);

  expect(await errorCode(client.call({ path: ['shopping'] }))).toBe('member_id_invalid');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(auth.invalidate).not.toHaveBeenCalled();
});

it('builds requests for every registered write method', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
  const client = createManaWgClient(validConfig, fetchMock);

  const requests: WgRequest[] = [
    { path: ['shopping'] },
    { path: ['shopping', '1'], method: 'PATCH', body: { bought: true } },
    { path: ['shopping', '1'], method: 'DELETE' },
    { path: ['expenses'], method: 'POST', body: { amountCents: 100 } },
  ];
  for (const request of requests) {
    await client.call(request);
  }

  expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
    'GET',
    'PATCH',
    'DELETE',
    'POST',
  ]);
});

function bootstrapConfig(): { config: AppConfig; identityPath: string } {
  const identityPath = join(tmpdir(), `manawg-mcp-identity-${randomUUID()}.json`);
  cleanup.push(async () => {
    rmSync(identityPath, { force: true });
  });
  const { memberId: _memberId, memberToken: _memberToken, ...rest } = validConfig;
  return { config: { ...rest, identityCachePath: identityPath }, identityPath };
}

const BOOTSTRAP_MEMBER_ID = '00000000-0000-4000-8000-000000000007';
const BOOTSTRAP_MEMBER_TOKEN = 'b'.repeat(64);

it('bootstraps the member identity from the WG root when it is not configured', async () => {
  const { config, identityPath } = bootstrapConfig();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse({
        currentMember: { memberId: BOOTSTRAP_MEMBER_ID, memberToken: BOOTSTRAP_MEMBER_TOKEN },
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(config, fetchMock);

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/api/wg/WG123');
  const bootstrapHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(bootstrapHeaders.get('x-manawg-member-id')).toBeNull();
  expect(bootstrapHeaders.get('origin')).toBe(config.origin);

  const headers = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(BOOTSTRAP_MEMBER_ID);
  expect(headers.get('x-manawg-member-token')).toBe(BOOTSTRAP_MEMBER_TOKEN);

  expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual({
    memberId: BOOTSTRAP_MEMBER_ID,
    memberToken: BOOTSTRAP_MEMBER_TOKEN,
  });
  expect(statSync(identityPath).mode & 0o777).toBe(0o600);
});

it('reuses a cached member identity without a second bootstrap', async () => {
  const { config, identityPath } = bootstrapConfig();
  writeFileSync(
    identityPath,
    JSON.stringify({ memberId: BOOTSTRAP_MEMBER_ID, memberToken: BOOTSTRAP_MEMBER_TOKEN }),
  );
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(config, fetchMock);

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(BOOTSTRAP_MEMBER_ID);
});

it('sends the member id without a token when the WG root returns no member token', async () => {
  const { config, identityPath } = bootstrapConfig();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ currentMember: { memberId: BOOTSTRAP_MEMBER_ID } }))
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(config, fetchMock);

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const headers = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(BOOTSTRAP_MEMBER_ID);
  expect(headers.get('x-manawg-member-token')).toBeNull();
  expect(headers.get('origin')).toBe(config.origin);
  expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual({
    memberId: BOOTSTRAP_MEMBER_ID,
  });
});

it('keeps calling through a transient bootstrap failure and retries it next call', async () => {
  const { config } = bootstrapConfig();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('flaky'))
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }))
    .mockResolvedValueOnce(
      jsonResponse({
        currentMember: { memberId: BOOTSTRAP_MEMBER_ID, memberToken: BOOTSTRAP_MEMBER_TOKEN },
      }),
    )
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(config, fetchMock, undefined, { retryDelaysMs: [] });

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });
  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });

  expect(fetchMock).toHaveBeenCalledTimes(4);
  const headers = fetchMock.mock.calls[3]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(BOOTSTRAP_MEMBER_ID);
});

it('settles on a tokenless identity so later calls skip the bootstrap', async () => {
  const { config } = bootstrapConfig();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ currentMember: { memberId: BOOTSTRAP_MEMBER_ID } }));
  const client = createManaWgClient(config, fetchMock);

  await client.call({ path: ['dashboard'] });
  await client.call({ path: ['shopping'] });

  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('addresses account routes without the WG code and skips identity bootstrap', async () => {
  const { config } = bootstrapConfig();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ wgs: [] }));
  const client = createManaWgClient(config, fetchMock);

  await expect(client.call({ path: ['mine'], scope: 'account' })).resolves.toEqual({ wgs: [] });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/api/wg/mine');
  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBeNull();
  expect(headers.get('origin')).toBe(config.origin);
});

it('still sends the member headers on WG-scoped requests after an account call', async () => {
  const { config } = bootstrapConfig();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ wgs: [] }))
    .mockResolvedValueOnce(jsonResponse({ currentMember: { memberId: BOOTSTRAP_MEMBER_ID } }))
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(config, fetchMock);

  await client.call({ path: ['mine'], scope: 'account' });
  await client.call({ path: ['dashboard'] });

  expect(fetchMock.mock.calls[2]?.[0]).toBe('https://example.test/api/wg/WG123/dashboard');
  const headers = fetchMock.mock.calls[2]?.[1]?.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(BOOTSTRAP_MEMBER_ID);
});

it('waits out a short rate limit and succeeds on the next attempt', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ code: 'too_many_requests' }, 429, { 'retry-after': '0' }))
    .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('maps a failing session sign-in to the safe auth_failed code', async () => {
  const auth = {
    cookieHeader: vi.fn().mockRejectedValue(new Error('auth_failed')),
    ingest: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(),
  };
  const fetchMock = vi.fn<typeof fetch>();
  const client = createManaWgClient(validConfig, fetchMock, auth);

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('auth_failed');
  expect(fetchMock).not.toHaveBeenCalled();
});
