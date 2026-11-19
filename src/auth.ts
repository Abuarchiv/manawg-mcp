import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_TIMEOUT_MS, type SupabaseAuthConfig } from './config.js';

/** Cookie format of `@supabase/ssr`: `base64-<base64url(JSON)>`, chunked at this many characters. */
export const MAX_CHUNK_SIZE = 3180;
const BASE64_PREFIX = 'base64-';

type SupabaseSession = {
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

function storageKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

export function sessionCookiePairs(
  key: string,
  json: string,
): Array<{ name: string; value: string }> {
  const encoded = `${BASE64_PREFIX}${Buffer.from(json, 'utf8').toString('base64url')}`;
  if (encoded.length <= MAX_CHUNK_SIZE) {
    return [{ name: key, value: encoded }];
  }

  // The encoded form is plain ASCII with no percent-escapes, so any cut point is safe.
  const pairs: Array<{ name: string; value: string }> = [];
  for (let start = 0; start < encoded.length; start += MAX_CHUNK_SIZE) {
    pairs.push({
      name: `${key}.${pairs.length}`,
      value: encoded.slice(start, start + MAX_CHUNK_SIZE),
    });
  }
  return pairs;
}

function decodeCookiePayload(raw: string): string {
  if (raw.startsWith(BASE64_PREFIX)) {
    return Buffer.from(raw.slice(BASE64_PREFIX.length), 'base64url').toString('utf8');
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sessionFromCookieValue(raw: string): SupabaseSession | undefined {
  try {
    const parsed: unknown = JSON.parse(decodeCookiePayload(raw));
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

/** The session in a token endpoint answer, or undefined when it lacks tokens or an expiry. */
function normalizeSession(payload: unknown): SupabaseSession | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const { access_token, refresh_token, expires_at, expires_in, token_type, user } =
    payload as Record<string, unknown>;
  if (!access_token || typeof access_token !== 'string') {
    return undefined;
  }
  if (!refresh_token || typeof refresh_token !== 'string') {
    return undefined;
  }
  let expiresAt = 0;
  if (typeof expires_at === 'number' && expires_at > 0) {
    expiresAt = expires_at;
  } else if (typeof expires_in === 'number' && expires_in > 0) {
    expiresAt = Math.floor(Date.now() / 1000) + expires_in;
  }
  if (expiresAt === 0) {
    return undefined;
  }
  const session: SupabaseSession = {
    access_token,
    refresh_token,
    expires_at: expiresAt,
  };
  if (typeof expires_in === 'number') {
    session.expires_in = expires_in;
  }
  if (typeof token_type === 'string') {
    session.token_type = token_type;
  }
  if (user !== undefined) {
    session.user = user;
  }
  return session;
}

/** `name=value` pairs of every `Set-Cookie` header; attributes after `;` are dropped. */
function parseSetCookies(response: Response): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const separator = pair ? pair.indexOf('=') : -1;
    if (!pair || separator < 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    if (name) {
      cookies.set(name, pair.slice(separator + 1).trim());
    }
  }
  return cookies;
}

/**
 * The session after the app's `Set-Cookie` rotation: an emptied cookie signs the
 * session out, a (chunked) auth cookie replaces it, anything else leaves it alone.
 */
function sessionAfterSetCookies(
  key: string,
  cookies: Map<string, string>,
  current: SupabaseSession | undefined,
): SupabaseSession | undefined {
  let next = current;

  const single = cookies.get(key);
  if (single !== undefined) {
    next = single ? (sessionFromCookieValue(single) ?? next) : undefined;
  }

  if (cookies.has(`${key}.0`)) {
    const parts: string[] = [];
    for (let value = cookies.get(`${key}.0`); value !== undefined; ) {
      parts.push(value);
      value = cookies.get(`${key}.${parts.length}`);
    }
    next = sessionFromCookieValue(parts.join('')) ?? next;
  }

  return next;
}

const authFailed = (cause: unknown): Error => new Error('auth_failed', { cause });

export function createSessionController(
  authConfig: SupabaseAuthConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): SessionController {
  const key = storageKeyFor(authConfig.url);
  let session = readCache();
  let pending: Promise<SupabaseSession> | undefined;
  /** The configured refresh token is single-use: once tried, replaying it only trips reuse detection. */
  let bootstrapTried = false;

  function readCache(): SupabaseSession | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(authConfig.sessionCachePath, 'utf8'));
      return isSupabaseSession(parsed) ? parsed : undefined;
    } catch {
      // No cache yet, or one that is unreadable or not a session: sign in again.
      return undefined;
    }
  }

  function persist(next: SupabaseSession | undefined): void {
    try {
      mkdirSync(dirname(authConfig.sessionCachePath), { recursive: true, mode: 0o700 });
      if (next === undefined) {
        rmSync(authConfig.sessionCachePath, { force: true });
        return;
      }
      // Write beside the cache and rename over it: concurrent readers never see a partial file
      // and the result is owner-only even when an older, wider file was there before.
      const temp = `${authConfig.sessionCachePath}.${process.pid}.tmp`;
      try {
        rmSync(temp, { force: true });
        writeFileSync(temp, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: 'wx' });
        renameSync(temp, authConfig.sessionCachePath);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    } catch {
      // A read-only cache never blocks a sign-in that already succeeded.
    }
  }

  /** Calls the token endpoint; `'rejected'` means Supabase refused the grant itself. */
  async function tokenRequest(
    grantType: 'refresh_token' | 'password',
    fields: Record<string, string>,
  ): Promise<SupabaseSession | 'rejected'> {
    let response: Response;
    try {
      response = await fetchImpl(`${authConfig.url}/auth/v1/token?grant_type=${grantType}`, {
        method: 'POST',
        headers: {
          apikey: authConfig.publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ grant_type: grantType, ...fields }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw authFailed(error);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return 'rejected';
    }
    if (!response.ok) {
      throw authFailed(`token endpoint answered ${response.status}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw authFailed(error);
    }
    const next = normalizeSession(payload);
    if (!next) {
      throw authFailed('token endpoint answered without a usable session');
    }
    return next;
  }

  async function bootstrapSession(): Promise<SupabaseSession | undefined> {
    if (authConfig.bootstrapRefreshToken && !bootstrapTried) {
      const refreshed = await tokenRequest('refresh_token', {
        refresh_token: authConfig.bootstrapRefreshToken,
      });
      bootstrapTried = true;
      if (refreshed !== 'rejected') {
        return refreshed;
      }
    }
    if (authConfig.email && authConfig.password) {
      const signedIn = await tokenRequest('password', {
        email: authConfig.email,
        password: authConfig.password,
      });
      if (signedIn !== 'rejected') {
        return signedIn;
      }
    }
    return undefined;
  }

  function isFresh(candidate: SupabaseSession): boolean {
    return candidate.expires_at * 1000 > Date.now() + 60_000;
  }

  /**
   * Several servers share one cache and a refresh token works once. Takes up a newer session
   * another process wrote there, instead of replaying our old token or deleting its session.
   */
  function adoptRotated(): boolean {
    const cached = readCache();
    if (
      !session ||
      !cached ||
      cached.refresh_token === session.refresh_token ||
      cached.expires_at <= session.expires_at
    ) {
      return false;
    }
    session = cached;
    return true;
  }

  async function ensureSession(): Promise<SupabaseSession> {
    if (pending) {
      return pending;
    }
    if (session && isFresh(session)) {
      return session;
    }

    pending = (async () => {
      if (session && adoptRotated() && isFresh(session)) {
        return session;
      }
      for (let attempt = 0; session && attempt < 2; attempt++) {
        const refreshed = await tokenRequest('refresh_token', {
          refresh_token: session.refresh_token,
        });
        if (refreshed !== 'rejected') {
          session = refreshed;
          persist(session);
          return refreshed;
        }
        // Rejected: a sibling may have won the race and rotated the token just now.
        if (!adoptRotated()) {
          break;
        }
        if (isFresh(session)) {
          return session;
        }
      }
      if (session) {
        session = undefined;
        persist(undefined);
      }
      const fresh = await bootstrapSession();
      if (!fresh) {
        throw authFailed('no credential was accepted');
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

  return {
    async cookieHeader(): Promise<string> {
      return cookieHeaderFor(await ensureSession());
    },

    async ingest(response: Response): Promise<void> {
      const cookies = parseSetCookies(response);
      if (cookies.size === 0) {
        return;
      }
      const next = sessionAfterSetCookies(key, cookies, session);
      if (JSON.stringify(next) !== JSON.stringify(session)) {
        session = next;
        persist(session);
      }
    },

    invalidate(): void {
      if (pending) {
        // A refresh or sign-in is already running: wiping the session under it
        // would discard its result and make the next caller sign in again.
        return;
      }
      // A sibling may have rotated the session since we loaded it: adopt that one and leave
      // the cache alone instead of overwriting it with our stale refresh token.
      if (session && !adoptRotated()) {
        // The access token was refused; its refresh token is still the live one. Keep it so
        // the next call refreshes instead of replaying a long-rotated bootstrap token. Only
        // the in-memory copy changes: the shared cache may already hold a newer session.
        session = { ...session, expires_at: 0 };
      }
    },
  };
}
