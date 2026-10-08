import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

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
