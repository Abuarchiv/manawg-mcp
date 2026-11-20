import { request as httpRequest } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createHttpHandler,
  type HttpServerOptions,
  type RunningHttpServer,
  startHttpServer,
} from '../src/http.js';
import type { ManaWgClient } from '../src/manawg-client.js';
import { buildServer, SERVER_DESCRIPTION, SERVER_ICONS } from '../src/server.js';
import { selectTools, TOOL_DEFS } from '../src/tools/registry.js';
import { useCleanup } from './helpers/app.js';

const later = useCleanup();

function fakeClient(): ManaWgClient {
  return { call: vi.fn().mockResolvedValue({ items: [] }) };
}

async function startHttp(options: Partial<HttpServerOptions> = {}): Promise<RunningHttpServer> {
  const running = await startHttpServer({
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    drainMs: 0,
    auth: { kind: 'open' },
    createServer: () => buildServer(fakeClient()),
    ...options,
  });
  later(running.close);
  return running;
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const dataLine = trimmed
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data:'));
  if (!dataLine) {
    throw new Error(`No JSON or SSE data in response: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(dataLine.slice('data:'.length));
}

async function rpc(
  running: RunningHttpServer,
  body: unknown,
  init: RequestInit = {},
): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(running.url, {
    ...init,
    method: 'POST',
    headers: { ...MCP_HEADERS, ...init.headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, payload: text ? parseBody(text) : undefined };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'manawg-mcp-http-test', version: '0.0.0' },
  },
};

it('serves a health probe without credentials', async () => {
  const running = await startHttp();
  const response = await fetch(`${running.origin}/health`);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ status: 'ok', name: 'manawg-mcp' });
});

it('answers HEAD without a body on every path', async () => {
  const handler = createHttpHandler({
    path: '/mcp',
    auth: { kind: 'open' },
    createServer: () => buildServer(fakeClient()),
  });

  for (const path of ['/health', '/missing']) {
    const response = await handler.fetch(
      new Request(`http://localhost${path}`, { method: 'HEAD' }),
    );
    expect(response.body).toBeNull();
  }
});

it('brackets an IPv6 bind address in the URLs it reports', async () => {
  const running = await startHttp({ host: '::1' });

  expect(running.url).toBe(`http://[::1]:${running.port}/mcp`);
  expect((await fetch(`${running.origin}/health`)).status).toBe(200);
});

it('serves initialize and tools/list over http', async () => {
  const running = await startHttp();

  const init = await rpc(running, INITIALIZE);
  expect(init.status).toBe(200);
  expect(init.payload).toMatchObject({ jsonrpc: '2.0', id: 1 });

  const tools = await rpc(running, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  expect(tools.status).toBe(200);
  const list = tools.payload as { result?: { tools?: Array<{ name: string }> } };
  expect(list.result?.tools).toHaveLength(selectTools(TOOL_DEFS, false).length);
});

it('names the server, its website and description at initialize', async () => {
  const running = await startHttp();

  const init = await rpc(running, INITIALIZE);

  expect(init.payload).toMatchObject({
    result: {
      serverInfo: {
        name: 'manawg-mcp',
        title: 'ManaWG',
        websiteUrl: 'https://manawg.com',
        description: SERVER_DESCRIPTION,
        icons: SERVER_ICONS,
      },
    },
  });
});

it('lets 2026-07-28 clients cache the static lists for an hour, but not flat data', async () => {
  const running = await startHttp();
  const client = new Client(
    { name: 'manawg-mcp-cache-test', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(running.url)));
  later(() => client.close());
  const hint = ({ ttlMs, cacheScope }: Record<string, unknown>) => ({
    ttlMs,
    cacheScope,
  });

  const hour = { ttlMs: 3_600_000, cacheScope: 'public' };
  expect(hint(await client.listTools())).toEqual(hour);
  expect(hint(await client.listPrompts())).toEqual(hour);
  expect(hint(await client.listResourceTemplates())).toEqual(hour);
  // Resource lists carry the member's own entities.
  expect(hint(await client.listResources())).toEqual({ ttlMs: 0, cacheScope: 'private' });
});

it('guards the mcp endpoint with a bearer api key and leaves health open', async () => {
  const apiKey = 'deploy-secret-0123456789';
  const running = await startHttp({ auth: { kind: 'api-key', apiKey } });

  const health = await fetch(`${running.origin}/health`);
  expect(health.status).toBe(200);

  const anonymous = await rpc(running, INITIALIZE);
  expect(anonymous.status).toBe(401);
  expect(anonymous.payload).toEqual({ error: 'unauthorized' });

  const wrong = await rpc(running, INITIALIZE, { headers: { authorization: 'Bearer wrong' } });
  expect(wrong.status).toBe(401);

  const authorized = await rpc(running, INITIALIZE, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  expect(authorized.status).toBe(200);
});

it('answers unknown paths with 404', async () => {
  const running = await startHttp({
    auth: { kind: 'api-key', apiKey: 'deploy-secret-0123456789' },
  });

  const response = await fetch(`${running.origin}/secret-path`);

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: 'not_found' });
});

it('reports /ready as 200 before and 503 while draining', async () => {
  const running = await startHttp({ drainMs: 500 });

  const before = await fetch(`${running.origin}/ready`);
  expect(before.status).toBe(200);

  const draining = running.close();
  const during = await fetch(`${running.origin}/ready`);
  expect(during.status).toBe(503);
  await expect(during.json()).resolves.toEqual({ ready: false });

  await draining;
});

