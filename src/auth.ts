import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SupabaseAuthConfig } from './config.js';

export const MAX_CHUNK_SIZE = 3180;

/**
 * Mirrors `@supabase/ssr` (0.12.5): sessions are stored as
 * `base64-<base64url(JSON)>`, chunked after MAX_CHUNK_SIZE. Readers accept
 * both this scheme and the legacy `encodeURIComponent` payload.
 */
const BASE64_PREFIX = 'base64-';

export type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in?: number;
  token_type?: string;
  user?: unknown;
};

export type SessionController = {
  cookieHeader(): Promise<string>;
  ingest(response: Response): Promise<void>;
  invalidate(): void;
};

export type FetchLike = typeof fetch;

export function storageKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

function canDecode(value: string): boolean {
  try {
    decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

export function sessionCookiePairs(
  key: string,
  json: string,
): Array<{ name: string; value: string }> {
  const encoded = `${BASE64_PREFIX}${Buffer.from(json, 'utf8').toString('base64url')}`;
  if (encoded.length <= MAX_CHUNK_SIZE) {
    return [{ name: key, value: encoded }];
  }

  // Chunk the URI-encoded form so no chunk splits a percent-escape, then store
  // each chunk back in decoded form — exactly what `createChunks` ships.
  const pairs: Array<{ name: string; value: string }> = [];
  let rest = encodeURIComponent(encoded);
  let index = 0;
  while (rest.length > 0) {
    let cut = Math.min(rest.length, MAX_CHUNK_SIZE);
    while (cut > 1 && !canDecode(rest.slice(0, cut))) {
      cut -= 1;
    }
    const head = rest.slice(0, cut);
    pairs.push({ name: `${key}.${index}`, value: decodeURIComponent(head) });
    rest = rest.slice(cut);
    index += 1;
  }
  return pairs;
}

function decodeCookiePayload(raw: string): string | undefined {
  if (raw.startsWith(BASE64_PREFIX)) {
    try {
      return Buffer.from(raw.slice(BASE64_PREFIX.length), 'base64url').toString('utf8');
    } catch {
      return undefined;
    }
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sessionFromCookieValue(raw: string): SupabaseSession | undefined {
  const payload = decodeCookiePayload(raw);
  if (payload === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    return isSupabaseSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSupabaseSession(value: unknown): value is SupabaseSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const session = value as Partial<SupabaseSession>;
  return (
    typeof session.access_token === 'string' &&
    typeof session.refresh_token === 'string' &&
    typeof session.expires_at === 'number'
  );
}

function normalizeSession(payload: Record<string, unknown>): SupabaseSession | undefined {
  const expiresInSeconds = Number(payload.expires_in);
  const expiresAt = Number(payload.expires_at);
  const session: SupabaseSession = {
    access_token: String(payload.access_token ?? ''),
    refresh_token: String(payload.refresh_token ?? ''),
    expires_at:
      typeof expiresAt === 'number' && expiresAt > 0
        ? expiresAt
        : typeof expiresInSeconds === 'number' && expiresInSeconds > 0
          ? Math.floor(Date.now() / 1000) + expiresInSeconds
          : 0,
  };
  if (typeof payload.expires_in === 'number') {
    session.expires_in = payload.expires_in;
  }
  if (typeof payload.token_type === 'string') {
    session.token_type = payload.token_type;
  }
  if (payload.user !== undefined) {
    session.user = payload.user;
  }
  return isSupabaseSession(session) && session.expires_at > 0 ? session : undefined;
}

export function createSessionController(
  authConfig: SupabaseAuthConfig,
  fetchImpl: FetchLike = fetch,
): SessionController {
  const key = storageKeyFor(authConfig.url);
  let session: SupabaseSession | undefined;
  let loaded = false;
  let pending: Promise<SupabaseSession> | undefined;

  function readCache(): SupabaseSession | undefined {
    try {
      if (!existsSync(authConfig.sessionCachePath)) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(readFileSync(authConfig.sessionCachePath, 'utf8'));
      return isSupabaseSession(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  function persist(next: SupabaseSession | undefined): void {
    try {
      mkdirSync(dirname(authConfig.sessionCachePath), { recursive: true, mode: 0o700 });
      if (next === undefined) {
        if (existsSync(authConfig.sessionCachePath)) {
          rmSync(authConfig.sessionCachePath, { force: true });
        }
        return;
      }
      writeFileSync(authConfig.sessionCachePath, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      chmodSync(authConfig.sessionCachePath, 0o600);
    } catch {
      // A read-only cache never blocks a sign-in that already succeeded.
    }
  }

  async function tokenRequest(
    body: Record<string, unknown>,
  ): Promise<SupabaseSession | 'rejected'> {
    let response: Response;
    try {
      response = await fetchImpl(
        `${authConfig.url}/auth/v1/token?grant_type=${String(body.grant_type)}`,
        {
          method: 'POST',
          headers: {
            apikey: authConfig.publishableKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new Error('auth_failed');
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return 'rejected';
    }
    if (!response.ok) {
      throw new Error('auth_failed');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('auth_failed');
    }
    const next = normalizeSession(
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {},
    );
    if (!next) {
      throw new Error('auth_failed');
    }
    return next;
  }

  async function bootstrapSession(): Promise<SupabaseSession | undefined> {
    if (authConfig.bootstrapRefreshToken) {
      const refreshed = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: authConfig.bootstrapRefreshToken,
      });
      if (refreshed !== 'rejected') {
        return refreshed;
      }
    }
    if (authConfig.email && authConfig.password) {
      const signedIn = await tokenRequest({
        grant_type: 'password',
        email: authConfig.email,
        password: authConfig.password,
      });
      if (signedIn !== 'rejected') {
        return signedIn;
      }
    }
    return undefined;
  }

  function isFresh(candidate: SupabaseSession | undefined): candidate is SupabaseSession {
    return candidate !== undefined && candidate.expires_at * 1000 > Date.now() + 60_000;
  }

  async function ensureSession(): Promise<SupabaseSession> {
    if (pending) {
      return pending;
    }
    if (!loaded) {
      session ??= readCache();
      loaded = true;
    }
    const current = session;
    if (isFresh(current)) {
      return current;
    }

    pending = (async () => {
      if (session) {
        const refreshed = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: session.refresh_token,
        });
        if (refreshed !== 'rejected') {
          session = refreshed;
          persist(session);
          return refreshed;
        }
        session = undefined;
        persist(undefined);
      }
      const fresh = await bootstrapSession();
      if (!fresh) {
        throw new Error('auth_failed');
      }
      session = fresh;
      persist(session);
      return fresh;
    })();

    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  }

  function cookieHeaderFor(candidate: SupabaseSession): string {
    const pairs = sessionCookiePairs(key, JSON.stringify(candidate));
    return pairs.map((pair) => `${pair.name}=${pair.value}`).join('; ');
  }

  const valuesByName = new Map<string, string>();

  function ingestSetCookies(names: Set<string>): void {
    let next = session;
    for (const name of names) {
      if (name !== key && !name.startsWith(`${key}.`)) {
        continue;
      }
      if (name === key) {
        const value = valuesByName.get(name) ?? '';
        if (!value) {
          next = undefined;
          continue;
        }
        next = sessionFromCookieValue(value) ?? next;
      }
    }
    const chunkPrefix = `${key}.`;
    const chunked = names.has(`${key}.0`);
    if (chunked) {
      const parts: string[] = [];
      for (let index = 0; ; index += 1) {
        const value = valuesByName.get(`${chunkPrefix}${index}`);
        if (value === undefined) {
          break;
        }
        parts.push(value);
      }
      if (parts.length > 0) {
        next = sessionFromCookieValue(parts.join('')) ?? next;
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(session)) {
      session = next;
      persist(session);
    }
  }

  return {
    async cookieHeader(): Promise<string> {
      return cookieHeaderFor(await ensureSession());
    },

    async ingest(response: Response): Promise<void> {
      const setCookies =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie') ?? ''];
      valuesByName.clear();
      for (const setCookie of setCookies) {
        const [pair] = setCookie.split(';');
        if (!pair) {
          continue;
        }
        const separator = pair.indexOf('=');
        if (separator < 0) {
          continue;
        }
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (name) {
          valuesByName.set(name, value);
        }
      }
      if (valuesByName.size > 0) {
        ingestSetCookies(new Set(valuesByName.keys()));
      }
    },

    invalidate(): void {
      session = undefined;
      loaded = true;
      persist(undefined);
    },
  };
}
