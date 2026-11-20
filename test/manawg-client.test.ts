import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createSessionController, type SessionController } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';
import { ManaWgError } from '../src/errors.js';
import { bearerCredentials, createManaWgClient, sessionCredentials } from '../src/manawg-client.js';
import { useCleanup } from './helpers/app.js';

const validConfig: Pick<AppConfig, 'baseUrl' | 'origin' | 'timeoutMs' | 'defaultWgCode'> = {
  baseUrl: 'https://example.test',
  origin: 'https://example.test',
  defaultWgCode: 'K7Q2M9XD',
  timeoutMs: 10_000,
};

/** The same config without a default flat, so the client looks up the account's only one. */
const configWithoutDefault = { ...validConfig, defaultWgCode: undefined };

const SECRET = 'a'.repeat(64);

const later = useCleanup();

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Every attempt gets its own `Response`: a body can be read only once. */
function answering(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(body, status, headers));
}

/** Answers the only-flat lookup with one flat and everything else with an empty list. */
function lookupFetch() {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith('/api/wg/mine')
        ? jsonResponse({ wgs: [{ code: 'K7Q2M9XD' }] })
        : jsonResponse({ items: [] }),
    );
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
  later(
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

it('url-encodes path segments and refuses a malformed WG code before any request', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.call({ path: ['chores', 'chore/1', 'complete'], method: 'POST', body: {} });
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://example.test/api/wg/K7Q2M9XD/chores/chore%2F1/complete',
  );

  expect(await errorCode(client.call({ path: ['shopping'], wgCode: 'WG 1/2' }))).toBe(
    'invalid_share_code',
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('forwards the session cookie and ingests rotated cookies', async () => {
  const auth = fakeAuth();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }));
  const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(auth));

  await client.call({ path: ['shopping'] });

  const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.get('cookie')).toBe('sb-project-auth-token=cookie-value');
  expect(auth.ingest).toHaveBeenCalledTimes(1);
});

it('rejects redirects before credentials can reach another origin', async () => {
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
  const fetchMock = answering({}, 503);
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('internal_error');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('keeps the allowlisted code of the last failed attempt', async () => {
  const fetchMock = answering({ error: 'service_unavailable', code: 'busy_retry' }, 503);
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('busy_retry');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('surfaces a busy_retry whose Retry-After is too long to wait for, with its hint', async () => {
  const fetchMock = answering({ error: 'service_unavailable', code: 'busy_retry' }, 503, {
    'retry-after': '30',
  });
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const thrown = await client.call({ path: ['dashboard'] }).catch((error: unknown) => error);

  expect(thrown).toBeInstanceOf(ManaWgError);
  expect((thrown as ManaWgError).code).toBe('busy_retry');
  expect((thrown as ManaWgError).retryAfterSeconds).toBe(30);
  expect(fetchMock).toHaveBeenCalledTimes(1);
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
  [409, 'shopping_item_duplicate'],
] as const)('does not retry an HTTP %i write and returns its safe code', async (status, code) => {
  const fetchMock = answering({ error: `secret:${SECRET}`, code }, status);
  const client = createManaWgClient(validConfig, fetchMock);

  const thrown = await client
    .call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } })
    .catch((error: unknown) => error);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(thrown).toBeInstanceOf(ManaWgError);
  expect((thrown as ManaWgError).code).toBe(code);
  expect(String((thrown as ManaWgError).message)).not.toContain(SECRET);
});

it('retries a rate-limited write with the same key and surfaces the safe code', async () => {
  const fetchMock = answering({ code: 'too_many_requests' }, 429);
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const thrown = await client
    .call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } })
    .catch((error: unknown) => error);

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect((thrown as ManaWgError).code).toBe('too_many_requests');
  const keys = fetchMock.mock.calls.map((call) =>
    new Headers(call[1]?.headers).get('idempotency-key'),
  );
  expect(new Set(keys).size).toBe(1);
});

