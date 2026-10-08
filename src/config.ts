import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10_000;
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const DEFAULT_SESSION_CACHE_PATH = join(homedir(), '.config', 'manawg-mcp', 'session.json');
export type SupabaseAuthConfig = {
  url: string;
  publishableKey: string;
  email?: string;
  password?: string;
  bootstrapRefreshToken?: string;
  sessionCachePath: string;
};

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
  wgCode: string;
  timeoutMs: number;
  auth: SupabaseAuthConfig;
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

function loadAuthConfig(env: NodeJS.ProcessEnv): SupabaseAuthConfig {
  const url = absoluteHttpUrl(env, 'MANAWG_SUPABASE_URL');
  const publishableKey = required(env, 'MANAWG_SUPABASE_PUBLISHABLE_KEY', 'Invalid configuration');

  const bootstrapRefreshToken = env.MANAWG_SUPABASE_REFRESH_TOKEN?.trim();
  if (bootstrapRefreshToken) {
    return { url, publishableKey, bootstrapRefreshToken, sessionCachePath: sessionCachePath(env) };
  }

  const email = env.MANAWG_EMAIL?.trim();
  const password = env.MANAWG_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error(
      'ManaWG MCP needs either MANAWG_SUPABASE_REFRESH_TOKEN or both MANAWG_EMAIL and MANAWG_PASSWORD',
    );
  }
  return { url, publishableKey, email, password, sessionCachePath: sessionCachePath(env) };
}

function sessionCachePath(env: NodeJS.ProcessEnv): string {
  const configured = env.MANAWG_SESSION_CACHE?.trim();
  return configured || DEFAULT_SESSION_CACHE_PATH;
}

function allowDestructive(env: NodeJS.ProcessEnv): boolean {
  const value = env.MANAWG_ALLOW_DESTRUCTIVE?.trim().toLowerCase();
  return value !== undefined && TRUTHY_VALUES.has(value);
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

  const wgCode = required(env, 'MANAWG_WG_CODE');

  return {
    baseUrl,
    origin,
    wgCode,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    auth: loadAuthConfig(env),
    allowDestructive: allowDestructive(env),
    transport: transport(env),
    http: httpTransport(env),
  };
}
