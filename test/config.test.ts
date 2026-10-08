import { expect, it } from 'vitest';
import { DEFAULT_SESSION_CACHE_PATH, loadConfig } from '../src/config.js';

function validEnv(): NodeJS.ProcessEnv {
  return {
    MANAWG_BASE_URL: 'https://example.test/',
    MANAWG_WG_CODE: 'WG123',
    MANAWG_SUPABASE_URL: 'https://project.supabase.co/',
    MANAWG_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_key_abc',
    MANAWG_EMAIL: 'member@example.test',
    MANAWG_PASSWORD: 'correct horse battery',
  };
}

function thrownMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    throw error;
  }
  throw new Error('Expected action to throw');
}

it('rejects missing required credentials without echoing their values', () => {
  const env = validEnv();
  env.MANAWG_WG_CODE = undefined;
  const message = thrownMessage(() => loadConfig(env));

  expect(message).toContain('MANAWG_WG_CODE');
  for (const value of [env.MANAWG_BASE_URL, env.MANAWG_PASSWORD]) {
    if (typeof value === 'string') {
      expect(message).not.toContain(value);
    }
  }
  expect(message).not.toContain('MEMBER_SESSION_SECRET');
});

it('accepts a valid configuration and normalizes the base URL', () => {
  expect(loadConfig(validEnv()).baseUrl).toBe('https://example.test');
});

it('derives the Origin header from the base URL', () => {
  expect(loadConfig(validEnv()).origin).toBe('https://example.test');
});

it('rejects an invalid base URL', () => {
  expect(() => loadConfig({ ...validEnv(), MANAWG_BASE_URL: 'ftp://example.test' })).toThrow();
});

it('rejects a non-http Supabase URL without echoing credentials', () => {
  const env: NodeJS.ProcessEnv = {
    ...validEnv(),
    MANAWG_SUPABASE_URL: 'ftp://project.supabase.co',
  };
  const message = thrownMessage(() => loadConfig(env));

  expect(message).toContain('MANAWG_SUPABASE_URL');
  expect(message).not.toContain('correct horse battery');
  expect(message).not.toContain('sb_publishable_key_abc');
});

it('requires Supabase configuration for the session', () => {
  const env = validEnv();
  env.MANAWG_SUPABASE_URL = undefined;
  const message = thrownMessage(() => loadConfig(env));

  expect(message).toContain('MANAWG_SUPABASE_URL');
  expect(message).not.toContain('correct horse battery');
});

it('requires either a refresh token or an email/password pair', () => {
  const env = validEnv();
  env.MANAWG_EMAIL = undefined;
  env.MANAWG_PASSWORD = undefined;
  env.MANAWG_SUPABASE_REFRESH_TOKEN = undefined;
  const message = thrownMessage(() => loadConfig(env));

  expect(message).toContain('MANAWG_SUPABASE_REFRESH_TOKEN');
  expect(message).toContain('MANAWG_EMAIL');
  expect(message).toContain('MANAWG_PASSWORD');
  expect(message).not.toContain('a'.repeat(64));
});

it('prefers the refresh token over password sign-in when both are set', () => {
  const config = loadConfig({
    ...validEnv(),
    MANAWG_SUPABASE_REFRESH_TOKEN: 'refresh-token-value',
  });

  expect(config.auth.bootstrapRefreshToken).toBe('refresh-token-value');
  expect(config.auth.email).toBeUndefined();
  expect(config.auth.password).toBeUndefined();
});

it('treats a blank refresh token as absent', () => {
  const env = { ...validEnv(), MANAWG_SUPABASE_REFRESH_TOKEN: '   ' };
  const config = loadConfig(env);

  expect(config.auth.bootstrapRefreshToken).toBeUndefined();
  expect(config.auth.email).toBe('member@example.test');
});

it('keeps the publishable key and email without leaking them on other failures', () => {
  const config = loadConfig({ ...validEnv(), MANAWG_WG_CODE: 'WG123' });

  expect(config.auth.publishableKey).toBe('sb_publishable_key_abc');
  expect(config.auth.email).toBe('member@example.test');
  expect(config.auth.url).toBe('https://project.supabase.co');
});

it('uses a default session cache path outside the working directory config', () => {
  expect(loadConfig(validEnv()).auth.sessionCachePath).toBe(DEFAULT_SESSION_CACHE_PATH);
});

it('honours an explicit session cache path', () => {
  const config = loadConfig({ ...validEnv(), MANAWG_SESSION_CACHE: '/tmp/manawg/session.json' });

  expect(config.auth.sessionCachePath).toBe('/tmp/manawg/session.json');
});

