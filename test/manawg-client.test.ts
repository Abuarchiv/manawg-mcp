import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { createManaWgClient } from '../src/manawg-client.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validConfig: AppConfig = {
  baseUrl: 'https://example.test',
  wgCode: 'WG123',
  memberId: '00000000-0000-4000-8000-000000000001',
  memberToken: 'a'.repeat(64),
  timeoutMs: 10_000,
};

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()!();
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function rejectedMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    throw error;
  }
  throw new Error('Expected promise to reject');
}

it('sends member headers and reads dashboard JSON', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ openShopping: [] }));
  const client = createManaWgClient(validConfig, fetchMock);

  await expect(client.getDashboard()).resolves.toEqual({ openShopping: [] });

  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.test/api/wg/WG123/dashboard',
    expect.objectContaining({ headers: expect.any(Headers), signal: expect.any(AbortSignal) }),
  );

  const headers = fetchMock.mock.calls[0]![1]!.headers as Headers;
  expect(headers.get('x-manawg-member-id')).toBe(validConfig.memberId);
  expect(headers.get('x-manawg-member-token')).toBe(validConfig.memberToken);
});

it('url-encodes the WG code when reading shopping data', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ items: [] }));
  const client = createManaWgClient({ ...validConfig, wgCode: 'WG 1/2' }, fetchMock);

  await client.getShopping();

  expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/api/wg/WG%201%2F2/shopping');
});

it('rejects redirects before member headers can reach another origin', async () => {
  let targetHeaders: IncomingMessage['headers'] | undefined;
  const targetBaseUrl = await listen((request, response) => {
    targetHeaders = request.headers;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ openShopping: [] }));
  });
  const sourceBaseUrl = await listen((_request, response) => {
    response.statusCode = 302;
    response.setHeader('location', `${targetBaseUrl}/capture`);
    response.end();
  });

  const client = createManaWgClient({ ...validConfig, baseUrl: sourceBaseUrl });

  await expect(client.getDashboard()).rejects.toThrow('upstream_network_error');
  expect(targetHeaders).toBeUndefined();
});

it('sends POST JSON with an idempotency key when adding a shopping item', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ item: { id: '1' } }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.addShoppingItem({ name: 'Milch', quantity: '2' });

  const options = fetchMock.mock.calls[0]![1]!;
  const headers = options.headers as Headers;
  expect(options.method).toBe('POST');
  expect(options.body).toBe(JSON.stringify({ name: 'Milch', quantity: '2' }));
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('Idempotency-Key')).toMatch(UUID_PATTERN);
  expect(headers.get('x-manawg-member-id')).toBe(validConfig.memberId);
  expect(headers.get('x-manawg-member-token')).toBe(validConfig.memberToken);
});

it('url-encodes the chore id when completing a chore', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
  const client = createManaWgClient(validConfig, fetchMock);

  await client.completeChore('chore/1');

  expect(fetchMock.mock.calls[0]![0]).toBe(
    'https://example.test/api/wg/WG123/chores/chore%2F1/complete',
  );
  expect(fetchMock.mock.calls[0]![1]!.method).toBe('POST');
});

it.each([502, 503, 504])(
  'retries one transient write for HTTP %i with the same idempotency key',
  async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, status))
      .mockResolvedValueOnce(jsonResponse({ item: { id: '1' } }));
    const client = createManaWgClient(validConfig, fetchMock);

    await client.addShoppingItem({ name: 'Milch' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0]![1]!.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]![1]!.headers as Headers;
    expect(firstHeaders.get('Idempotency-Key')).toBe(secondHeaders.get('Idempotency-Key'));
  },
);

it.each([
  [400, 'name_invalid'],
  [401, 'member_id_invalid'],
  [403, 'member_not_verified'],
  [404, 'wg_not_found'],
  [409, 'shopping_item_duplicate'],
  [429, 'too_many_requests'],
] as const)('does not retry HTTP %i writes', async (status, code) => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ error: `secret:${validConfig.memberToken}`, code }, status));
  const client = createManaWgClient(validConfig, fetchMock);

  const message = await rejectedMessage(client.addShoppingItem({ name: 'Milch' }));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(message).toBe(code);
  expect(message).not.toContain(validConfig.memberToken);
});

it('falls back to the HTTP status when the upstream error has no stable code', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse({ error: `secret:${validConfig.memberToken}` }, 500),
  );
  const client = createManaWgClient(validConfig, fetchMock);

  const message = await rejectedMessage(client.getDashboard());

  expect(message).toBe('upstream_http_500');
  expect(message).not.toContain(validConfig.memberToken);
});

it('falls back to the HTTP status when the upstream code is unknown or secret-bearing', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    jsonResponse(
      {
        error: 'conflict',
        code: `secret:${validConfig.memberToken}`,
      },
      409,
    ),
  );
  const client = createManaWgClient(validConfig, fetchMock);

  const message = await rejectedMessage(client.addShoppingItem({ name: 'Milch' }));

  expect(message).toBe('upstream_http_409');
  expect(message).not.toContain(validConfig.memberToken);
});

it('sanitizes response body read failures', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
    ok: false,
    status: 500,
    text: vi.fn().mockRejectedValue(new Error(`secret:${validConfig.memberToken}`)),
  } as unknown as Response);
  const client = createManaWgClient(validConfig, fetchMock);

  const message = await rejectedMessage(client.getDashboard());

  expect(message).toBe('upstream_http_500');
  expect(message).not.toContain(validConfig.memberToken);
});

it('sanitizes thrown transport errors', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error(`network:${validConfig.memberToken}`));
  const client = createManaWgClient(validConfig, fetchMock);

  const message = await rejectedMessage(client.getDashboard());

  expect(message).toBe('upstream_network_error');
  expect(message).not.toContain(validConfig.memberToken);
});
