import { randomUUID } from 'node:crypto';
import type { SessionController } from './auth.js';
import { type AppConfig, SHARE_CODE_PATTERN } from './config.js';
import { DETAIL_SAFE_CODE, isSafeCode, ManaWgError } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type RequestScope = 'wg' | 'account';

export type WgRequest = {
  path: string[];
  method?: HttpMethod;
  query?: QueryParams;
  body?: unknown;
  /** `account` targets the account-level routes under `/api/wg/*` that live outside a WG code. */
  scope?: RequestScope;
  /** Share code of the flat; falls back to the configured default, then to the only flat. */
  wgCode?: string;
};

export type ManaWgClient = {
  call(request: WgRequest): Promise<unknown>;
};

/** How a request proves who it acts for. */
export type Credentials = {
  apply(headers: Headers): Promise<void>;
  /** Takes up credential rotations the app returns (`Set-Cookie`). */
  ingest?(response: Response): Promise<void>;
  /** Drops cached credentials after a 401; returns true when a fresh attempt can succeed. */
  invalidate?(): boolean;
};

/** The server's own signed-in account, sent as the `@supabase/ssr` session cookie. */
export function sessionCredentials(session: SessionController): Credentials {
  return {
    apply: async (headers) => {
      headers.set('cookie', await session.cookieHeader());
    },
    ingest: (response) => session.ingest(response),
    invalidate: () => {
      session.invalidate();
      return true;
    },
  };
}

/** A user's verified OAuth access token, forwarded unchanged. */
export function bearerCredentials(token: string): Credentials {
  return {
    apply: async (headers) => {
      headers.set('authorization', `Bearer ${token}`);
    },
  };
}

const AUTH_RETRY_CODES = new Set(['auth_required', 'member_deactivated', 'not_a_member']);

/** 429 plus the transient server failures worth another attempt. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [200, 800];
/** Longer rate limits are surfaced instead of slept out inside a tool call. */
const DEFAULT_MAX_AUTO_RETRY_DELAY_MS = 2_000;

export type ClientRetryOptions = {
  retryDelaysMs?: number[];
  maxAutoRetryDelayMs?: number;
};

function truncate(value: string): string {
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds);
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

/** Maps an error response to an allowlisted code, falling back to a status-derived one. */
function safeCode(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as { code?: unknown; error?: unknown };
    if (record.code !== undefined) {
      if (isSafeCode(record.code)) {
        return record.code;
      }
    } else if (isSafeCode(record.error)) {
      return record.error;
    }
  }
  if (status === 401) {
    return 'auth_required';
  }
  if (status === 403) {
    return 'access_denied';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 429) {
    return 'too_many_requests';
  }
  if (status >= 500) {
    return 'internal_error';
  }
  return `upstream_http_${status}`;
}

function validationDetails(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const details = (payload as { details?: unknown }).details;
  if (details === undefined || details === null) {
    return undefined;
  }
  const text = typeof details === 'string' ? details : JSON.stringify(details);
  return text && text !== '{}' ? truncate(text) : undefined;
}

function isJsonResponse(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return type === '' || /\bjson\b/i.test(type);
}

/**
 * Turns a response into its payload, or throws a sanitized `ManaWgError`.
 * Successful non-JSON bodies (the CSV export) come back as `{ contentType, content }`.
 */
async function decode(response: Response): Promise<unknown> {
  if (response.ok && response.status !== 204 && !isJsonResponse(response)) {
    const content = await response.text().catch(() => '');
    return { contentType: response.headers.get('content-type') ?? 'text/plain', content };
  }
  const payload = await response.json().catch(() => undefined);
  if (response.ok) {
    return payload === undefined || response.status === 204 ? {} : payload;
  }
  const code = safeCode(payload, response.status);
  const options: { details?: string; retryAfterSeconds?: number } = {};
  if (code === DETAIL_SAFE_CODE) {
    const details = validationDetails(payload);
    if (details) {
      options.details = details;
    }
  }
  if (response.status === 429) {
    const seconds = retryAfterSeconds(response);
    if (seconds !== undefined) {
      options.retryAfterSeconds = seconds;
    }
  }
  throw new ManaWgError(code, response.status, options);
}

async function peekJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

const ONLY_WG_TTL_MS = 60_000;

/** Codes after which a cached "only flat" may be stale (left, deactivated or deleted). */
const MEMBERSHIP_GONE_CODES = new Set(['not_a_member', 'member_deactivated', 'wg_not_found']);

function onlyWgCode(payload: unknown): string {
  const wgs = (payload as { wgs?: unknown } | undefined)?.wgs;
  const codes = Array.isArray(wgs)
    ? wgs
        .map((wg) => (wg as { code?: unknown } | null)?.code)
        .filter((code): code is string => typeof code === 'string')
    : [];
  if (codes.length === 1 && codes[0]) {
    return codes[0];
  }
  throw new ManaWgError(codes.length === 0 ? 'no_wg_membership' : 'wg_code_required', 400);
}