it('falls back to the HTTP status when the upstream error has no stable code', async () => {
  const fetchMock = answering({ error: `secret:${SECRET}` }, 500);
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('internal_error');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('falls back to the HTTP status when the upstream code is unknown or secret-bearing', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ error: 'conflict', code: `secret:${SECRET}` }, 409));
  const client = createManaWgClient(validConfig, fetchMock);

  const code = await errorCode(
    client.call({ path: ['shopping'], method: 'POST', body: { name: 'Milch' } }),
  );

  expect(code).toBe('upstream_http_409');
  expect(code).not.toContain(SECRET);
});

it('keeps retry-after seconds from rate limits', async () => {
  const fetchMock = answering({ error: 'slow down', code: 'too_many_requests' }, 429, {
    'retry-after': '17',
  });
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const thrown = await client.call({ path: ['dashboard'] }).catch((error: unknown) => error);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(thrown).toBeInstanceOf(ManaWgError);
  expect((thrown as ManaWgError).retryAfterSeconds).toBe(17);
  expect((thrown as ManaWgError).details).toBeUndefined();
});

it('forwards validation details but not the rest of the error body', async () => {
  const fetchMock = answering(
    {
      error: `secret:${SECRET}`,
      code: 'validation_errors',
      details: { errors: [{ path: 'name', message: 'too short' }] },
    },
    400,
  );
  const client = createManaWgClient(validConfig, fetchMock);

  const thrown = await client
    .call({ path: ['shopping'], method: 'POST', body: {} })
    .catch((error: unknown) => error);

  expect((thrown as ManaWgError).details).toContain('too short');
  expect(String((thrown as ManaWgError).message)).not.toContain(SECRET);
});

it('answers with the status code when an error body is not JSON', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('<html>bad gateway</html>', { status: 500 }));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('internal_error');
});

it('refuses a successful answer that is not JSON instead of reporting an empty result', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response('<html>maintenance</html>', {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = createManaWgClient(validConfig, fetchMock);

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('invalid_response');
});

it.each([
  ['a 204 without a body', () => new Response(null, { status: 204 })],
  [
    'an empty JSON body',
    () => new Response('', { headers: { 'content-type': 'application/json' } }),
  ],
])('reads %s as an empty result', async (_name, answer) => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => answer());
  const client = createManaWgClient(validConfig, fetchMock);

  await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({});
});

it('sanitizes thrown transport errors', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(`network:${SECRET}`));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  const code = await errorCode(client.call({ path: ['dashboard'] }));

  expect(code).toBe('upstream_network_error');
  expect(code).not.toContain(SECRET);
});

it('retries once on an auth-required 401 with a fresh cookie', async () => {
  const auth = fakeAuth();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ error: 'please sign in', code: 'auth_required' }, 401))
    .mockResolvedValueOnce(jsonResponse({ items: [] }));
  const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(auth));

  await expect(client.call({ path: ['shopping'] })).resolves.toEqual({ items: [] });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(auth.invalidate).toHaveBeenCalledTimes(1);
  expect(auth.cookieHeader).toHaveBeenCalledTimes(2);
});

it('does not loop beyond one retry when the app keeps rejecting the session', async () => {
  const auth = fakeAuth();
  const fetchMock = answering({ error: 'nope', code: 'auth_required' }, 401);
  const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(auth));

  expect(await errorCode(client.call({ path: ['shopping'] }))).toBe('auth_required');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(auth.invalidate).toHaveBeenCalledTimes(1);
});

it('returns a CSV body as text instead of dropping it', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response('id,name\n1,Anna\n', { headers: { 'content-type': 'text/csv; charset=utf-8' } }),
    );
  const client = createManaWgClient(validConfig, fetchMock);

  await expect(client.call({ path: ['export'], query: { format: 'csv' } })).resolves.toEqual({
    contentType: 'text/csv; charset=utf-8',
    content: 'id,name\n1,Anna\n',
  });
});

