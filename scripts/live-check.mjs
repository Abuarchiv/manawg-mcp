#!/usr/bin/env node
// Read-only connectivity check against a real ManaWG deployment.
// Prints status only — never credential, token or share-code values.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSessionController } from '../dist/auth.js';
import { loadConfig } from '../dist/config.js';
import { ManaWgError, createManaWgClient } from '../dist/manawg-client.js';

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
    return true;
  } catch {
    return false;
  }
}

function mask(value) {
  if (!value) {
    return '<unset>';
  }
  return `${value.slice(0, 2)}***${value.slice(-1)}`;
}

const SAFE_MESSAGES = new Set(['auth_failed', 'upstream_network_error']);

function describe(error) {
  if (error instanceof ManaWgError) {
    return `code=${error.code} status=${error.status}`;
  }
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) {
    return `code=${error.message}`;
  }
  if (error instanceof Error) {
    return `unexpected=${error.name}`;
  }
  return 'unexpected=unknown';
}

const envPath = process.env.MANAWG_ENV_FILE || join(homedir(), '.config', 'manawg-mcp', 'env');
const loaded = loadEnvFile(envPath);

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(`config_error: ${error instanceof Error ? error.message : 'unknown'}`);
  process.exit(1);
}

console.error(`env_file: ${loaded ? 'loaded' : 'missing'} path=${envPath}`);
console.error(`base_url: ${new URL(config.baseUrl).host}`);
console.error(`wg_code: ${mask(config.wgCode)}`);
console.error(`auth_mode: ${config.auth.bootstrapRefreshToken ? 'refresh_token' : 'password'}`);
console.error(`destructive_tools: ${config.allowDestructive ? 'enabled' : 'disabled'}`);

function memberIdSource() {
  if (config.memberId) {
    return config.memberId;
  }
  try {
    const cached = JSON.parse(readFileSync(config.identityCachePath, 'utf8'));
    if (typeof cached?.memberId === 'string') {
      return cached.memberId;
    }
  } catch {
    // No bootstrap cache yet.
  }
  return undefined;
}

const auth = createSessionController(config.auth);
const client = createManaWgClient(config, fetch, auth);

async function reach(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 500) {
    throw new Error(`upstream status ${response.status}`);
  }
  return `status=${response.status}`;
}

const probes = [
  ['app_reachable', () => reach(config.baseUrl)],
  [
    'supabase_reachable',
    () => reach(`${config.auth.url}/auth/v1/health`, { apikey: config.auth.publishableKey }),
  ],
  ['session', () => auth.cookieHeader()],
  ['wg_overview', () => client.call({ path: [] })],
  ['dashboard', () => client.call({ path: ['dashboard'] })],
  ['shopping', () => client.call({ path: ['shopping'] })],
  ['expenses', () => client.call({ path: ['expenses'] })],
  ['members', () => client.call({ path: ['members'], query: { limit: 5, offset: 0 } })],
  ['chat_messages', () => client.call({ path: ['chat', 'messages'], query: { limit: 5 } })],
];

let failed = false;
for (const [name, run] of probes) {
  try {
    const result = await run();
    const detail =
      name === 'session'
        ? `${String(result).length} chars`
        : typeof result === 'string'
          ? result
          : `${JSON.stringify(result ?? {}).length} bytes`;
    console.error(`${name}: ok ${detail}`);
  } catch (error) {
    failed = true;
    console.error(`${name}: failed ${describe(error)}`);
  }
}

console.error(`member_id: ${mask(memberIdSource())}`);
console.error(failed ? 'live_check: FAILED' : 'live_check: OK');
process.exit(failed ? 1 : 0);
