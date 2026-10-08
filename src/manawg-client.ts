import { randomUUID } from 'node:crypto';
import type { SessionController } from './auth.js';
import type { AppConfig } from './config.js';
import { DETAIL_SAFE_CODE, ManaWgError, isSafeCode } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type RequestScope = 'wg' | 'account';

export type WgRequest = {
  path: string[];
  method?: HttpMethod;
  query?: QueryParams;
  body?: unknown;
  /** Extra request headers; only the legacy member claim needs any. */
  headers?: Record<string, string>;
  /** `account` targets the account-level routes under `/api/wg/*` that live outside a WG code. */
  scope?: RequestScope;
};

export type ManaWgClient = {
  call(request: WgRequest): Promise<unknown>;
};

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

export function createManaWgClient(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  auth?: SessionController,
  retryOptions: ClientRetryOptions = {},
): ManaWgClient {
  const retryDelaysMs = retryOptions.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxAutoRetryDelayMs = retryOptions.maxAutoRetryDelayMs ?? DEFAULT_MAX_AUTO_RETRY_DELAY_MS;

  function buildUrl(request: WgRequest): string {
    const base = request.scope === 'account' ? [] : [config.wgCode];
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
    idempotencyKey?: string,
    retried = false,
  ): Promise<Response> {
    const method = request.method ?? 'GET';
    // The app derives the acting member from the session cookie; no member headers are needed.
    const headers = new Headers({ accept: 'application/json, text/csv', origin: config.origin });
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      headers.set(name, value);
    }
    if (auth) {
      try {
        headers.set('cookie', await auth.cookieHeader());
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
      response = await fetchImpl(buildUrl(request), init);
    } catch {
      throw new ManaWgError('upstream_network_error', 0);
    }
    if (auth) {
      await auth.ingest(response);
    }

    // The session may have been revoked server-side: sign in again exactly once.
    if (!retried && auth && response.status === 401) {
      const code = safeCode(await peekJson(response), response.status);
      if (AUTH_RETRY_CODES.has(code)) {
        auth.invalidate();
        return perform(request, idempotencyKey, true);
      }
    }
    return response;
  }

  /** One request with bounded retries: transient statuses, rate limits and network failures. */
  async function send(request: WgRequest, idempotencyKey?: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const fallbackMs = retryDelaysMs[attempt];
      let response: Response;
      try {
        response = await perform(request, idempotencyKey);
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

  return {
    async call(request: WgRequest): Promise<unknown> {
      const idempotencyKey = (request.method ?? 'GET') === 'GET' ? undefined : randomUUID();
      return decode(await send(request, idempotencyKey));
    },
  };
}