it('answers preflights with the headers asked for', async () => {
  const running = await startHttp({
    cors: true,
    auth: { kind: 'api-key', apiKey: 'k'.repeat(32) },
  });

  const preflight = await fetch(running.url, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://inspector.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, mcp-method, mcp-name',
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
  expect(preflight.headers.get('access-control-allow-headers')).toBe(
    'authorization, mcp-method, mcp-name',
  );
});

it('adds CORS headers to every answer only when enabled', async () => {
  const withCors = await startHttp({ cors: true });
  const health = await fetch(`${withCors.origin}/health`, {
    headers: { origin: 'http://localhost:6274' },
  });
  expect(health.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');

  const withoutCors = await startHttp();
  const plain = await fetch(`${withoutCors.origin}/health`);
  expect(plain.headers.get('access-control-allow-origin')).toBeNull();
});

function rawRequest(
  running: RunningHttpServer,
  headers: Record<string, string>,
  method = 'POST',
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port: running.port, path: '/mcp', method, headers },
      (response) => {
        response.resume();
        response.once('end', () => resolve({ status: response.statusCode ?? 0 }));
      },
    );
    request.once('error', reject);
    request.end(method === 'POST' ? JSON.stringify(INITIALIZE) : undefined);
  });
}

it('answers a malformed Host header with 400 instead of crashing', async () => {
  const running = await startHttp();

  const malformed = await rawRequest(running, { host: 'a b' }, 'GET');

  expect(malformed.status).toBe(400);
  expect((await fetch(`${running.origin}/health`)).status).toBe(200);
});

it('rejects a foreign Host or Origin on a loopback bind (DNS rebinding)', async () => {
  const running = await startHttp();

  const rebound = await rawRequest(running, { ...MCP_HEADERS, host: 'evil.example' });
  expect(rebound.status).toBe(403);

  const rebindWithPort = await rawRequest(running, {
    ...MCP_HEADERS,
    host: `evil.example:${running.port}`,
  });
  expect(rebindWithPort.status).toBe(403);

  const foreignOrigin = await rawRequest(running, {
    ...MCP_HEADERS,
    host: `127.0.0.1:${running.port}`,
    origin: 'https://evil.example',
  });
  expect(foreignOrigin.status).toBe(403);

  const local = await rawRequest(running, { ...MCP_HEADERS, host: `127.0.0.1:${running.port}` });
  expect(local.status).toBe(200);

  const localhost = await rawRequest(running, {
    ...MCP_HEADERS,
    host: `localhost:${running.port}`,
    origin: `http://localhost:${running.port}`,
  });
  expect(localhost.status).toBe(200);
});

it('accepts the public Host of a reverse proxy in front of a loopback bind with an API key', async () => {
  const running = await startHttp({ auth: { kind: 'api-key', apiKey: 'k'.repeat(32) } });
  const proxied = await rawRequest(running, {
    ...MCP_HEADERS,
    host: 'mcp.example.org',
    authorization: `Bearer ${'k'.repeat(32)}`,
  });
  expect(proxied.status).toBe(200);
});

it('keeps the Origin check on a loopback bind when CORS is on and no key is set', async () => {
  const cors = await startHttp({ cors: true });
  const preflight = (origin: string) =>
    fetch(cors.url, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST' },
    });
  const foreign = await preflight('https://evil.example');
  expect(foreign.status).toBe(403);
  expect(foreign.headers.get('access-control-allow-origin')).toBeNull();

  const local = await preflight('http://localhost:6274');
  expect(local.status).toBe(204);
  expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');

  const rebound = await rawRequest(cors, { ...MCP_HEADERS, host: 'evil.example' });
  expect(rebound.status).toBe(403);
});

it('lets any origin call an endpoint that needs an API key when CORS is on', async () => {
  const apiKey = 'deploy-secret-0123456789';
  const running = await startHttp({ cors: true, auth: { kind: 'api-key', apiKey } });
  const answer = await rpc(running, INITIALIZE, {
    headers: { origin: 'https://inspector.example', authorization: `Bearer ${apiKey}` },
  });
  expect(answer.status).toBe(200);
  const preflight = await fetch(running.url, {
    method: 'OPTIONS',
    headers: { origin: 'https://inspector.example' },
  });
  expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('aborts the request signal when the client disconnects', { timeout: 5_000 }, async () => {
  const entered = deferred();
  const aborted = deferred();
  const running = await startHttp({
    createServer: () => {
      const server = new McpServer({ name: 'hang', version: '0.0.0' });
      server.registerTool('hang', { inputSchema: z.object({}) }, async (_args, ctx) => {
        entered.resolve();
        ctx.mcpReq.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        await aborted.promise;
        return { content: [{ type: 'text', text: 'done' }] };
      });
      return server;
    },
  });

  const request = httpRequest({
    host: '127.0.0.1',
    port: running.port,
    path: '/mcp',
    method: 'POST',
    headers: MCP_HEADERS,
  });
  request.on('error', () => undefined);
  request.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'hang', arguments: {} },
    }),
  );
  await entered.promise;
  request.destroy();

  await aborted.promise;
});
