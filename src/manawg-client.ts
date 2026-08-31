import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';

const RETRYABLE_WRITE_STATUS = new Set([502, 503, 504]);

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

  if (!response.ok) {
    throw toUpstreamError(response.status, payload);
  }

  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('upstream_invalid_json');
  }
}

function toUpstreamError(status: number, payload: unknown): Error {
  if (payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string') {
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
