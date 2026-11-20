#!/usr/bin/env node
// Credential-free stdio smoke test: speaks MCP to dist/index.js and checks the advertised surface
// against the registries in dist/. Runs twice, without and with MANAWG_ALLOW_DESTRUCTIVE.
// No upstream request is made. The server starts with placeholder configuration only, so the
// result does not depend on the shell environment or on a local env file (use `pnpm live-check`
// for a real instance).

import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

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

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: childEnv(allowDestructive),
    stderr: 'pipe',
  });
  const diagnostics = [];
  transport.stderr.setEncoding('utf8');
  transport.stderr.on('data', (chunk) => diagnostics.push(`stderr: ${chunk.trim().slice(0, 200)}`));

  const client = new Client({ name: 'manawg-mcp-smoke', version: '0.0.0' });

  async function fail(message) {
    for (const line of diagnostics) {
      console.error(line);
    }
    console.error(`smoke[${label}]: FAILED ${message}`);
    await client.close();
    process.exit(1);
  }

  try {
    await client.connect(transport);

    const serverInfo = client.getServerVersion();
    if (serverInfo?.name !== 'manawg-mcp') {
      await fail(`unexpected serverInfo ${JSON.stringify(serverInfo ?? null)}`);
    }
    if (!client.getInstructions()?.includes('wg_overview')) {
      await fail('initialize carries no server instructions');
    }
    console.log(`[${label}] initialize: ok`);

    const { tools } = await client.listTools();
    const { resources } = await client.listResources();
    const { resourceTemplates: templates } = await client.listResourceTemplates();
    const { prompts } = await client.listPrompts();

    const toolNames = tools.map((tool) => tool.name);
    if (new Set(toolNames).size !== toolNames.length) {
      await fail('duplicate tool names');
    }
    if (JSON.stringify([...toolNames].sort()) !== JSON.stringify(expectedNames)) {
      await fail(
        `expected ${expectedNames.length} tools (${expectedNames.join(',')}), got ${toolNames.length} (${toolNames.join(',')})`,
      );
    }
    const withoutDescription = tools.filter((tool) => !tool.description);
    if (withoutDescription.length > 0) {
      await fail(
        `tools without description: ${withoutDescription.map((tool) => tool.name).join(',')}`,
      );
    }
    const withoutWgCode = tools.filter(
      (tool) => !accountScoped.has(tool.name) && !tool.inputSchema?.properties?.wgCode,
    );
    if (withoutWgCode.length > 0) {
      await fail(`flat tools without wgCode: ${withoutWgCode.map((tool) => tool.name).join(',')}`);
    }
    const destructive = tools.filter((tool) => tool.annotations?.destructiveHint === true);
    if (allowDestructive) {
      const unmarked = tools.filter(
        (tool) => gatedNames.has(tool.name) && tool.annotations?.destructiveHint !== true,
      );
      if (unmarked.length > 0) {
        await fail(
          `gated tools without destructiveHint: ${unmarked.map((tool) => tool.name).join(',')}`,
        );
      }
    } else if (destructive.length !== 0) {
      await fail(`destructive tools registered without opt-in: ${destructive.length}`);
    }
    if (resources.length !== RESOURCE_DEFS.length) {
      await fail(`expected ${RESOURCE_DEFS.length} resources, got ${resources.length}`);
    }
    if (templates.length !== RESOURCE_TEMPLATE_DEFS.length) {
      await fail(
        `expected ${RESOURCE_TEMPLATE_DEFS.length} resource templates, got ${templates.length}`,
      );
    }
    if (prompts.length !== PROMPT_DEFS.length) {
      await fail(`expected ${PROMPT_DEFS.length} prompts, got ${prompts.length}`);
    }

    console.log(`[${label}] tools: ok count=${toolNames.length} destructive=${destructive.length}`);
    console.log(`[${label}] resources: ok count=${resources.length}`);
    console.log(`[${label}] templates: ok count=${templates.length}`);
    console.log(`[${label}] prompts: ok count=${prompts.length}`);
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
  await client.close();
}

await smoke(false);
await smoke(true);
console.log('smoke: OK');
