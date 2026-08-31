import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';

const RETRYABLE_WRITE_STATUS = new Set([502, 503, 504]);
const SAFE_UPSTREAM_CODES = new Set([
  'bought_invalid',
  'chore_not_found',
  'db_error',
  'id_invalid',
  'invalid_body',
  'invalid_json',
  'invalid_share_code',
  'insert_failed',
  'member_deactivated',
  'member_id_invalid',
  'member_id_required',
  'member_not_verified',
  'name_invalid',
  'not_a_member',
  'quantity_invalid',
  'server_error',
  'shopping_item_duplicate',
  'too_many_requests',
  'wg_not_found',
]);
const INVALID_RESPONSE_BODY = Symbol('invalid-response-body');

type ShoppingItemInput = {
  name: string;
  quantity?: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  write?: boolean;
};

export function createManaWgClient(config: AppConfig, fetchImpl: typeof fetch = fetch) {
  return {
    getDashboard: () => requestJson(['dashboard']),
    getShopping: () => requestJson(['shopping']),
    addShoppingItem: (input: ShoppingItemInput) =>
      requestJson(['shopping'], { method: 'POST', body: input, write: true }),
    completeChore: (choreId: string) =>
      requestJson(['chores', choreId, 'complete'], { method: 'POST', write: true }),
  };

  async function requestJson(pathSegments: string[], options: RequestOptions = {}): Promise<unknown> {
    const idempotencyKey = options.write ? randomUUID() : undefined;
    const response = await performFetch(pathSegments, options, idempotencyKey);

    if (options.write && RETRYABLE_WRITE_STATUS.has(response.status)) {
      const retryResponse = await performFetch(pathSegments, options, idempotencyKey);
      return decodeJson(retryResponse);
    }

    return decodeJson(response);
  }

  async function performFetch(
    pathSegments: string[],
    options: RequestOptions,
    idempotencyKey?: string,
  ): Promise<Response> {
    try {
      return await fetchImpl(buildUrl(pathSegments), buildRequestInit(options, idempotencyKey));
    } catch (error) {
      throw sanitizeTransportError(error);
    }
  }

  function buildRequestInit(options: RequestOptions, idempotencyKey?: string): RequestInit {
    const headers = new Headers({
      'x-manawg-member-id': config.memberId,
      'x-manawg-member-token': config.memberToken,
    });

    if (idempotencyKey) {
      headers.set('Idempotency-Key', idempotencyKey);
    }

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    return {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(config.timeoutMs),
    };
  }

  function buildUrl(pathSegments: string[]): string {
    const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
    return `${config.baseUrl}/api/wg/${encodeURIComponent(config.wgCode)}/${encodedPath}`;
  }
}

async function decodeJson(response: Response): Promise<unknown> {
  const payload = await readJson(response);

  if (payload === INVALID_RESPONSE_BODY) {
    throw new Error(`upstream_http_${response.status}`);
  }

  if (!response.ok) {
    throw toUpstreamError(response.status, payload);
  }

  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return INVALID_RESPONSE_BODY;
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return INVALID_RESPONSE_BODY;
  }
}

function toUpstreamError(status: number, payload: unknown): Error {
  if (
    payload &&
    typeof payload === 'object' &&
    'code' in payload &&
    typeof payload.code === 'string' &&
    SAFE_UPSTREAM_CODES.has(payload.code)
  ) {
    return new Error(payload.code);
  }

  return new Error(`upstream_http_${status}`);
}

function sanitizeTransportError(error: unknown): Error {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new Error('upstream_request_timeout');
  }

  return new Error('upstream_network_error');
}
