import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionController, MAX_CHUNK_SIZE, sessionCookiePairs } from '../src/auth.js';
import type { SupabaseAuthConfig } from '../src/config.js';

const SUPABASE_URL = 'https://project.supabase.co';
const KEY = 'sb-project-auth-token';
const PUBLISHABLE_KEY = 'sb_publishable_key_abc';

const dirs: string[] = [];
const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'manawg-mcp-auth-'));
  dirs.push(dir);
  return join(dir, 'session.json');
}

function authConfig(overrides: Partial<SupabaseAuthConfig> = {}): SupabaseAuthConfig {
  return {
    mode: 'session',
    url: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    email: 'member@example.test',
    password: 'correct horse battery',
    sessionCachePath: cachePath(),
    ...overrides,
  };
}

function freshSession(secondsFromNow = 3600): Record<string, unknown> {
  return {
    access_token: `at-${fetchMock.mock.calls.length}`,
    refresh_token: 'refresh-token-1',
    expires_at: Math.floor(Date.now() / 1000) + secondsFromNow,
    expires_in: secondsFromNow,
    token_type: 'bearer',
    user: { id: 'user-1' },
  };
}

function grantResponse(session: Record<string, unknown>): Response {
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function tokenCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[0];
  if (!call) {
    throw new Error('Expected a token request');
  }
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

/** The `Cookie` header the app expects for a session that fits one cookie. */
function cookieFor(session: Record<string, unknown>): string {
  return `${KEY}=base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
}

function decodeCookieHeader(header: string): string {
  const value = header.slice(header.indexOf('=') + 1);
  return value.startsWith('base64-')
    ? Buffer.from(value.slice('base64-'.length), 'base64url').toString('utf8')
    : decodeURIComponent(value);
}

it('splits a long session into chunks of at most MAX_CHUNK_SIZE', () => {
  const session = { ...freshSession(), user: { id: 'user-1', padding: 'x'.repeat(4000) } };
  const json = JSON.stringify(session);
  const pairs = sessionCookiePairs(KEY, json);

  expect(pairs.length).toBeGreaterThan(1);
  expect(pairs[0]?.name).toBe(`${KEY}.0`);
  expect(pairs.every((pair) => pair.value.length <= MAX_CHUNK_SIZE)).toBe(true);
  const joined = pairs.map((pair) => pair.value).join('');
  expect(JSON.parse(Buffer.from(joined.slice('base64-'.length), 'base64url').toString())).toEqual(
    session,
  );
});

it('signs in with the password grant and caches the session', async () => {
  const session = freshSession();
  fetchMock.mockResolvedValue(grantResponse(session));
  const path = cachePath();
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  const header = await controller.cookieHeader();

  const { url, init } = tokenCall();
  expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
  expect(new Headers(init.headers).get('apikey')).toBe(PUBLISHABLE_KEY);
  expect(JSON.parse(String(init.body))).toEqual({
    grant_type: 'password',
    email: 'member@example.test',
    password: 'correct horse battery',
  });
  expect(header).toBe(cookieFor(session));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const cached = JSON.parse(readFileSync(path, 'utf8'));
  expect(cached.access_token).toBe(session.access_token);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

it('reuses a cached session without any network call', async () => {
  const session = freshSession();
  const path = cachePath();
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  await expect(controller.cookieHeader()).resolves.toBe(cookieFor(session));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('refreshes an expired cached session with its refresh token', async () => {
  const stale = { ...freshSession(-120), refresh_token: 'refresh-token-1' };
  const rotated = { ...freshSession(), refresh_token: 'refresh-token-2' };
  const path = cachePath();
  writeFileSync(path, JSON.stringify(stale), { mode: 0o600 });
  fetchMock.mockResolvedValue(grantResponse(rotated));
  const controller = createSessionController(
    authConfig({ sessionCachePath: path, email: undefined, password: undefined }),
    fetchMock,
  );

  const header = await controller.cookieHeader();

  const { url, init } = tokenCall();
  expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  expect(JSON.parse(String(init.body))).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'refresh-token-1',
  });
  expect(header).toBe(cookieFor(rotated));
  expect(JSON.parse(readFileSync(path, 'utf8')).refresh_token).toBe('refresh-token-2');
});

it('falls back to the bootstrap refresh token when no session is cached', async () => {
  fetchMock.mockResolvedValue(grantResponse(freshSession()));
  const controller = createSessionController(
    authConfig({
      email: undefined,
      password: undefined,
      bootstrapRefreshToken: 'bootstrap-token',
    }),
    fetchMock,
  );

  await controller.cookieHeader();

  const { url, init } = tokenCall();
  expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  expect(JSON.parse(String(init.body))).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'bootstrap-token',
  });
});

it('reports rejected credentials as auth_failed and writes no cache', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: 'Invalid login credentials' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const path = cachePath();
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  await expect(controller.cookieHeader()).rejects.toThrow('auth_failed');

  expect(existsSync(path)).toBe(false);
});

it('keeps the cause of a failed token request out of the message', async () => {
  const outage = new Error('socket hang up with secrets');
  fetchMock.mockRejectedValue(outage);
  const controller = createSessionController(authConfig(), fetchMock);

  const error = await controller.cookieHeader().catch((caught: unknown) => caught);

  expect(error).toMatchObject({ message: 'auth_failed', cause: outage });
});

it('refuses a token answer that carries no tokens', async () => {
  fetchMock.mockResolvedValue(grantResponse({ expires_in: 3600 }));
  const path = cachePath();
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  await expect(controller.cookieHeader()).rejects.toThrow('auth_failed');

  expect(existsSync(path)).toBe(false);
});

it('retries the bootstrap token after a network failure but not after a rejection', async () => {
  const config = authConfig({
    email: undefined,
    password: undefined,
    bootstrapRefreshToken: 'bootstrap-token',
  });
  fetchMock
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response('{}', { status: 400 }));
  const controller = createSessionController(config, fetchMock);

  await expect(controller.cookieHeader()).rejects.toThrow('auth_failed');
  await expect(controller.cookieHeader()).rejects.toThrow('auth_failed');
  await expect(controller.cookieHeader()).rejects.toThrow('auth_failed');

  const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(bodies.map((body) => body.refresh_token)).toEqual(['bootstrap-token', 'bootstrap-token']);
});

it('ingests rotated Set-Cookie headers from the app on the next request', async () => {
  const initial = freshSession();
  fetchMock.mockResolvedValue(grantResponse(initial));
  const controller = createSessionController(authConfig(), fetchMock);
  await controller.cookieHeader();
  fetchMock.mockReset();

  const rotated = { ...freshSession(7200), access_token: 'at-rotated' };
  const response = new Response('{}', {
    status: 200,
    headers: {
      'set-cookie': `${KEY}=${encodeURIComponent(JSON.stringify(rotated))}; Path=/; HttpOnly`,
    },
  });
  await controller.ingest(response);

  const header = await controller.cookieHeader();
  expect(header).toBe(cookieFor(rotated));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('ingests chunked Set-Cookie headers from the app', async () => {
  const controller = createSessionController(authConfig(), fetchMock);
  const rotated = {
    ...freshSession(7200),
    access_token: 'at-chunked',
    user: { padding: 'x'.repeat(4000) },
  };
  const json = JSON.stringify(rotated);
  const pairs = sessionCookiePairs(KEY, json);
  const headers = new Headers();
  for (const pair of pairs) {
    headers.append('set-cookie', `${pair.name}=${pair.value}; Path=/; HttpOnly`);
  }

  await controller.ingest(new Response('{}', { status: 200, headers }));

  const header = await controller.cookieHeader();
  expect(pairs.length).toBeGreaterThan(1);
  expect(header).toBe(pairs.map((pair) => `${pair.name}=${pair.value}`).join('; '));
});

it('refreshes with its own refresh token after invalidate and keeps the cache', async () => {
  const path = cachePath();
  writeFileSync(path, JSON.stringify(freshSession()), { mode: 0o600 });
  fetchMock.mockResolvedValue(
    grantResponse({
      ...freshSession(),
      access_token: 'at-second',
      refresh_token: 'refresh-token-2',
    }),
  );
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  await controller.cookieHeader();
  const before = readFileSync(path, 'utf8');
  controller.invalidate();
  expect(readFileSync(path, 'utf8')).toBe(before);

  const header = await controller.cookieHeader();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(tokenCall().url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  expect(JSON.parse(String(tokenCall().init.body)).refresh_token).toBe('refresh-token-1');
  expect(decodeCookieHeader(header)).toContain('at-second');
});

it('adopts a session a sibling rotated on invalidate and leaves the cache untouched', async () => {
  const path = cachePath();
  writeFileSync(path, JSON.stringify(freshSession()), { mode: 0o600 });
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);
  await controller.cookieHeader();

  const rotated = {
    ...freshSession(7200),
    access_token: 'at-sibling',
    refresh_token: 'refresh-token-sibling',
  };
  writeFileSync(path, JSON.stringify(rotated), { mode: 0o600 });
  const before = readFileSync(path, 'utf8');

  controller.invalidate();

  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(decodeCookieHeader(await controller.cookieHeader())).toContain('at-sibling');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not replay the spent bootstrap token after invalidate', async () => {
  fetchMock
    .mockResolvedValueOnce(grantResponse({ ...freshSession(), refresh_token: 'rotated-1' }))
    .mockResolvedValueOnce(grantResponse({ ...freshSession(), refresh_token: 'rotated-2' }));
  const controller = createSessionController(
    authConfig({ bootstrapRefreshToken: 'bootstrap-token' }),
    fetchMock,
  );

  await controller.cookieHeader();
  controller.invalidate();
  await controller.cookieHeader();

  const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(bodies.map((body) => body.refresh_token)).toEqual(['bootstrap-token', 'rotated-1']);
});

it('adopts the session a sibling process rotated instead of deleting it', async () => {
  const path = cachePath();
  const stale = { ...freshSession(-120), refresh_token: 'refresh-token-1' };
  writeFileSync(path, JSON.stringify(stale), { mode: 0o600 });
  const sibling = {
    ...freshSession(),
    access_token: 'at-sibling',
    refresh_token: 'refresh-token-2',
  };
  // The sibling rotates the token while this process' refresh with the old one is in flight.
  fetchMock.mockImplementation(async () => {
    writeFileSync(path, JSON.stringify(sibling), { mode: 0o600 });
    return new Response('{}', { status: 400 });
  });
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  const header = await controller.cookieHeader();

  expect(decodeCookieHeader(header)).toContain('at-sibling');
  expect(JSON.parse(readFileSync(path, 'utf8')).refresh_token).toBe('refresh-token-2');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps the winner of a refresh race when its session lands after the rejection', async () => {
  vi.useFakeTimers();
  try {
    const path = cachePath();
    writeFileSync(
      path,
      JSON.stringify({ ...freshSession(-120), refresh_token: 'refresh-token-1' }),
      {
        mode: 0o600,
      },
    );
    const winner = {
      ...freshSession(),
      access_token: 'at-winner',
      refresh_token: 'refresh-token-2',
    };
    // Supabase has already rotated the token for the sibling, which writes the cache 300 ms later.
    fetchMock.mockImplementation(async () => {
      setTimeout(() => writeFileSync(path, JSON.stringify(winner), { mode: 0o600 }), 300);
      return new Response('{}', { status: 400 });
    });
    const controller = createSessionController(
      authConfig({
        sessionCachePath: path,
        email: undefined,
        password: undefined,
        bootstrapRefreshToken: 'bootstrap-token',
      }),
      fetchMock,
    );

    const header = controller.cookieHeader();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(decodeCookieHeader(await header)).toContain('at-winner');
    expect(JSON.parse(readFileSync(path, 'utf8')).refresh_token).toBe('refresh-token-2');
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies.map((body) => body.refresh_token)).toEqual(['refresh-token-1']);
  } finally {
    vi.useRealTimers();
  }
});

it('reads the shared cache before signing in when it has no session of its own', async () => {
  const path = cachePath();
  const controller = createSessionController(
    authConfig({
      sessionCachePath: path,
      email: undefined,
      password: undefined,
      bootstrapRefreshToken: 'bootstrap-token',
    }),
    fetchMock,
  );
  const sibling = {
    ...freshSession(),
    access_token: 'at-sibling',
    refresh_token: 'refresh-token-2',
  };
  writeFileSync(path, JSON.stringify(sibling), { mode: 0o600 });

  const header = await controller.cookieHeader();

  expect(decodeCookieHeader(header)).toContain('at-sibling');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('leaves the shared cache alone when the app clears the session cookie', async () => {
  const path = cachePath();
  writeFileSync(path, JSON.stringify(freshSession()), { mode: 0o600 });
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);
  await controller.cookieHeader();
  const sibling = {
    ...freshSession(7200),
    access_token: 'at-sibling',
    refresh_token: 'refresh-token-2',
  };
  writeFileSync(path, JSON.stringify(sibling), { mode: 0o600 });
  const before = readFileSync(path, 'utf8');

  await controller.ingest(
    new Response('{}', { headers: { 'set-cookie': `${KEY}=; Path=/; Max-Age=0` } }),
  );

  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(decodeCookieHeader(await controller.cookieHeader())).toContain('at-sibling');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not take up a cached session whose refresh token was already refused', async () => {
  const path = cachePath();
  writeFileSync(path, JSON.stringify({ ...freshSession(-120), refresh_token: 'refresh-dead' }), {
    mode: 0o600,
  });
  fetchMock
    .mockResolvedValueOnce(new Response('{}', { status: 400 }))
    .mockResolvedValue(grantResponse({ ...freshSession(), access_token: 'at-password' }));
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  vi.useFakeTimers();
  try {
    const header = controller.cookieHeader();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(decodeCookieHeader(await header)).toContain('at-password');
  } finally {
    vi.useRealTimers();
  }
  const grants = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).grant_type);
  expect(grants).toEqual(['refresh_token', 'password']);
});

it('replaces a wider cache file atomically with an owner-only one', async () => {
  const path = cachePath();
  writeFileSync(path, '{}', { mode: 0o644 });
  chmodSync(path, 0o644);
  fetchMock.mockResolvedValue(grantResponse(freshSession()));
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  await controller.cookieHeader();

  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(dirname(path))).toEqual(['session.json']);
});

it('ignores invalidate while a sign-in is already in flight', async () => {
  const path = cachePath();
  let release: ((response: Response) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  const first = controller.cookieHeader();
  await Promise.resolve();
  controller.invalidate();
  const second = controller.cookieHeader();

  if (!release) {
    throw new Error('Expected the sign-in request to be in flight');
  }
  release(grantResponse(freshSession()));
  const headers = await Promise.all([first, second]);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(headers[0]).toBe(headers[1]);
  expect(existsSync(path)).toBe(true);
});

/** A fetch that never answers on its own and rejects once its signal aborts, like the real one. */
function hangingFetch(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
}

it('gives up on a hung token request and retries on the next call', async () => {
  fetchMock.mockImplementationOnce((_url, init) => hangingFetch(init));
  fetchMock.mockImplementation(async () => grantResponse(freshSession()));
  const controller = createSessionController(authConfig(), fetchMock, 50);

  const first = await controller
    .cookieHeader()
    .catch((error: unknown) => (error instanceof Error ? error.message : ''));
  expect(first).toBe('auth_failed');

  await expect(controller.cookieHeader()).resolves.toContain(KEY);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
