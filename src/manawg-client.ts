import { randomUUID } from 'node:crypto';
import type { SessionController } from './auth.js';
import { type AppConfig, SHARE_CODE_PATTERN } from './config.js';
import { DETAIL_SAFE_CODE, isSafeCode, ManaWgError } from './errors.js';
import { isRecord } from './payload.js';

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
  /** Aborts the whole call, retries included, e.g. when the MCP client disconnects. */
  signal?: AbortSignal;
};

export type ManaWgClient = {
  call(request: WgRequest): Promise<unknown>;
};

/** How a request proves who it acts for. */
type Credentials = {
  apply(headers: Headers): Promise<void>;
  /** Takes up credential rotations the app returns (`Set-Cookie`). */
  ingest?(response: Response): Promise<void>;
  /** Drops cached credentials after a 401 so the next `apply` signs in again. */
  invalidate?(): void;
  /** Verified identity of the user these credentials act for; lets per-request clients share lookups. */
  subject?: string;
};

/** The server's own signed-in account, sent as the `@supabase/ssr` session cookie. */
export function sessionCredentials(session: SessionController): Credentials {
  return {
    apply: async (headers) => {
      headers.set('cookie', await session.cookieHeader());
    },
    ingest: (response) => session.ingest(response),
    invalidate: () => session.invalidate(),
  };
}

/**
 * A user's verified OAuth access token, forwarded unchanged. `subject` is the user id from the
 * verified token; pass it only for a token that has been verified.
 */
export function bearerCredentials(token: string, subject?: string): Credentials {
  return {
    apply: async (headers) => {
      headers.set('authorization', `Bearer ${token}`);
    },
    ...(subject ? { subject } : {}),
  };
}

/** 429 plus the transient server failures worth another attempt. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [200, 800];
/** Longer rate limits are surfaced instead of slept out inside a tool call. */
const MAX_AUTO_RETRY_DELAY_MS = 2_000;
/** Everything one tool call may spend, retries and the flat lookup included (hosted limit: 60 s). */
const CALL_DEADLINE_MS = 45_000;