it.each([429, 503])(
  'waits out a short Retry-After on a %i and succeeds on the next attempt',
  async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 'busy_retry' }, status, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ openShopping: [] }));
    const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

    await expect(client.call({ path: ['dashboard'] })).resolves.toEqual({ openShopping: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

it('maps a failing session sign-in to the safe auth_failed code', async () => {
  const outage = new Error('auth_failed');
  const auth = fakeAuth({ cookieHeader: vi.fn().mockRejectedValue(outage) });
  const fetchMock = vi.fn<typeof fetch>();
  const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(auth));

  const error = await client.call({ path: ['dashboard'] }).catch((caught: unknown) => caught);

  expect(error).toMatchObject({ code: 'auth_failed', status: 401, cause: outage });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['not_a_member', 'member_deactivated'])(
  'returns a 401 %s for the flat as it is and keeps the session',
  async (code) => {
    const auth = fakeAuth();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ code }, 401));
    const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(auth));

    expect(await errorCode(client.call({ path: ['shopping'] }))).toBe(code);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.invalidate).not.toHaveBeenCalled();
  },
);

it('treats a delete that found its row gone after a lost answer as done', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('socket hang up'))
    .mockResolvedValueOnce(jsonResponse({ code: 'expense_not_found' }, 404));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  await expect(client.call({ path: ['expenses', 'e1'], method: 'DELETE' })).resolves.toEqual({
    deleted: true,
    alreadyGone: true,
  });
});

it('treats a delete that found its row gone after a 5xx as done', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ code: 'internal_error' }, 502))
    .mockResolvedValueOnce(jsonResponse({ code: 'expense_not_found' }, 404));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  await expect(client.call({ path: ['expenses', 'e1'], method: 'DELETE' })).resolves.toEqual({
    deleted: true,
    alreadyGone: true,
  });
});

it('reports a missing flat on a retried delete instead of claiming success', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('socket hang up'))
    .mockResolvedValueOnce(jsonResponse({ code: 'wg_not_found' }, 404));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['expenses', 'e1'], method: 'DELETE' }))).toBe(
    'wg_not_found',
  );
});

it('reports a missing row after a 429, since the rate-limited delete never ran', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({ code: 'too_many_requests' }, 429))
    .mockResolvedValueOnce(jsonResponse({ code: 'expense_not_found' }, 404));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['expenses', 'e1'], method: 'DELETE' }))).toBe(
    'expense_not_found',
  );
});

it('still reports a missing row when the first delete never went out', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ code: 'expense_not_found' }, 404));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['expenses', 'e1'], method: 'DELETE' }))).toBe(
    'expense_not_found',
  );
});

