#!/usr/bin/env node
// Credential-free stdio smoke test: speaks MCP to dist/index.js and checks the advertised surface
// against the registries in dist/. Runs twice, without and with MANAWG_ALLOW_DESTRUCTIVE.
// No upstream request is made. The server starts with placeholder configuration only, so the
// result does not depend on the shell environment or on a local env file (use `pnpm live-check`
// for a real instance).

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const serverPath = join(dist, 'index.js');

const load = (file) => import(pathToFileURL(join(dist, file)).href);
const { TOOL_DEFS, selectTools } = await load('tools/registry.js');
const { RESOURCE_DEFS, RESOURCE_TEMPLATE_DEFS } = await load('resources.js');
const { PROMPT_DEFS } = await load('prompts.js');

function childEnv(allowDestructive) {
  return {
    MANAWG_BASE_URL: 'https://example.invalid',
    MANAWG_SUPABASE_URL: 'https://smoke.supabase.co',
    MANAWG_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_smoke',
    MANAWG_EMAIL: 'smoke@example.test',
    MANAWG_PASSWORD: 'smoke-password',
    MANAWG_SESSION_CACHE: join(tmpdir(), 'manawg-mcp-smoke-session.json'),
    MANAWG_ALLOW_DESTRUCTIVE: allowDestructive ? 'true' : '',
  };
}

async function smoke(allowDestructive) {
  const label = allowDestructive ? 'destructive' : 'default';
  const expectedTools = selectTools(TOOL_DEFS, allowDestructive);
  const expectedNames = expectedTools.map((def) => def.name).sort();
  const accountScoped = new Set(
    TOOL_DEFS.filter((def) => def.scope === 'account').map((def) => def.name),
  );
  const gatedNames = new Set(TOOL_DEFS.filter((def) => def.gate).map((def) => def.name));

  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv(allowDestructive),
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
    console.error(`smoke[${label}]: FAILED ${message}`);
    child.kill();
    process.exit(1);
  }

  try {
    const init = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'manawg-mcp-smoke', version: '0.0.0' },
    });

    if (init?.serverInfo?.name !== 'manawg-mcp') {
      fail(`unexpected serverInfo ${JSON.stringify(init?.serverInfo ?? null)}`);
    }
    if (!init.instructions?.includes('wg_overview')) {
      fail('initialize carries no server instructions');
    }
    console.error(`[${label}] initialize: ok protocol=${init.protocolVersion}`);

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const tools = (await request(2, 'tools/list')).tools ?? [];
    const resources = (await request(3, 'resources/list')).resources ?? [];
    const templates = (await request(5, 'resources/templates/list')).resourceTemplates ?? [];
    const prompts = (await request(4, 'prompts/list')).prompts ?? [];

    const toolNames = tools.map((tool) => tool.name);
    if (new Set(toolNames).size !== toolNames.length) {
      fail('duplicate tool names');
    }
    if (JSON.stringify([...toolNames].sort()) !== JSON.stringify(expectedNames)) {
      fail(
        `expected ${expectedNames.length} tools (${expectedNames.join(',')}), got ${toolNames.length} (${toolNames.join(',')})`,
      );
    }
    const withoutDescription = tools.filter((tool) => !tool.description);
    if (withoutDescription.length > 0) {
      fail(`tools without description: ${withoutDescription.map((tool) => tool.name).join(',')}`);
    }
    const withoutWgCode = tools.filter(
      (tool) => !accountScoped.has(tool.name) && !tool.inputSchema?.properties?.wgCode,
    );
    if (withoutWgCode.length > 0) {
      fail(`flat tools without wgCode: ${withoutWgCode.map((tool) => tool.name).join(',')}`);
    }
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint === true);
    if (allowDestructive) {
      const unmarked = tools.filter(
        (tool) => gatedNames.has(tool.name) && tool.annotations?.destructiveHint !== true,
      );
      if (unmarked.length > 0) {
        fail(`gated tools without destructiveHint: ${unmarked.map((tool) => tool.name).join(',')}`);
      }
    } else if (destructive.length !== 0) {
      fail(`destructive tools registered without opt-in: ${destructive.length}`);
    }
    if (resources.length !== RESOURCE_DEFS.length) {
      fail(`expected ${RESOURCE_DEFS.length} resources, got ${resources.length}`);
    }
    if (templates.length !== RESOURCE_TEMPLATE_DEFS.length) {
      fail(`expected ${RESOURCE_TEMPLATE_DEFS.length} resource templates, got ${templates.length}`);
    }
    if (prompts.length !== PROMPT_DEFS.length) {
      fail(`expected ${PROMPT_DEFS.length} prompts, got ${prompts.length}`);
    }

    console.error(
      `[${label}] tools: ok count=${toolNames.length} destructive=${destructive.length}`,
    );
    console.error(`[${label}] resources: ok count=${resources.length}`);
    console.error(`[${label}] templates: ok count=${templates.length}`);
    console.error(`[${label}] prompts: ok count=${prompts.length}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  child.kill();
}

await smoke(false);
await smoke(true);
console.error('smoke: OK');
