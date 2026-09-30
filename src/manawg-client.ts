import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionController } from './auth.js';
import { type AppConfig, isMemberId, isMemberToken } from './config.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type WgRequest = {
  path: string[];
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** `account` targets the account-level routes under `/api/wg/*` that live outside a WG code. */
  scope?: 'wg' | 'account';
};

export type ManaWgClient = {
  call(request: WgRequest): Promise<unknown>;
};

export type MemberIdentity = {
  memberId: string;
  memberToken?: string;
};

const SAFE_UPSTREAM_CODES = new Set([
  'access_denied',
  'active_invalid',
  'already_joined',
  'already_settled',
  'announcement_not_found',
  'auth_failed',
  'auth_required',
  'bad_request',
  'before_cursor_incomplete',
  'before_id_invalid',
  'before_invalid',
  'body_invalid',
  'chore_not_found',
  'chore_occurrence_changed',
  'comment_invalid',
  'comment_not_found',
  'conflict',
  'currency_invalid',
  'database_error',
  'date_range_invalid',
  'due_date_invalid',
  'due_date_out_of_range',
  'email_exists',
  'email_not_confirmed',
  'empty_message',
  'empty_update',
  'ends_before_start',
  'event_not_found',
  'expected_occurrence_invalid',
  'expected_state_invalid',
  'expense_changed',
  'expense_not_found',
  'forbidden',
  'from_invalid',
  'idempotency_conflict',
  'id_invalid',
  'incomplete_payload',
  'insufficient_stock',
  'internal_error',
  'interval_invalid',
  'invalid_amount',
  'invalid_body',
  'invalid_consume_delta',
  'invalid_cursor',
  'invalid_date_range',
  'invalid_email',
  'invalid_event_date',
  'invalid_event_time',
  'invalid_filter',
  'invalid_format',
  'invalid_interval',
  'invalid_json',
  'invalid_member_state',
  'invalid_operation',
  'invalid_quantity',
  'invalid_reference',
  'invalid_response',
  'invalid_role',
  'invalid_share_code',
  'invalid_shopping_qty',
  'invalid_split_total',
  'invalid_state',
  'invalid_token',
  'item_not_found',
  'kind_invalid',
  'limit_exceeded',
  'limits_exceeded',
  'member_deactivated',
  'member_id_invalid',
  'member_not_found',
  'member_not_in_wg',
  'member_not_verified',
  'message_not_found',
  'mentions_invalid',
  'missing_parameter',
  'name_invalid',
  'no_content',
  'no_new_data',
  'no_open_splits',
  'not_a_member',
  'not_found',
  'not_owner',
  'not_payer',
  'not_split_party',
  'not_verified',
  'out_of_stock',
  'paid_by_must_include_caller',
  'paypal_payment_pending',
  'quantity_invalid',
  'quiet_hours_invalid',
  'rate_limit_exceeded',
  'reaction_invalid',
  'reason_invalid',
  'recurring_currency_unsupported',
  'recurring_expense_already_advanced',
  'recurring_expense_not_found',
  'recurrence_invalid',
  'refresh_ids_invalid',
  'role_required',
  'same_member',
  'session_expired',
  'settled_invalid',
  'settlement_changed',
  'settlement_review_required',
  'shopping_empty',
  'shopping_item_changed',
  'shopping_item_duplicate',
  'sort_invalid',
  'sort_unsupported',
  'split_not_found',
  'splits_duplicate_debtor',
  'splits_invalid',
  'splits_sum_mismatch',
  'splits_required_with_amount',
  'status_change_not_allowed',
  'status_invalid',
  'to_invalid',
  'timeout',
  'title_invalid',
  'too_many_requests',
  'unauthorized',
  'unverified_provider',
  'upstream_error',
  'user_banned',
  'user_not_found',
  'validation_errors',
  'version_conflict',
  'wg_not_found',
  'wg_update_forbidden',
  'wg_update_invalid',
]);

const AUTH_RETRY_CODES = new Set(['auth_required', 'member_deactivated', 'not_a_member']);
const DETAIL_SAFE_CODE = 'validation_errors';

/** 429 plus the transient server failures worth another attempt. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [200, 800];
/** Longer rate limits are surfaced instead of slept out inside a tool call. */
const DEFAULT_MAX_AUTO_RETRY_DELAY_MS = 2_000;

export type ClientRetryOptions = {
  retryDelaysMs?: number[];
  maxAutoRetryDelayMs?: number;
};

