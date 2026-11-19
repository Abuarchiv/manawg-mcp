#!/usr/bin/env node
// Read-only connectivity check against a real ManaWG deployment.
// Prints status only, never credential, token or share-code values. Reads the env file given by
// MANAWG_ENV_FILE, default ~/.config/manawg-mcp/env; variables already set in the shell win.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSessionController } from '../dist/auth.js';
import { loadConfig } from '../dist/config.js';
import { ManaWgError } from '../dist/errors.js';
import { createManaWgClient, sessionCredentials } from '../dist/manawg-client.js';

function mask(value) {
  if (!value) {
    return '<unset>';
  }
  return `${value.slice(0, 2)}***${value.slice(-1)}`;
}

function describe(error) {
  if (error instanceof ManaWgError) {
    return `code=${error.code} status=${error.status}`;
  }
  // The session controller signs in with a plain Error whose message is already safe to print.
  if (error instanceof Error && error.message === 'auth_failed') {
    return 'code=auth_failed';
  }
  if (error instanceof Error) {
    return `unexpected=${error.name}`;
  }
  return 'unexpected=unknown';
}

const envPath = process.env.MANAWG_ENV_FILE || join(homedir(), '.config', 'manawg-mcp', 'env');
let loaded = true;
try {
  process.loadEnvFile(envPath);
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
  loaded = false;
}

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`config_error: ${error instanceof Error ? error.message : 'unknown'}`);
  process.exit(1);
}

if (config.auth.mode !== 'session') {
  console.error('config_error: live-check signs in itself; run it with MANAWG_AUTH=session');
  process.exit(1);
}

console.log(`env_file: ${loaded ? 'loaded' : 'missing'} path=${envPath}`);
console.log(`base_url: ${new URL(config.baseUrl).host}`);
console.log(
  `wg_code: ${config.defaultWgCode ? mask(config.defaultWgCode) : 'only flat of the account'}`,
);
console.log(`auth_mode: ${config.auth.bootstrapRefreshToken ? 'refresh_token' : 'password'}`);
console.log(`destructive_tools: ${config.allowDestructive ? 'enabled' : 'disabled'}`);

const auth = createSessionController(config.auth);
const client = createManaWgClient(config, fetch, sessionCredentials(auth));

async function reach(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 500) {
    throw new ManaWgError(`upstream_http_${response.status}`, response.status);
  }
  return `status=${response.status}`;
}

const probes = [
  ['app_reachable', () => reach(config.baseUrl)],
  [
    'supabase_reachable',
    () => reach(`${config.auth.url}/auth/v1/health`, { apikey: config.auth.publishableKey }),
  ],
  ['session', async () => `${(await auth.cookieHeader()).length} chars`],
  ['wg_list', () => client.call({ path: ['mine'], scope: 'account' })],
  ['wg_overview', () => client.call({ path: [] })],
  ['dashboard', () => client.call({ path: ['dashboard'] })],
  ['shopping', () => client.call({ path: ['shopping'] })],
  ['expenses', () => client.call({ path: ['expenses'] })],
  ['members', () => client.call({ path: ['members'], query: { limit: 5, offset: 0 } })],
  ['chat_messages', () => client.call({ path: ['chat', 'messages'], query: { limit: 5 } })],
  ['chores', () => client.call({ path: ['chores'] })],
  ['inventory', () => client.call({ path: ['inventory'] })],
  ['events', () => client.call({ path: ['events'] })],
  ['notes', () => client.call({ path: ['announcements'] })],
  ['recurring', () => client.call({ path: ['recurring-expenses'] })],
];

let failed = false;
for (const [name, run] of probes) {
  try {
    const result = await run();
    const detail = typeof result === 'string' ? result : `${JSON.stringify(result).length} bytes`;
    console.log(`${name}: ok ${detail}`);
  } catch (error) {
    failed = true;
    console.error(`${name}: failed ${describe(error)}`);
  }
}

console.log(failed ? 'live_check: FAILED' : 'live_check: OK');
process.exit(failed ? 1 : 0);
