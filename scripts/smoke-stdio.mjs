#!/usr/bin/env node
// Credential-free stdio smoke test: speaks MCP to dist/index.js and checks the
// advertised surface. No upstream request is made, so no credentials are needed.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'dist', 'index.js');

const EXPECTED_TOOLS = 54;
const EXPECTED_RESOURCES = 13;
const EXPECTED_TEMPLATES = 4;
const EXPECTED_PROMPTS = 4;

function placeholderEnv() {
  return {
    MANAWG_BASE_URL: 'https://example.invalid',
    MANAWG_WG_CODE: 'SMOKE0000',
    MANAWG_MEMBER_ID: '00000000-0000-4000-8000-000000000000',
    MANAWG_MEMBER_TOKEN: 'a'.repeat(64),
    MANAWG_SUPABASE_URL: 'https://smoke.supabase.co',
    MANAWG_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_smoke',
    MANAWG_EMAIL: 'smoke@example.test',
    MANAWG_PASSWORD: 'smoke-password',
  };
}

function childEnv() {
  const env = placeholderEnv();
  const envPath = process.env.MANAWG_ENV_FILE || join(homedir(), '.config', 'manawg-mcp', 'env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[2]) {
        env[match[1]] = match[2];
      }
    }
    console.error(`env_file: loaded ${envPath}`);
  } catch {
    console.error('env_file: missing, using offline placeholders');
  }
  env.MANAWG_SESSION_CACHE = join(tmpdir(), 'manawg-mcp-smoke-session.json');
  env.MANAWG_ALLOW_DESTRUCTIVE = '';
  return env;
}

const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ...childEnv() },
});

let buffer = '';
const pending = new Map();
const diagnostics = [];

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (!line) {
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      diagnostics.push(`unparsable line: ${line.slice(0, 80)}`);
      continue;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  diagnostics.push(`stderr: ${chunk.trim().slice(0, 200)}`);
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(`${method}: ${message.error.message ?? 'error'}`));
        return;
      }
      resolve(message.result);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function fail(message) {
  for (const line of diagnostics) {
    console.error(line);
  }
  console.error(`smoke: FAILED ${message}`);
  child.kill();
  process.exit(1);
}

const init = await request(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'manawg-mcp-smoke', version: '0.0.0' },
});

if (init?.serverInfo?.name !== 'manawg-mcp') {
  fail(`unexpected serverInfo ${JSON.stringify(init?.serverInfo ?? null)}`);
}
console.error(`initialize: ok protocol=${init.protocolVersion}`);

send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const tools = await request(2, 'tools/list');
const resources = await request(3, 'resources/list');
const templates = await request(5, 'resources/templates/list');
let promptCount = 0;
try {
  const prompts = await request(4, 'prompts/list');
  promptCount = (prompts.prompts ?? []).length;
} catch (error) {
  if (!String(error.message).includes('Method not found')) {
    fail(String(error.message));
  }
}

const toolNames = (tools.tools ?? []).map((tool) => tool.name);
const withoutDescription = (tools.tools ?? []).filter((tool) => !tool.description);
const destructive = (tools.tools ?? []).filter(
  (tool) => tool.annotations?.destructiveHint === true,
);

if (toolNames.length !== EXPECTED_TOOLS) {
  fail(`expected ${EXPECTED_TOOLS} tools, got ${toolNames.length}`);
}
if (new Set(toolNames).size !== toolNames.length) {
  fail('duplicate tool names');
}
if (withoutDescription.length > 0) {
  fail(`tools without description: ${withoutDescription.map((tool) => tool.name).join(',')}`);
}
if (destructive.length !== 0) {
  fail(`destructive tools registered without opt-in: ${destructive.length}`);
}
if ((resources.resources ?? []).length !== EXPECTED_RESOURCES) {
  fail(`expected ${EXPECTED_RESOURCES} resources, got ${(resources.resources ?? []).length}`);
}
if ((templates.resourceTemplates ?? []).length !== EXPECTED_TEMPLATES) {
  fail(
    `expected ${EXPECTED_TEMPLATES} resource templates, got ${(templates.resourceTemplates ?? []).length}`,
  );
}
if (promptCount !== EXPECTED_PROMPTS) {
  fail(`expected ${EXPECTED_PROMPTS} prompts, got ${promptCount}`);
}

console.error(`tools: ok count=${toolNames.length} gated_destructive=absent`);
console.error(`resources: ok count=${(resources.resources ?? []).length}`);
console.error(`templates: ok count=${(templates.resourceTemplates ?? []).length}`);
console.error(`prompts: ok count=${promptCount}`);
console.error('smoke: OK');
child.kill();
process.exit(0);
