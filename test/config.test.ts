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

it('rejects missing required credentials without echoing their values', () => {
  expect(() => loadConfig({ MANAWG_BASE_URL: 'https://example.test' })).toThrow('MANAWG_WG_CODE');
});

it('accepts a valid configuration and normalizes the base URL', () => {
  expect(loadConfig(validEnv()).baseUrl).toBe('https://example.test');
});