export function createManaWgClient(
  config: Pick<AppConfig, 'baseUrl' | 'origin' | 'timeoutMs' | 'defaultWgCode'>,
  fetchImpl: typeof fetch = fetch,
  credentials?: Credentials,
  retryOptions: ClientRetryOptions = {},
): ManaWgClient {
  const retryDelaysMs = retryOptions.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxAutoRetryDelayMs = retryOptions.maxAutoRetryDelayMs ?? DEFAULT_MAX_AUTO_RETRY_DELAY_MS;
  /** The account's only flat; joining or creating another one must not keep it valid long. */
  let resolvedWgCode: { code: Promise<string>; until: number } | undefined;

  function buildUrl(request: WgRequest, wgCode: string | undefined): string {
    const base = wgCode === undefined ? [] : [wgCode];
    const segments = [...base, ...request.path].map((segment) => encodeURIComponent(segment));
    const url = new URL([config.baseUrl, 'api', 'wg', ...segments].join('/'));
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(name, String(value));
      }
    }
    return url.href;
  }

  /** Milliseconds to wait before the next attempt, or undefined to give up. */
  function nextDelay(response: Response, fallbackMs: number): number | undefined {
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response);
      const delay = seconds === undefined ? fallbackMs : seconds * 1000;
      return delay <= maxAutoRetryDelayMs ? delay : undefined;
    }
    return RETRYABLE_STATUS.has(response.status) ? fallbackMs : undefined;
  }

  async function perform(
    request: WgRequest,
    wgCode: string | undefined,
    idempotencyKey?: string,
    retried = false,
  ): Promise<Response> {
    const method = request.method ?? 'GET';
    // The app derives the acting member from the session cookie; no member headers are needed.
    const headers = new Headers({ accept: 'application/json, text/csv', origin: config.origin });
    if (credentials) {
      try {
        await credentials.apply(headers);
      } catch {
        throw new ManaWgError('auth_failed', 401);
      }
    }
    if (request.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (idempotencyKey) {
      headers.set('idempotency-key', idempotencyKey);
    }

    const init: RequestInit = {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    };
    if (request.body !== undefined || method === 'DELETE') {
      init.body = JSON.stringify(request.body ?? {});
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(request, wgCode), init);
    } catch {
      throw new ManaWgError('upstream_network_error', 0);
    }
    await credentials?.ingest?.(response);

    // The session may have been revoked server-side: sign in again exactly once.
    if (!retried && credentials?.invalidate && response.status === 401) {
      const code = safeCode(await peekJson(response), response.status);
      if (AUTH_RETRY_CODES.has(code) && credentials.invalidate()) {
        return perform(request, wgCode, idempotencyKey, true);
      }
    }
    return response;
  }

  /** One request with bounded retries: transient statuses, rate limits and network failures. */
  async function send(
    request: WgRequest,
    wgCode: string | undefined,
    idempotencyKey?: string,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const fallbackMs = retryDelaysMs[attempt];
      let response: Response;
      try {
        response = await perform(request, wgCode, idempotencyKey);
      } catch (error) {
        const retryable =
          fallbackMs !== undefined &&
          error instanceof ManaWgError &&
          error.code === 'upstream_network_error';
        if (!retryable) {
          throw error;
        }
        await sleep(fallbackMs);
        continue;
      }

      const delay = fallbackMs === undefined ? undefined : nextDelay(response, fallbackMs);
      if (delay === undefined) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  /** The account's only flat, looked up at most once a minute per client. */
  function onlyWg(): Promise<string> {
    if (resolvedWgCode && resolvedWgCode.until > Date.now()) {
      return resolvedWgCode.code;
    }
    const entry = {
      code: send({ path: ['mine'], scope: 'account' }, undefined)
        .then(decode)
        .then(onlyWgCode),
      until: Date.now() + ONLY_WG_TTL_MS,
    };
    resolvedWgCode = entry;
    entry.code.catch(() => {
      if (resolvedWgCode === entry) resolvedWgCode = undefined;
    });
    return entry.code;
  }

  async function wgCodeFor(request: WgRequest): Promise<string | undefined> {
    if (request.scope === 'account') {
      return undefined;
    }
    const explicit = request.wgCode?.trim().toUpperCase() || config.defaultWgCode;
    if (explicit === undefined) {
      return onlyWg();
    }
    if (!SHARE_CODE_PATTERN.test(explicit)) {
      throw new ManaWgError('invalid_share_code', 400);
    }
    return explicit;
  }

  return {
    async call(request: WgRequest): Promise<unknown> {
      const wgCode = await wgCodeFor(request);
      const idempotencyKey = (request.method ?? 'GET') === 'GET' ? undefined : randomUUID();
      try {
        const payload = await decode(await send(request, wgCode, idempotencyKey));
        if (request.scope === 'account' && idempotencyKey) {
          // A new flat (wg_create) means the account may no longer have just one.
          resolvedWgCode = undefined;
        }
        return payload;
      } catch (error) {
        if (error instanceof ManaWgError && MEMBERSHIP_GONE_CODES.has(error.code)) {
          resolvedWgCode = undefined;
        }
        throw error;
      }
    },
  };
}
