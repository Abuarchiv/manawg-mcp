import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

function validEnv(): NodeJS.ProcessEnv {
  return {
    MANAWG_BASE_URL: 'https://example.test/',
    MANAWG_WG_CODE: 'WG123',
    MANAWG_MEMBER_ID: '00000000-0000-4000-8000-000000000001',
    MANAWG_MEMBER_TOKEN: 'a'.repeat(64),
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
  delete env.MANAWG_WG_CODE;
  const message = thrownMessage(() => loadConfig(env));

  expect(message).toContain('MANAWG_WG_CODE');
  for (const value of [env.MANAWG_BASE_URL, env.MANAWG_MEMBER_ID, env.MANAWG_MEMBER_TOKEN]) {
    expect(message).not.toContain(value!);
  }
  for (const name of ['MANAWG_MEMBER_ID', 'MANAWG_MEMBER_TOKEN', 'MEMBER_SESSION_SECRET']) {
    expect(message).not.toContain(name);
  }
});

it('does not expose secret names when the member token is missing', () => {
  const env = validEnv();
  delete env.MANAWG_MEMBER_TOKEN;
  const message = thrownMessage(() => loadConfig(env));

  expect(message).not.toContain('MANAWG_MEMBER_TOKEN');
  expect(message).not.toContain('MEMBER_SESSION_SECRET');
});

it('accepts a valid configuration and normalizes the base URL', () => {
  expect(loadConfig(validEnv()).baseUrl).toBe('https://example.test');
});

it('rejects an invalid base URL', () => {
  expect(() => loadConfig({ ...validEnv(), MANAWG_BASE_URL: 'ftp://example.test' })).toThrow();
});

it('rejects an invalid member UUID', () => {
  const env = { ...validEnv(), MANAWG_MEMBER_ID: 'not-a-uuid' };
  const message = thrownMessage(() => loadConfig(env));

  expect(message).not.toContain('MANAWG_MEMBER_ID');
  expect(message).not.toContain(env.MANAWG_MEMBER_ID);
});

it('rejects a non-hexadecimal member token', () => {
  const env = { ...validEnv(), MANAWG_MEMBER_TOKEN: 'g'.repeat(64) };
  const message = thrownMessage(() => loadConfig(env));

  expect(message).not.toContain('MANAWG_MEMBER_TOKEN');
  expect(message).not.toContain(env.MANAWG_MEMBER_TOKEN);
});

it('trims all environment values before returning the configuration', () => {
  expect(
    loadConfig({
      MANAWG_BASE_URL: '  https://example.test/  ',
      MANAWG_WG_CODE: '  WG123  ',
      MANAWG_MEMBER_ID: '  00000000-0000-4000-8000-000000000001  ',
      MANAWG_MEMBER_TOKEN: `  ${'a'.repeat(64)}  `,
    }),
  ).toEqual({
    baseUrl: 'https://example.test',
    wgCode: 'WG123',
    memberId: '00000000-0000-4000-8000-000000000001',
    memberToken: 'a'.repeat(64),
    timeoutMs: 10_000,
  });
});