it('does not replay a guarded update after a network failure', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket hang up'));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(
    await errorCode(
      client.call({
        path: ['chores', 'c1'],
        method: 'PATCH',
        body: { title: 'x', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
      }),
    ),
  ).toBe('upstream_network_error');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not replay a guarded update after a 5xx that may have been committed', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ code: 'x' }, 503));
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  await errorCode(
    client.call({
      path: ['chores', 'c1'],
      method: 'PATCH',
      body: { title: 'x', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' },
    }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('stops retrying and answers timeout once the call is aborted', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        controller.abort();
      }),
  );
  const client = createManaWgClient(validConfig, fetchMock, undefined, { retryDelaysMs: [1, 1] });

  expect(await errorCode(client.call({ path: ['dashboard'], signal: controller.signal }))).toBe(
    'timeout',
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

/**
 * Fake timers do not reach `AbortSignal.timeout`, so this routes it through the faked
 * `setTimeout` to let a test step past the 45 s call deadline.
 */
function useFakeDeadlines(): void {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
  later(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

/** Settles `promise` into a readable state, so a test can check it without awaiting it. */
function track(promise: Promise<unknown>) {
  const state: { settled: boolean; code?: string } = { settled: false };
  errorCode(promise).then(
    (code) => Object.assign(state, { settled: true, code }),
    () => Object.assign(state, { settled: true, code: 'unexpected' }),
  );
  return state;
}

it('answers timeout at once when a call is aborted while sign-in still hangs', async () => {
  useFakeDeadlines();
  const fetchMock = answering({ items: [] });
  const auth = fakeAuth({ cookieHeader: () => new Promise<string>(() => undefined) });
  const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(auth));
  const controller = new AbortController();

  const call = track(client.call({ path: ['shopping'], signal: controller.signal }));
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);

  expect(call).toEqual({ settled: true, code: 'timeout' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('fails a call at the 45 s deadline while its token requests are still running', async () => {
  useFakeDeadlines();
  const dir = mkdtempSync(join(tmpdir(), 'manawg-mcp-deadline-'));
  later(() => rmSync(dir, { recursive: true, force: true }));
  const sessionCachePath = join(dir, 'session.json');
  // An expired session: refresh it, then the configured refresh token, then the password.
  writeFileSync(
    sessionCachePath,
    JSON.stringify({ access_token: 'old', refresh_token: 'old-refresh', expires_at: 1 }),
  );
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) => {
    if (!String(url).includes('/auth/v1/token')) {
      return Promise.resolve(jsonResponse({ items: [] }));
    }
    // Each token request stays inside its own 20 s timeout and is refused at 19 s.
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsonResponse({ error: 'invalid_grant' }, 400)), 19_000);
    });
  });
  const session = createSessionController(
    {
      mode: 'session',
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_key_abc',
      bootstrapRefreshToken: 'bootstrap-refresh',
      email: 'member@example.test',
      password: 'correct horse battery',
      sessionCachePath,
    },
    fetchMock,
    20_000,
  );
  const client = createManaWgClient(validConfig, fetchMock, sessionCredentials(session));

  const call = track(client.call({ path: ['shopping'] }));
  await vi.advanceTimersByTimeAsync(44_999);
  expect(call.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);

  expect(call).toEqual({ settled: true, code: 'timeout' });
  // The sign-in left behind finishes on its own without an unhandled rejection.
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/wg/'))).toEqual([]);
});

it('shares the only-flat lookup between per-request clients of one verified user', async () => {
  const fetchMock = lookupFetch();
  const make = (token: string, subject: string) =>
    createManaWgClient(configWithoutDefault, fetchMock, bearerCredentials(token, subject));

  await make('token-1', 'user-shared').call({ path: ['shopping'] });
  await make('token-2', 'user-shared').call({ path: ['shopping'] });
  await make('token-3', 'user-other').call({ path: ['shopping'] });

  const urls = fetchMock.mock.calls.map((call) => String(call[0]));
  expect(urls.filter((url) => url.endsWith('/api/wg/mine'))).toHaveLength(2);
});

it('keeps a shared only-flat lookup alive when the caller that started it aborts', async () => {
  const fetchMock = lookupFetch();
  const make = () =>
    createManaWgClient(
      configWithoutDefault,
      fetchMock,
      bearerCredentials('token', 'user-abort-shared'),
    );
  const first = new AbortController();

  const aborted = errorCode(make().call({ path: ['shopping'], signal: first.signal }));
  const healthy = make().call({ path: ['shopping'] });
  first.abort();

  expect(await aborted).toBe('timeout');
  await expect(healthy).resolves.toEqual({ items: [] });
});

it('reports a request that outlasts the per-attempt timeout as timeout and retries a read', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  );
  const client = createManaWgClient({ ...validConfig, timeoutMs: 5 }, fetchMock, undefined, {
    retryDelaysMs: [1, 1],
  });

  expect(await errorCode(client.call({ path: ['dashboard'] }))).toBe('timeout');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('sends a DELETE without a body', async () => {
  const fetchMock = answering({ deleted: true });
  const client = createManaWgClient(validConfig, fetchMock);

  await client.call({ path: ['expenses', 'e1'], method: 'DELETE' });

  expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
});
