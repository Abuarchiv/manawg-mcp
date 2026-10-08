import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MAX_CHUNK_SIZE, createSessionController, sessionCookiePairs } from '../src/auth.js';
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

function signInCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[0];
  if (!call) {
    throw new Error('Expected a sign-in request');
  }
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

function decodeCookieHeader(header: string): string {
  const value = header.slice(header.indexOf('=') + 1);
  return value.startsWith('base64-')
    ? Buffer.from(value.slice('base64-'.length), 'base64url').toString('utf8')
    : decodeURIComponent(value);
}

it('splits long sessions into chunked pairs that decode back to the session', () => {
  const session = { ...freshSession(), user: { id: 'user-1', padding: 'x'.repeat(4000) } };
  const json = JSON.stringify(session);
  const pairs = sessionCookiePairs(KEY, json);

  expect(pairs.length).toBeGreaterThan(1);
  expect(pairs[0]?.name).toBe(`${KEY}.0`);
  expect(pairs.every((pair) => pair.value.length <= MAX_CHUNK_SIZE)).toBe(true);
  expect(pairs.map((pair) => pair.value).join('')).toBe(
    `base64-${Buffer.from(json, 'utf8').toString('base64url')}`,
  );
});

it('signs in with the password grant and caches the session', async () => {
  const session = freshSession();
  fetchMock.mockResolvedValue(grantResponse(session));
  const path = cachePath();
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  const header = await controller.cookieHeader();

  const { url, init } = signInCall();
  expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
  expect(new Headers(init.headers).get('apikey')).toBe(PUBLISHABLE_KEY);
  expect(JSON.parse(String(init.body))).toEqual({
    grant_type: 'password',
    email: 'member@example.test',
    password: 'correct horse battery',
  });
  expect(header).toBe(
    `${KEY}=base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`,
  );
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

  await expect(controller.cookieHeader()).resolves.toBe(
    `${KEY}=base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`,
  );
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

  const { url, init } = signInCall();
  expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  expect(JSON.parse(String(init.body))).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'refresh-token-1',
  });
  expect(header).toBe(
    `${KEY}=base64-${Buffer.from(JSON.stringify(rotated), 'utf8').toString('base64url')}`,
  );
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

  const { url, init } = signInCall();
  expect(url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  expect(JSON.parse(String(init.body))).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'bootstrap-token',
  });
});

it('reports rejected credentials without echoing the password', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: 'Invalid login credentials' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const controller = createSessionController(authConfig(), fetchMock);

  await expect(controller.cookieHeader()).rejects.toThrow('auth_failed');

  const failure = await controller
    .cookieHeader()
    .catch((error: unknown) => (error instanceof Error ? error.message : ''));
  expect(failure).toBe('auth_failed');
  expect(failure).not.toContain('correct horse battery');
  expect(failure).not.toContain('member@example.test');
});

it('keeps a transient auth outage separate from rejected credentials', async () => {
  fetchMock.mockRejectedValue(new Error('socket hang up with secrets'));
  const controller = createSessionController(authConfig(), fetchMock);

  const message = await controller
    .cookieHeader()
    .catch((error: unknown) => (error instanceof Error ? error.message : ''));

  expect(message).toBe('auth_failed');
  expect(message).not.toContain('secrets');
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
  expect(header).toBe(
    `${KEY}=base64-${Buffer.from(JSON.stringify(rotated), 'utf8').toString('base64url')}`,
  );
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

it('drops the cached session on invalidate and re-authenticates', async () => {
  const session = freshSession();
  const path = cachePath();
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
  fetchMock.mockResolvedValue(grantResponse({ ...freshSession(), access_token: 'at-second' }));
  const controller = createSessionController(authConfig({ sessionCachePath: path }), fetchMock);

  await controller.cookieHeader();
  controller.invalidate();
  expect(existsSync(path)).toBe(false);

  const header = await controller.cookieHeader();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(decodeCookieHeader(header)).toContain('at-second');
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
