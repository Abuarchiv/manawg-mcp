import { afterEach, expect, it, vi } from 'vitest';
import { type HttpServerOptions, type RunningHttpServer, startHttpServer } from '../src/http.js';
import { buildServer } from '../src/server.js';

type FakeClient = { call: ReturnType<typeof vi.fn> };

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

function fakeClient(payload: unknown = { items: [] }): FakeClient {
  return { call: vi.fn().mockResolvedValue(payload) };
}

async function startHttp(options: Partial<HttpServerOptions> = {}): Promise<RunningHttpServer> {
  const running = await startHttpServer({
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    createServer: () => buildServer(fakeClient()),
    ...options,
  });
  cleanup.push(running.close);
  return running;
}

function originOf(running: RunningHttpServer): string {
  return running.url.slice(0, running.url.length - '/mcp'.length);
}

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
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(init.headers ?? {}),
    },
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
  const response = await fetch(`${originOf(running)}/health`);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ status: 'ok', name: 'manawg-mcp' });
});

it('serves initialize and tools/list over http', async () => {
  const running = await startHttp();

  const init = await rpc(running, INITIALIZE);
  expect(init.status).toBe(200);
  expect(init.payload).toMatchObject({ jsonrpc: '2.0', id: 1 });

  const tools = await rpc(running, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  expect(tools.status).toBe(200);
  const list = tools.payload as { result?: { tools?: Array<{ name: string }> } };
  expect(list.result?.tools?.length).toBeGreaterThanOrEqual(50);
});

it('guards the mcp endpoint with a bearer api key and leaves health open', async () => {
  const apiKey = 'deploy-secret-0123456789';
  const running = await startHttp({ apiKey });

  const health = await fetch(`${originOf(running)}/health`);
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

it('answers unknown paths with 404 and never leaks configuration', async () => {
  const running = await startHttp({ apiKey: 'deploy-secret-0123456789' });

  const response = await fetch(`${originOf(running)}/secret-path`);

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: 'not_found' });
});

it('reports the mcp endpoint in the health payload', async () => {
  const running = await startHttp();

  const payload = (await (await fetch(`${originOf(running)}/health`)).json()) as {
    mcpPath: string;
    version: string;
  };

  expect(payload.mcpPath).toBe('/mcp');
  expect(payload.version).toMatch(/^\d+\.\d+\.\d+/);
});