it.each([
  ['1', true],
  ['true', true],
  ['YES', true],
  ['on', true],
  ['0', false],
  ['false', false],
  ['', false],
])('parses MANAWG_ALLOW_DESTRUCTIVE=%j as %s', (value, expected) => {
  expect(loadConfig({ ...validEnv(), MANAWG_ALLOW_DESTRUCTIVE: value }).allowDestructive).toBe(
    expected,
  );
});

it('leaves destructive tools disabled when the flag is missing', () => {
  expect(loadConfig(validEnv()).allowDestructive).toBe(false);
});

it('trims all environment values before returning the configuration', () => {
  expect(
    loadConfig({
      MANAWG_BASE_URL: '  https://example.test/  ',
      MANAWG_WG_CODE: '  WG123  ',
      MANAWG_SUPABASE_URL: '  https://project.supabase.co/  ',
      MANAWG_SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_key_abc  ',
      MANAWG_EMAIL: '  member@example.test  ',
      MANAWG_PASSWORD: '  correct horse battery  ',
      MANAWG_ALLOW_DESTRUCTIVE: '  1  ',
    }),
  ).toEqual({
    baseUrl: 'https://example.test',
    origin: 'https://example.test',
    wgCode: 'WG123',
    timeoutMs: 10_000,
    auth: {
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_key_abc',
      email: 'member@example.test',
      password: 'correct horse battery',
      sessionCachePath: DEFAULT_SESSION_CACHE_PATH,
    },
    allowDestructive: true,
    transport: 'stdio',
    http: { host: '127.0.0.1', port: 8080, path: '/mcp', cors: false, drainMs: 5000 },
  });
});

it('defaults to the stdio transport on 127.0.0.1:8080/mcp', () => {
  const config = loadConfig(validEnv());

  expect(config.transport).toBe('stdio');
  expect(config.http).toEqual({
    host: '127.0.0.1',
    port: 8080,
    path: '/mcp',
    cors: false,
    drainMs: 5000,
  });
  expect(config.http.apiKey).toBeUndefined();
});

it('reads the http transport settings from the environment', () => {
  const config = loadConfig({
    ...validEnv(),
    MANAWG_TRANSPORT: 'HTTP',
    MANAWG_HTTP_HOST: ' 0.0.0.0 ',
    MANAWG_HTTP_PORT: ' 9090 ',
    MANAWG_HTTP_PATH: ' /mcp/v2 ',
    MANAWG_HTTP_API_KEY: 'k'.repeat(32),
  });

  expect(config.transport).toBe('http');
  expect(config.http).toEqual({
    host: '0.0.0.0',
    port: 9090,
    path: '/mcp/v2',
    apiKey: 'k'.repeat(32),
    cors: false,
    drainMs: 5000,
  });
});

it('reads the drain window and the CORS flag', () => {
  const config = loadConfig({
    ...validEnv(),
    MANAWG_DRAIN_MS: ' 2500 ',
    MANAWG_HTTP_CORS: ' yes ',
  });

  expect(config.http.drainMs).toBe(2500);
  expect(config.http.cors).toBe(true);
});

it('keeps CORS and the drain window off by default', () => {
  const config = loadConfig(validEnv());

  expect(config.http.cors).toBe(false);
  expect(config.http.drainMs).toBe(5000);
});

it('rejects an unknown transport name', () => {
  expect(thrownMessage(() => loadConfig({ ...validEnv(), MANAWG_TRANSPORT: 'grpc' }))).toContain(
    'MANAWG_TRANSPORT',
  );
});

it.each([
  ['MANAWG_HTTP_PORT', '0'],
  ['MANAWG_HTTP_PORT', 'not-a-port'],
  ['MANAWG_HTTP_PORT', '70000'],
  ['MANAWG_HTTP_PATH', 'mcp'],
  ['MANAWG_HTTP_PATH', '/mcp/'],
  ['MANAWG_HTTP_HOST', '0.0.0.0/mcp'],
  ['MANAWG_HTTP_API_KEY', 'short'],
  ['MANAWG_DRAIN_MS', '-1'],
  ['MANAWG_DRAIN_MS', '5000.5'],
  ['MANAWG_DRAIN_MS', '70000'],
])('rejects %s=%s', (name, value) => {
  const message = thrownMessage(() => loadConfig({ ...validEnv(), [name]: value }));

  expect(message).toContain(name);
  expect(message).not.toContain(value);
});

it('ignores the retired member identity variables', () => {
  const config = loadConfig({
    ...validEnv(),
    MANAWG_MEMBER_ID: 'not-a-uuid',
    MANAWG_MEMBER_TOKEN: 'nope',
    MANAWG_IDENTITY_CACHE: '/var/identity.json',
  });

  expect(config).not.toHaveProperty('memberId');
  expect(config).not.toHaveProperty('identityCachePath');
});
