import { createHash, timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { type McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { serverVersion } from './server.js';

export type HttpServerOptions = {
  host: string;
  port: number;
  path: string;
  apiKey?: string;
  cors?: boolean;
  drainMs?: number;
  createServer: () => McpServer;
  onServerError?: (error: Error) => void;
};

export type RunningHttpServer = {
  server: Server;
  url: string;
  port: number;
  /** Stops accepting connections and reports `/ready` as 503 for the drain window. */
  beginShutdown: () => Promise<void>;
  close: () => Promise<void>;
};

const CORS_ALLOW_HEADERS = [
  'content-type',
  'authorization',
  'accept',
  'mcp-protocol-version',
  'mcp-session-id',
].join(', ');
const CORS_ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown, head = false): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(body)) });
  res.end(head ? undefined : body);
}

function toWebRequest(request: IncomingMessage, url: URL): Request {
  const method = request.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request as unknown as BodyInit;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (res.hasHeader(name)) return;
    res.setHeader(name, value);
  });

  if (!response.body || res.destroyed) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      if (res.destroyed) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch {
    res.destroy();
  }
}

function apiKeyMatches(header: string | undefined, apiKey: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest();
  const expected = createHash('sha256').update(apiKey).digest();
  return timingSafeEqual(presented, expected);
}

export function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const handler = createMcpHandler(() => options.createServer(), {
    legacy: 'stateless',
    onerror: (error) => options.onServerError?.(error),
  });
  const health = {
    status: 'ok',
    name: 'manawg-mcp',
    version: serverVersion(),
    transport: 'http',
    mcpPath: options.path,
  };

  let ready = true;
  const drainMs = options.drainMs ?? 5_000;
  const server = createServer((request, response) => {
    void serve(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'internal_error' });
      } else {
        response.destroy();
      }
      options.onServerError?.(error instanceof Error ? error : new Error(String(error)));
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (options.cors) {
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('vary', 'origin');
    }

    if (pathname === '/health') {
      sendJson(response, 200, health, request.method === 'HEAD');
      return;
    }

    if (pathname === '/ready') {
      sendJson(response, ready ? 200 : 503, { ready }, request.method === 'HEAD');
      return;
    }

    if (pathname === options.path) {
      if (request.method === 'OPTIONS') {
        response.setHeader('access-control-allow-methods', CORS_ALLOW_METHODS);
        response.setHeader('access-control-allow-headers', CORS_ALLOW_HEADERS);
        response.setHeader('access-control-max-age', '600');
        response.writeHead(204);
        response.end();
        return;
      }
      if (options.apiKey && !apiKeyMatches(request.headers.authorization, options.apiKey)) {
        response.setHeader('www-authenticate', 'Bearer realm="manawg-mcp"');
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }
      await writeResponse(await handler.fetch(toWebRequest(request, url)), response);
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  }

  return new Promise<RunningHttpServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      const displayHost =
        options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;
      let shutdown: Promise<void> | undefined;
      const beginShutdown = (): Promise<void> => {
        shutdown ??= (async () => {
          ready = false;
          if (drainMs > 0) {
            // Still accepting: the readiness probe has to answer 503 first.
            await sleep(drainMs);
          }
          const stopped = new Promise<void>((done) => server.close(() => done()));
          server.closeIdleConnections?.();
          await handler.close();
          server.closeAllConnections?.();
          await stopped;
        })();
        return shutdown;
      };
      resolve({
        server,
        port,
        url: `http://${displayHost}:${port}${options.path}`,
        beginShutdown,
        close: async () => {
          await beginShutdown();
        },
      });
    });
  });
}