function truncate(value: string): string {
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    timer.unref();
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Waits for `promise`, but gives up with a timeout as soon as this caller's own `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ManaWgError('timeout', 0));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ManaWgError('timeout', 0));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** An update guarded by an `expected*` field must not be replayed after an unknown outcome. */
function isGuardedUpdate(request: WgRequest): boolean {
  const body = request.body;
  return (
    request.method === 'PATCH' &&
    isRecord(body) &&
    Object.keys(body).some((name) => name.startsWith('expected'))
  );
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
  if (isRecord(payload)) {
    if (payload.code !== undefined) {
      if (isSafeCode(payload.code)) {
        return payload.code;
      }
    } else if (isSafeCode(payload.error)) {
      return payload.error;
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function validationDetails(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const { details } = payload;
  if (details === undefined || details === null) {
    return undefined;
  }
  const text = typeof details === 'string' ? details : JSON.stringify(details);
  return text && text !== '{}' ? truncate(text) : undefined;
}

/** Reads a successful body: JSON, an empty body as `{}`, anything else as `{ contentType, content }`. */
async function decodeSuccess(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ManaWgError('invalid_response', response.status);
  }
  // The CSV export is the one non-JSON body; a missing content type is read as JSON.
  if (contentType && !/\bjson\b/i.test(contentType)) {
    return { contentType, content: text };
  }
  if (text === '') {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ManaWgError('invalid_response', response.status);
  }
}

/** Turns a response into its payload, or throws a sanitized `ManaWgError`. */
async function decode(response: Response): Promise<unknown> {
  if (response.ok) {
    return decodeSuccess(response);
  }
  const payload = await response.json().catch(() => undefined);
  const code = safeCode(payload, response.status);
  const options: { details?: string; retryAfterSeconds?: number } = {};
  if (code === DETAIL_SAFE_CODE) {
    const details = validationDetails(payload);
    if (details) {
      options.details = details;
    }
  }
  if (response.status === 429 || response.status === 503) {
    const seconds = retryAfterSeconds(response);
    if (seconds !== undefined) {
      options.retryAfterSeconds = seconds;
    }
  }
  throw new ManaWgError(code, response.status, options);
}

/** Drops an answer that will not be read, so its connection can be reused. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function peekJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

/** The account's only flat; joining or creating another one must not keep it valid long. */
const ONLY_WG_TTL_MS = 60_000;
const MAX_SHARED_ONLY_WG = 500;

type OnlyWgEntry = { code: Promise<string>; until: number };

/** Hosted mode builds a client per request; their lookups are shared per verified user. */
const sharedOnlyWg = new Map<string, OnlyWgEntry>();

/** Codes after which a cached "only flat" may be stale (left, deactivated or deleted). */
const MEMBERSHIP_GONE_CODES = new Set(['not_a_member', 'member_deactivated', 'wg_not_found']);

function onlyWgCode(payload: unknown): string {
  const wgs = isRecord(payload) && Array.isArray(payload.wgs) ? payload.wgs : [];
  const codes = wgs.flatMap((wg) => (isRecord(wg) && typeof wg.code === 'string' ? [wg.code] : []));
  const [code] = codes;
  if (code && codes.length === 1) {
    return code;
  }
  throw new ManaWgError(codes.length === 0 ? 'no_wg_membership' : 'wg_code_required', 400);
}

export function createManaWgClient(
  config: Pick<AppConfig, 'baseUrl' | 'origin' | 'timeoutMs' | 'defaultWgCode'>,
  fetchImpl: typeof fetch = fetch,
  credentials?: Credentials,
  { retryDelaysMs = DEFAULT_RETRY_DELAYS_MS }: { retryDelaysMs?: number[] } = {},
): ManaWgClient {
  /** Per-user cache when shared across clients, per-client otherwise. */
  const onlyWgStore = credentials?.subject ? sharedOnlyWg : new Map<string, OnlyWgEntry>();
  const onlyWgKey = `${config.baseUrl}\n${credentials?.subject ?? ''}`;

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
    if (!RETRYABLE_STATUS.has(response.status)) {
      return undefined;
    }
    // A 429 and a 503 `busy_retry` say how long to wait; other 5xx carry no hint.
    const seconds =
      response.status === 429 || response.status === 503 ? retryAfterSeconds(response) : undefined;
    if (seconds === undefined) {
      return fallbackMs;
    }
    return seconds * 1000 <= MAX_AUTO_RETRY_DELAY_MS ? seconds * 1000 : undefined;
  }

  async function perform(
    request: WgRequest,
    wgCode: string | undefined,
    deadline: AbortSignal,
    idempotencyKey?: string,
    retried = false,
  ): Promise<Response> {
    const method = request.method ?? 'GET';
    const headers = new Headers({ accept: 'application/json, text/csv', origin: config.origin });
    if (credentials) {
      try {
        // Sign-in can take several token requests: it counts against the deadline and stops
        // waiting on cancellation. A sign-in left behind still settles and fills the cache.
        await untilAborted(credentials.apply(headers), deadline);
      } catch (error) {
        if (error instanceof ManaWgError) {
          throw error;
        }
        throw new ManaWgError('auth_failed', 401, { cause: error });
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
      signal: AbortSignal.any([AbortSignal.timeout(config.timeoutMs), deadline]),
    };
    if (request.body !== undefined) {
      init.body = JSON.stringify(request.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(request, wgCode), init);
    } catch (error) {
      // A TimeoutError is the per-attempt timeout. Other failures are reported without their
      // message, which can carry the upstream address.
      const timedOut =
        deadline.aborted || (error instanceof Error && error.name === 'TimeoutError');
      throw new ManaWgError(timedOut ? 'timeout' : 'upstream_network_error', 0);
    }
    await credentials?.ingest?.(response);

    // The session may have been revoked server-side: sign in again exactly once.
    if (!retried && credentials?.invalidate && response.status === 401) {
      // Only `auth_required` means the session is gone; `not_a_member` and `member_deactivated`
      // also come as 401 but answer for the flat.
      if (safeCode(await peekJson(response), response.status) === 'auth_required') {
        await discard(response);
        credentials.invalidate();
        return perform(request, wgCode, deadline, idempotencyKey, true);
      }
    }
    return response;
  }

  /** One request with bounded retries: transient statuses, rate limits and network failures. */
  async function send(
    request: WgRequest,
    wgCode: string | undefined,
    deadline: AbortSignal,
    idempotencyKey?: string,
  ): Promise<Response> {
    /** An earlier attempt may have reached the app without us seeing its answer. */
    let outcomeUnknown = false;
    for (let attempt = 0; ; attempt++) {
      const fallbackMs = retryDelaysMs[attempt];
      let response: Response;
      try {
        response = await perform(request, wgCode, deadline, idempotencyKey);
      } catch (error) {
        const retryable =
          fallbackMs !== undefined &&
          !deadline.aborted &&
          error instanceof ManaWgError &&
          (error.code === 'upstream_network_error' || error.code === 'timeout') &&
          !isGuardedUpdate(request);
        if (!retryable) {
          throw error;
        }
        outcomeUnknown = true;
        await sleep(fallbackMs, deadline);
        continue;
      }

      if (outcomeUnknown && request.method === 'DELETE' && response.status === 404) {
        // Most delete routes keep no idempotency record: the row gone now means an earlier
        // attempt did delete it.
        const code = safeCode(await peekJson(response), response.status);
        if (code !== 'wg_not_found') {
          await discard(response);
          return jsonResponse({ deleted: true, alreadyGone: true });
        }
      }

      const delay = fallbackMs === undefined ? undefined : nextDelay(response, fallbackMs);
      // A 5xx may come after the update was committed, and the replay would then trip over
      // its own expected* guard. Only a 429 is safe to repeat: the request never ran.
      if (delay === undefined || (isGuardedUpdate(request) && response.status !== 429)) {
        return response;
      }
      if (response.status !== 429) {
        outcomeUnknown = true;
      }
      await discard(response);
      if (delay > 0) {
        await sleep(delay, deadline);
      }
    }
  }

  /** The account's only flat, looked up at most once a minute per client (per user when shared). */
  function onlyWg(deadline: AbortSignal): Promise<string> {
    const cached = onlyWgStore.get(onlyWgKey);
    if (cached && cached.until > Date.now()) {
      return untilAborted(cached.code, deadline);
    }
    const entry = {
      // Shared between requests, so it must not die with the first caller's deadline or signal.
      code: send(
        { path: ['mine'], scope: 'account' },
        undefined,
        AbortSignal.timeout(CALL_DEADLINE_MS),
      )
        .then(decode)
        .then(onlyWgCode),
      until: Date.now() + ONLY_WG_TTL_MS,
    };
    for (const [key, other] of onlyWgStore) {
      if (other.until <= Date.now()) onlyWgStore.delete(key);
    }
    if (onlyWgStore.size >= MAX_SHARED_ONLY_WG) {
      onlyWgStore.delete(onlyWgStore.keys().next().value as string);
    }
    onlyWgStore.set(onlyWgKey, entry);
    entry.code.catch(() => {
      if (onlyWgStore.get(onlyWgKey) === entry) onlyWgStore.delete(onlyWgKey);
    });
    return untilAborted(entry.code, deadline);
  }

  async function wgCodeFor(request: WgRequest, deadline: AbortSignal): Promise<string | undefined> {
    if (request.scope === 'account') {
      return undefined;
    }
    const explicit = request.wgCode || config.defaultWgCode;
    if (explicit === undefined) {
      return onlyWg(deadline);
    }
    if (!SHARE_CODE_PATTERN.test(explicit)) {
      throw new ManaWgError('invalid_share_code', 400);
    }
    return explicit;
  }

  return {
    async call(request: WgRequest): Promise<unknown> {
      const deadline = AbortSignal.any([
        AbortSignal.timeout(CALL_DEADLINE_MS),
        ...(request.signal ? [request.signal] : []),
      ]);
      const wgCode = await wgCodeFor(request, deadline);
      const isWrite = (request.method ?? 'GET') !== 'GET';
      const idempotencyKey = isWrite ? randomUUID() : undefined;
      try {
        const payload = await decode(await send(request, wgCode, deadline, idempotencyKey));
        if (request.scope === 'account' && isWrite) {
          // A new flat (wg_create) means the account may no longer have just one.
          onlyWgStore.delete(onlyWgKey);
        }
        return payload;
      } catch (error) {
        if (error instanceof ManaWgError && MEMBERSHIP_GONE_CODES.has(error.code)) {
          onlyWgStore.delete(onlyWgKey);
        }
        throw error;
      }
    },
  };
}
