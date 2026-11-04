import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10_000;
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const DEFAULT_SESSION_CACHE_PATH = join(homedir(), '.config', 'manawg-mcp', 'session.json');

/** Crockford base32 share code, exactly as the app generates it. */
export const SHARE_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** One account signed in by the server itself (stdio, or a private HTTP deployment). */
export type SupabaseAuthConfig = {
  mode: 'session';
  url: string;
  publishableKey: string;
  email?: string;
  password?: string;
  bootstrapRefreshToken?: string;
  sessionCachePath: string;
};

/**
 * Hosted mode: the server is an OAuth 2.1 resource server. Every MCP request carries the
 * user's Supabase access token, which is verified here and forwarded to the app.
 */
export type OAuthConfig = {
  mode: 'oauth';
  supabaseUrl: string;
  /** Supabase Auth issuer, `<supabase>/auth/v1`. */
  issuer: string;
  jwksUrl: string;
  /** RFC 8414 metadata of the issuer, `<supabase>/.well-known/oauth-authorization-server/auth/v1`. */
  metadataUrl: string;
  /** Public URL of the MCP endpoint, the resource identifier clients obtain tokens for. */
  resourceUrl: URL;
};

export type AuthConfig = SupabaseAuthConfig | OAuthConfig;

type TransportName = 'stdio' | 'http';

type HttpTransportConfig = {
  host: string;
  port: number;
  path: string;
  apiKey?: string;
  cors: boolean;
  drainMs: number;
};

export type AppConfig = {
  baseUrl: string;
  origin: string;
  /** Flat used when a tool call names none; without it the account's only flat is used. */
  defaultWgCode?: string;
  timeoutMs: number;
  auth: AuthConfig;
  allowDestructive: boolean;
  transport: TransportName;
  http: HttpTransportConfig;
};

function required(
  env: NodeJS.ProcessEnv,
  name: string,
  errorMessage = `${name} is required`,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(errorMessage);
  }
  return value;
}

function absoluteHttpUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http or https URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an absolute http or https URL`);
  }
  return parsed.href.replace(/\/+$/, '');
}

function loadSessionAuth(env: NodeJS.ProcessEnv, url: string): SupabaseAuthConfig {
  const publishableKey = required(env, 'MANAWG_SUPABASE_PUBLISHABLE_KEY', 'Invalid configuration');

  const bootstrapRefreshToken = env.MANAWG_SUPABASE_REFRESH_TOKEN?.trim();
  if (bootstrapRefreshToken) {
    return {
      mode: 'session',
      url,
      publishableKey,
      bootstrapRefreshToken,
      sessionCachePath: sessionCachePath(env),
    };
  }

  const email = env.MANAWG_EMAIL?.trim();
  const password = env.MANAWG_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error(
      'ManaWG MCP needs either MANAWG_SUPABASE_REFRESH_TOKEN or both MANAWG_EMAIL and MANAWG_PASSWORD',
    );
  }
  return {
    mode: 'session',
    url,
    publishableKey,
    email,
    password,
    sessionCachePath: sessionCachePath(env),
  };
}

function loadOAuth(env: NodeJS.ProcessEnv, supabaseUrl: string, mcpPath: string): OAuthConfig {
  const resourceUrl = new URL(absoluteHttpUrl(env, 'MANAWG_PUBLIC_URL'));
  if (resourceUrl.pathname.replace(/\/+$/, '') !== mcpPath) {
    // Clients discover the endpoint from this URL; any other path ends in a 404.
    throw new Error(`MANAWG_PUBLIC_URL must end in the MCP path ${mcpPath} (MANAWG_HTTP_PATH)`);
  }
  if (env.MANAWG_WG_CODE?.trim()) {
    throw new Error(
      'MANAWG_WG_CODE has no meaning with MANAWG_AUTH=oauth: every user has own flats',
    );
  }
  if (resourceUrl.protocol !== 'https:' && !isLoopbackHost(resourceUrl.hostname)) {
    throw new Error('MANAWG_PUBLIC_URL must use https');
  }
  if (resourceUrl.search || resourceUrl.hash) {
    throw new Error('MANAWG_PUBLIC_URL must not carry a query or fragment');
  }
  const issuer = `${supabaseUrl}/auth/v1`;
  const supabase = new URL(supabaseUrl);
  return {
    mode: 'oauth',
    supabaseUrl,
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    metadataUrl: `${supabase.origin}/.well-known/oauth-authorization-server${supabase.pathname.replace(/\/+$/, '')}/auth/v1`,
    resourceUrl,
  };
}

function authMode(env: NodeJS.ProcessEnv): AuthConfig['mode'] {
  const value = env.MANAWG_AUTH?.trim().toLowerCase();
  if (!value || value === 'session') {
    return 'session';
  }
  if (value === 'oauth') {
    return 'oauth';
  }
  throw new Error('MANAWG_AUTH must be session or oauth');
}

function defaultWgCode(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.MANAWG_WG_CODE?.trim().toUpperCase();
  if (!value) {
    return undefined;
  }
  if (!SHARE_CODE_PATTERN.test(value)) {
    throw new Error('MANAWG_WG_CODE must be the 8-character share code of the flat');
  }
  return value;
}

function sessionCachePath(env: NodeJS.ProcessEnv): string {
  const configured = env.MANAWG_SESSION_CACHE?.trim();
  return configured || DEFAULT_SESSION_CACHE_PATH;
}

function allowDestructive(env: NodeJS.ProcessEnv): boolean {
  const value = env.MANAWG_ALLOW_DESTRUCTIVE?.trim().toLowerCase();
  return value !== undefined && TRUTHY_VALUES.has(value);
}

export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  const version = isIP(bare);
  return (
    bare.toLowerCase() === 'localhost' ||
    (version === 4 && bare.split('.')[0] === '127') ||
    (version === 6 && bare === '::1')
  );
}

const DEFAULT_HTTP: HttpTransportConfig = {
  host: '127.0.0.1',
  port: 8080,
  path: '/mcp',
  cors: false,
  drainMs: 5_000,
};

function transport(env: NodeJS.ProcessEnv): TransportName {
  const value = env.MANAWG_TRANSPORT?.trim().toLowerCase();
  if (!value || value === 'stdio') {
    return 'stdio';
  }
  if (value === 'http') {
    return 'http';
  }
  throw new Error('MANAWG_TRANSPORT must be stdio or http');
}

function httpTransport(env: NodeJS.ProcessEnv): HttpTransportConfig {
  const host = env.MANAWG_HTTP_HOST?.trim() || DEFAULT_HTTP.host;
  if (host.includes('/')) {
    throw new Error('MANAWG_HTTP_HOST must be a host name or address');
  }

  const portRaw = env.MANAWG_HTTP_PORT?.trim();
  let port = DEFAULT_HTTP.port;
  if (portRaw) {
    port = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== portRaw) {
      throw new Error('MANAWG_HTTP_PORT must be an integer between 1 and 65535');
    }
  }

  const path = env.MANAWG_HTTP_PATH?.trim() || DEFAULT_HTTP.path;
  if (!path.startsWith('/') || path.includes('?') || path.endsWith('/')) {
    throw new Error('MANAWG_HTTP_PATH must start with / and must not end with /');
  }

  const apiKey = env.MANAWG_HTTP_API_KEY?.trim();
  if (apiKey && apiKey.length < 16) {
    throw new Error('MANAWG_HTTP_API_KEY must be at least 16 characters long');
  }

  const drainRaw = env.MANAWG_DRAIN_MS?.trim();
  let drainMs = DEFAULT_HTTP.drainMs;
  if (drainRaw) {
    drainMs = Number.parseInt(drainRaw, 10);
    if (
      !Number.isInteger(drainMs) ||
      drainMs < 0 ||
      drainMs > 60_000 ||
      String(drainMs) !== drainRaw
    ) {
      throw new Error('MANAWG_DRAIN_MS must be an integer between 0 and 60000');
    }
  }

  return {
    host,
    port,
    path,
    cors: TRUTHY_VALUES.has(env.MANAWG_HTTP_CORS?.trim().toLowerCase() ?? ''),
    drainMs,
    ...(apiKey ? { apiKey } : {}),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = absoluteHttpUrl(env, 'MANAWG_BASE_URL');
  const origin = new URL(baseUrl).origin;
  const supabaseUrl = absoluteHttpUrl(env, 'MANAWG_SUPABASE_URL');
  const transportName = transport(env);
  const http = httpTransport(env);
  const mode = authMode(env);

  let auth: AuthConfig;
  if (mode === 'oauth') {
    if (transportName !== 'http') {
      throw new Error('MANAWG_AUTH=oauth needs MANAWG_TRANSPORT=http');
    }
    if (http.apiKey) {
      throw new Error('MANAWG_HTTP_API_KEY and MANAWG_AUTH=oauth exclude each other');
    }
    auth = loadOAuth(env, supabaseUrl, http.path);
  } else {
    // One shared account behind an open port would hand it to anyone who can reach the port.
    if (transportName === 'http' && !http.apiKey && !isLoopbackHost(http.host)) {
      throw new Error('MANAWG_HTTP_API_KEY is required when MANAWG_HTTP_HOST is not loopback');
    }
    auth = loadSessionAuth(env, supabaseUrl);
  }

  const wgCode = defaultWgCode(env);
  return {
    baseUrl,
    origin,
    ...(wgCode ? { defaultWgCode: wgCode } : {}),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    auth,
    allowDestructive: allowDestructive(env),
    transport: transportName,
    http,
  };
}