export class ManaWgError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    status: number,
    options: { details?: string; retryAfterSeconds?: number } = {},
  ) {
    super(`ManaWG request failed: ${code}`);
    this.name = 'ManaWgError';
    this.code = code;
    this.status = status;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

function isSafeCode(value: unknown): value is string {
  return typeof value === 'string' && SAFE_UPSTREAM_CODES.has(value);
}

function truncate(value: string): string {
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
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

export function createManaWgClient(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
  auth?: SessionController,
  retryOptions: ClientRetryOptions = {},
): ManaWgClient {
  const retryDelaysMs = retryOptions.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxAutoRetryDelayMs = retryOptions.maxAutoRetryDelayMs ?? DEFAULT_MAX_AUTO_RETRY_DELAY_MS;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  /** Milliseconds to wait before the next attempt, or undefined to give up. */
  function nextDelay(response: Response, fallbackMs: number): number | undefined {
    if (response.status === 429) {
      const seconds = retryAfterSeconds(response);
      const delay = seconds === undefined ? fallbackMs : seconds * 1000;
      return delay <= maxAutoRetryDelayMs ? delay : undefined;
    }
    if (RETRYABLE_STATUS.has(response.status)) {
      return fallbackMs;
    }
    return undefined;
  }
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

  const configIdentity: MemberIdentity | undefined =
    isMemberId(config.memberId) && isMemberToken(config.memberToken)
      ? { memberId: config.memberId, memberToken: config.memberToken }
      : undefined;

  let identity: MemberIdentity | undefined;
  let identitySettled = false;
  let identityInflight: Promise<void> | undefined;

  function readIdentityCache(): MemberIdentity | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(config.identityCachePath, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as { memberId?: unknown; memberToken?: unknown };
        if (isMemberId(record.memberId)) {
          const token = isMemberToken(record.memberToken) ? record.memberToken : undefined;
          return { memberId: record.memberId, ...(token ? { memberToken: token } : {}) };
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  function writeIdentityCache(value: MemberIdentity): void {
    try {
      mkdirSync(dirname(config.identityCachePath), { recursive: true });
      writeFileSync(config.identityCachePath, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
      });
      chmodSync(config.identityCachePath, 0o600);
    } catch {
      // A read-only cache location must not break tool calls.
    }
  }

  async function bootstrapIdentity(): Promise<MemberIdentity> {
    const payload = (await decode(await send({ path: [] }, undefined))) as
      | { currentMember?: { memberId?: unknown; memberToken?: unknown } }
      | undefined;
    const member = payload?.currentMember;
    if (isMemberId(member?.memberId)) {
      const token = isMemberToken(member.memberToken) ? member.memberToken : undefined;
      return { memberId: member.memberId, ...(token ? { memberToken: token } : {}) };
    }
    throw new ManaWgError('identity_unavailable', 0);
  }

  function isTransient(error: unknown): boolean {
    if (!(error instanceof ManaWgError)) {
      return false;
    }
    return error.code === 'upstream_network_error' || error.status === 429 || error.status >= 500;
  }

  async function loadIdentity(): Promise<MemberIdentity | undefined> {
    const cached = readIdentityCache();
    if (cached) {
      identitySettled = true;
      return cached;
    }
    try {
      const found = await bootstrapIdentity();
      writeIdentityCache(found);
      identitySettled = true;
      return found;
    } catch (error) {
      if (!isTransient(error)) {
        // Upstream answered: this process knows there is no usable identity.
        identitySettled = true;
      }
      return undefined;
    }
  }

  async function ensureIdentity(): Promise<MemberIdentity | undefined> {
    if (configIdentity) {
      return configIdentity;
    }
    if (identitySettled) {
      return identity;
    }
    identityInflight ??= loadIdentity().then((value) => {
      identity = value;
    });
    await identityInflight;
    identityInflight = undefined;
    return identity;
  }

  async function perform(
    request: WgRequest,
    identity: MemberIdentity | undefined,
    idempotencyKey?: string,
    retried = false,
  ): Promise<Response> {
    const method = request.method ?? 'GET';
    const headers = new Headers({
      accept: 'application/json',
      origin: config.origin,
    });
    if (identity) {
      headers.set('x-manawg-member-id', identity.memberId);
      if (identity.memberToken !== undefined) {
        headers.set('x-manawg-member-token', identity.memberToken);
      }
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

    if (!retried && auth && response.status === 401) {
      const payload = await cloneJson(response);
      const code = safeCode(payload, response.status);
      if (AUTH_RETRY_CODES.has(code)) {
        auth.invalidate();
        return perform(request, identity, idempotencyKey, true);
      }
    }
    return response;
  }

  async function cloneJson(response: Response): Promise<unknown> {
    try {
      return await response.clone().json();
    } catch {
      return undefined;
    }
  }

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

  async function decode(response: Response): Promise<unknown> {
    const payload = await response.json().catch(() => undefined);
    if (response.ok) {
      if (payload === undefined || response.status === 204) {
        return {};
      }
      return payload;
    }
    const code = safeCode(payload, response.status);
    const options: { details?: string; retryAfterSeconds?: number } = {};
    if (code === DETAIL_SAFE_CODE && typeof payload === 'object' && payload !== null) {
      const details = (payload as { details?: unknown }).details;
      if (details !== undefined && details !== null) {
        const text = typeof details === 'string' ? details : JSON.stringify(details);
        if (text && text !== '{}') {
          options.details = truncate(text);
        }
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

  /** One request with bounded retries: transient statuses, rate limits and network failures. */
  async function send(
    request: WgRequest,
    identity: MemberIdentity | undefined,
    idempotencyKey?: string,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await perform(request, identity, idempotencyKey);
      } catch (error) {
        const lastAttempt = attempt >= retryDelaysMs.length;
        if (
          lastAttempt ||
          !(error instanceof ManaWgError) ||
          error.code !== 'upstream_network_error'
        ) {
          throw error;
        }
        await sleep(retryDelaysMs[attempt]);
        continue;
      }

      const delay =
        attempt >= retryDelaysMs.length ? undefined : nextDelay(response, retryDelaysMs[attempt]);
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
      const resolvedIdentity = request.scope === 'account' ? undefined : await ensureIdentity();
      const isWrite = (request.method ?? 'GET') !== 'GET';
      const idempotencyKey = isWrite ? randomUUID() : undefined;
      return decode(await send(request, resolvedIdentity, idempotencyKey));
    },
  };
}
