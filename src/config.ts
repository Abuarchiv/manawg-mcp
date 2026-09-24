import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const DEFAULT_SESSION_CACHE_PATH = join(homedir(), '.config', 'manawg-mcp', 'session.json');
export const DEFAULT_IDENTITY_CACHE_PATH = join(
  homedir(),
  '.config',
  'manawg-mcp',
  'identity.json',
);

export type SupabaseAuthConfig = {
  url: string;
  publishableKey: string;
  email?: string;
  password?: string;
  bootstrapRefreshToken?: string;
  sessionCachePath: string;
};

export type AppConfig = {
  baseUrl: string;
  origin: string;
  wgCode: string;
  memberId?: string;
  memberToken?: string;
  timeoutMs: number;
  auth: SupabaseAuthConfig;
  identityCachePath: string;
  allowDestructive: boolean;
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

function identityCachePath(env: NodeJS.ProcessEnv): string {
  if (env.MANAWG_IDENTITY_CACHE?.trim()) {
    return env.MANAWG_IDENTITY_CACHE.trim();
  }
  const sessionPath = sessionCachePath(env);
  const configuredDefault =
    !env.MANAWG_SESSION_CACHE?.trim() && sessionPath === DEFAULT_SESSION_CACHE_PATH;
  if (configuredDefault) {
    return DEFAULT_IDENTITY_CACHE_PATH;
  }
  return join(dirname(sessionPath), 'identity.json');
}

export function isMemberId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isMemberToken(value: unknown): value is string {
  return typeof value === 'string' && MEMBER_TOKEN_PATTERN.test(value);
}

function optionalMemberIdentity(
  env: NodeJS.ProcessEnv,
  name: 'MANAWG_MEMBER_ID' | 'MANAWG_MEMBER_TOKEN',
): string | undefined {
  const value = env[name]?.trim();
  if (!value) {
    return undefined;
  }
  const valid = name === 'MANAWG_MEMBER_ID' ? isMemberId(value) : isMemberToken(value);
  if (!valid) {
    throw new Error('Invalid configuration');
  }
  return value;
}

function allowDestructive(env: NodeJS.ProcessEnv): boolean {
  const value = env.MANAWG_ALLOW_DESTRUCTIVE?.trim().toLowerCase();
  return value !== undefined && TRUTHY_VALUES.has(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = absoluteHttpUrl(env, 'MANAWG_BASE_URL');
  const origin = new URL(baseUrl).origin;

  const wgCode = required(env, 'MANAWG_WG_CODE');
  const memberId = optionalMemberIdentity(env, 'MANAWG_MEMBER_ID');
  const memberToken = optionalMemberIdentity(env, 'MANAWG_MEMBER_TOKEN');
  if (Boolean(memberId) !== Boolean(memberToken)) {
    throw new Error('Invalid configuration');
  }

  return {
    baseUrl,
    origin,
    wgCode,
    ...(memberId ? { memberId } : {}),
    ...(memberToken ? { memberToken } : {}),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    auth: loadAuthConfig(env),
    identityCachePath: identityCachePath(env),
    allowDestructive: allowDestructive(env),
  };
}
