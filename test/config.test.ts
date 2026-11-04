import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

function validEnv(): NodeJS.ProcessEnv {
  return {
    MANAWG_BASE_URL: 'https://example.test/',
    MANAWG_WG_CODE: 'k7q2m9xd',
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
  env.MANAWG_SUPABASE_URL = undefined;
  const message = thrownMessage(() => loadConfig(env));

  expect(message).toContain('MANAWG_SUPABASE_URL');
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

  expect(config.auth).toMatchObject({
    mode: 'session',
    bootstrapRefreshToken: 'refresh-token-value',
  });
  expect(config.auth).not.toHaveProperty('email');
  expect(config.auth).not.toHaveProperty('password');
});

it('takes the default flat in any case and refuses a code the app never issues', () => {
  expect(loadConfig(validEnv()).defaultWgCode).toBe('K7Q2M9XD');
  expect(loadConfig({ ...validEnv(), MANAWG_WG_CODE: '' }).defaultWgCode).toBeUndefined();
  expect(thrownMessage(() => loadConfig({ ...validEnv(), MANAWG_WG_CODE: 'WG123' }))).toContain(
    'MANAWG_WG_CODE',
  );
});

function oauthEnv(): NodeJS.ProcessEnv {
  return {
    MANAWG_BASE_URL: 'https://app.example.test',
    MANAWG_SUPABASE_URL: 'https://project.supabase.co',
    MANAWG_AUTH: 'oauth',
    MANAWG_TRANSPORT: 'http',
    MANAWG_HTTP_HOST: '0.0.0.0',
    MANAWG_PUBLIC_URL: 'https://mcp.example.test/mcp',
  };
}

it('derives the Supabase issuer, key set and metadata for the hosted OAuth mode', () => {
  const config = loadConfig(oauthEnv());

  expect(config.auth).toEqual({
    mode: 'oauth',
    supabaseUrl: 'https://project.supabase.co',
    issuer: 'https://project.supabase.co/auth/v1',
    jwksUrl: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
    metadataUrl: 'https://project.supabase.co/.well-known/oauth-authorization-server/auth/v1',
    resourceUrl: new URL('https://mcp.example.test/mcp'),
  });
  expect(config.defaultWgCode).toBeUndefined();
});

it.each([
  [{ MANAWG_TRANSPORT: 'stdio' }, 'MANAWG_TRANSPORT=http'],
  [{ MANAWG_PUBLIC_URL: undefined }, 'MANAWG_PUBLIC_URL'],
  [{ MANAWG_PUBLIC_URL: 'http://mcp.example.test/mcp' }, 'https'],
  [{ MANAWG_HTTP_API_KEY: 'k'.repeat(32) }, 'exclude each other'],
  [{ MANAWG_AUTH: 'magic' }, 'MANAWG_AUTH'],
  [{ MANAWG_PUBLIC_URL: 'https://mcp.example.test' }, 'MCP path /mcp'],
  [{ MANAWG_WG_CODE: 'K7Q2M9XD' }, 'every user has own flats'],
])('refuses an incomplete OAuth setup: %o', (overrides, expected) => {
  expect(thrownMessage(() => loadConfig({ ...oauthEnv(), ...overrides }))).toContain(expected);
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

it('requires an API key when HTTP binds outside loopback', () => {
  const message = thrownMessage(() =>
    loadConfig({
      ...validEnv(),
      MANAWG_TRANSPORT: 'http',
      MANAWG_HTTP_HOST: '0.0.0.0',
    }),
  );

  expect(message).toContain('MANAWG_HTTP_API_KEY');
});

it.each(['127.0.0.1', '127.0.0.2', '::1', 'localhost'])(
  'allows a keyless HTTP bind on loopback host %s',
  (host) => {
    const config = loadConfig({
      ...validEnv(),
      MANAWG_TRANSPORT: 'http',
      MANAWG_HTTP_HOST: host,
    });

    expect(config.http.apiKey).toBeUndefined();
  },
);

it('does not require an HTTP API key when stdio is selected', () => {
  const config = loadConfig({ ...validEnv(), MANAWG_HTTP_HOST: '0.0.0.0' });

  expect(config.transport).toBe('stdio');
  expect(config.http.apiKey).toBeUndefined();
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
