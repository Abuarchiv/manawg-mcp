import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpServerFactory,
  type OAuthTokenVerifier,
  originValidationResponse,
  requireBearerAuth,
  validateOriginHeader,
} from '@modelcontextprotocol/server';
import { isLoopbackHost, type OAuthConfig } from './config.js';
import { JSON_CONTENT_TYPE, preflightResponse } from './cors.js';
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

const CORS_ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS';

function json(status: number, payload: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': JSON_CONTENT_TYPE, ...headers },
  });
}

function apiKeyMatches(header: string | null, apiKey: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const presented = createHash('sha256').update(header.slice('Bearer '.length)).digest();
  const expected = createHash('sha256').update(apiKey).digest();
  return timingSafeEqual(presented, expected);
}

/**
 * With a credential (API key, OAuth token) a foreign page has nothing to present, so any origin
 * may call. The keyless mode would hand the signed-in account to every page the user opens:
 * there, only a loopback origin (MCP Inspector on localhost) is echoed back.
 */
function allowedOrigin(request: Request, auth: HttpAuth): string | undefined {
  if (auth.kind !== 'open') return '*';
  const origin = request.headers.get('origin');
  return origin && validateOriginHeader(origin, localhostAllowedOrigins()).ok ? origin : undefined;
}

function withCors(response: Response, request: Request, auth: HttpAuth): Response {
  const headers = new Headers(response.headers);
  const origin = allowedOrigin(request, auth);
  if (origin) {
    headers.set('access-control-allow-origin', origin);
  }
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
    onerror: options.onServerError,
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
      const rejected =
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins());
      if (rejected) {
        return rejected;
      }
    }
    if (request.method === 'OPTIONS') {
      return preflightResponse(request, CORS_ALLOW_METHODS);
    }
    if (
      auth.kind === 'api-key' &&
      !apiKeyMatches(request.headers.get('authorization'), auth.apiKey)
    ) {
      return json(
        401,
        { error: 'unauthorized' },
        {
          'www-authenticate': 'Bearer realm="manawg-mcp"',
        },
      );
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
    if (pathname === '/health') {
      return json(200, health);
    }
    if (pathname === '/ready') {
      return json(ready ? 200 : 503, { ready });
    }
    if (pathname === options.path) {
      return serveMcp(request);
    }
    const document = await discovery?.(request, pathname);
    return document ?? json(404, { error: 'not_found' });
  }

  return {
    fetch: async (request) => {
      let response = await route(request);
      if (request.method === 'HEAD') {
        response = new Response(null, response);
      }
      return options.cors ? withCors(response, request, auth) : response;
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
  drainMs: number;
};

export type RunningHttpServer = {
  /** The MCP endpoint, for example `http://127.0.0.1:8080/mcp`. */
  url: string;
  /** Scheme, host and port without the path. */
  origin: string;
  port: number;
  /** Reports `/ready` as 503 for the drain window, then stops accepting and closes connections. */
  close: () => Promise<void>;
};

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

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, [...response.headers].flat());
  if (!response.body) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), res);
  } catch (error) {
    // The client going away mid-stream is routine; anything else is a failure of the response.
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      throw error;
    }
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
  const server = createServer((request, response) => {
    let webRequest: Request;
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      webRequest = toWebRequest(request, response, url);
    } catch {
      // A malformed Host or request target must not reach an uncaught exception.
      response.writeHead(400, { 'content-type': JSON_CONTENT_TYPE });
      response.end(JSON.stringify({ error: 'bad_request' }));
      return;
    }
    void handler
      .fetch(webRequest)
      .then((answer) => writeResponse(answer, response))
      .catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
        } else {
          response.writeHead(500, { 'content-type': JSON_CONTENT_TYPE });
          response.end(JSON.stringify({ error: 'internal_error' }));
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
      const { port } = server.address() as AddressInfo;
      const host = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;
      const origin = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
      let shutdown: Promise<void> | undefined;
      resolve({
        port,
        origin,
        url: origin + options.path,
        close: () => {
          shutdown ??= (async () => {
            handler.setReady(false);
            if (options.drainMs > 0) {
              // Still accepting: the readiness probe has to answer 503 first.
              await sleep(options.drainMs);
            }
            const stopped = new Promise<void>((done) => server.close(() => done()));
            server.closeIdleConnections();
            await handler.close();
            server.closeAllConnections();
            await stopped;
          })();
          return shutdown;
        },
      });
    });
  });
}
