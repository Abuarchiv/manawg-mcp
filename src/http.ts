import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpServerFactory,
  type OAuthTokenVerifier,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { isLoopbackHost, type OAuthConfig } from './config.js';
import { createDiscovery, protectedResourceMetadataUrl } from './oauth.js';
import { serverVersion } from './version.js';

/** How the MCP endpoint authenticates callers. */
export type HttpAuth =
  | { kind: 'open' }
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'oauth'; oauth: OAuthConfig; verifier: OAuthTokenVerifier; fetchImpl?: typeof fetch };

export type HttpHandlerOptions = {
  path: string;
  auth: HttpAuth;
  cors?: boolean;
  /**
   * Accept only loopback Host (and, without CORS, Origin) values, so a web page cannot reach a
   * local server through DNS rebinding.
   */
  localOnly?: boolean;
  createServer: McpServerFactory;
  onServerError?: (error: Error) => void;
};

/** The whole HTTP surface as a web-standard handler: Node, Docker and Vercel share it. */
export type HttpHandler = {
  fetch: (request: Request) => Promise<Response>;
  setReady: (ready: boolean) => void;
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

function json(status: number, payload: unknown, head = false, headers: HeadersInit = {}): Response {
  return new Response(head ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function apiKeyMatches(header: string | null, apiKey: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest();
  const expected = createHash('sha256').update(apiKey).digest();
  return timingSafeEqual(presented, expected);
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', 'www-authenticate, mcp-session-id');
  headers.append('vary', 'origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createHttpHandler(options: HttpHandlerOptions): HttpHandler {
  const handler = createMcpHandler(options.createServer, {
    legacy: 'stateless',
    onerror: (error) => options.onServerError?.(error),
  });
  const { auth } = options;
  const health = {
    status: 'ok',
    name: 'manawg-mcp',
    version: serverVersion(),
    transport: 'http',
    auth: auth.kind,
    mcpPath: options.path,
  };
  const discovery =
    auth.kind === 'oauth' ? createDiscovery(auth.oauth, auth.fetchImpl ?? fetch) : undefined;
  const bearerGate =
    auth.kind === 'oauth'
      ? requireBearerAuth({
          verifier: auth.verifier,
          resourceMetadataUrl: protectedResourceMetadataUrl(auth.oauth),
        })
      : undefined;
  let ready = true;

  async function serveMcp(request: Request): Promise<Response> {
    if (options.localOnly) {
      // With CORS on, the operator allows browser pages from any origin; the Host check stays.
      const rejected =
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        (options.cors ? undefined : originValidationResponse(request, localhostAllowedOrigins()));
      if (rejected) {
        return rejected;
      }
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': CORS_ALLOW_METHODS,
          'access-control-allow-headers': CORS_ALLOW_HEADERS,
          'access-control-max-age': '600',
        },
      });
    }
    if (
      auth.kind === 'api-key' &&
      !apiKeyMatches(request.headers.get('authorization'), auth.apiKey)
    ) {
      return json(401, { error: 'unauthorized' }, false, {
        'www-authenticate': 'Bearer realm="manawg-mcp"',
      });
    }
    if (bearerGate) {
      const verified = await bearerGate(request);
      if (verified instanceof Response) {
        return verified;
      }
      return handler.fetch(request, { authInfo: verified });
    }
    return handler.fetch(request);
  }

  async function route(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const head = request.method === 'HEAD';
    if (pathname === '/health') {
      return json(200, health, head);
    }
    if (pathname === '/ready') {
      return json(ready ? 200 : 503, { ready }, head);
    }
    if (pathname === options.path) {
      return serveMcp(request);
    }
    const document = await discovery?.(request, pathname);
    return document ?? json(404, { error: 'not_found' });
  }

  return {
    fetch: async (request) => {
      const response = await route(request);
      return options.cors ? withCors(response) : response;
    },
    setReady: (value) => {
      ready = value;
    },
    close: () => handler.close(),
  };
}

export type HttpServerOptions = HttpHandlerOptions & {
  host: string;
  port: number;
  drainMs?: number;
};

export type RunningHttpServer = {
  server: Server;
  url: string;
  port: number;
  /** Stops accepting connections and reports `/ready` as 503 for the drain window. */
  beginShutdown: () => Promise<void>;
  close: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function toWebRequest(request: IncomingMessage, response: ServerResponse, url: URL): Request {
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
  // The response closes when the client goes away; the request closes once its body is read.
  const disconnected = new AbortController();
  response.once('close', () => disconnected.abort());
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: disconnected.signal };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request as unknown as BodyInit;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

/** Resolves when the socket can take more data, or when it is gone. */
function drained(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    if (res.destroyed) {
      resolve();
      return;
    }
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
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
      if (!res.write(Buffer.from(value))) {
        await drained(res);
      }
    }
    res.end();
  } catch {
    res.destroy();
  }
}

/** Node listener around {@link createHttpHandler}, with readiness drain on shutdown. */
export function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const handler = createHttpHandler({
    ...options,
    // Only the keyless mode needs it: with an API key or OAuth a rebound page has no credential,
    // and a loopback bind behind a reverse proxy keeps working.
    localOnly: options.localOnly ?? (options.auth.kind === 'open' && isLoopbackHost(options.host)),
  });
  const drainMs = options.drainMs ?? 5_000;
  const server = createServer((request, response) => {
    let webRequest: Request;
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      webRequest = toWebRequest(request, response, url);
    } catch {
      // A malformed Host or request target must not reach an uncaught exception.
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'bad_request' }));
      return;
    }
    void handler
      .fetch(webRequest)
      .then((answer) => writeResponse(answer, response))
      .catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'internal_error' }));
        } else {
          response.destroy();
        }
        options.onServerError?.(error instanceof Error ? error : new Error(String(error)));
      });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;

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
          handler.setReady(false);
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
        close: beginShutdown,
      });
    });
  });
}
