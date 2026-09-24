import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ManaWgError } from '../src/manawg-client.js';
import { buildServer } from '../src/server.js';
import { TOOL_DEFS, selectTools } from '../src/tools/registry.js';

const SECRET = 's'.repeat(64);
const VALID_ID = '00000000-0000-4000-8000-000000000002';
const DESTRUCTIVE_NAMES = TOOL_DEFS.filter((tool) => tool.gate === 'destructive').map(
  (tool) => tool.name,
);
const SAFE_NAMES = TOOL_DEFS.filter((tool) => tool.gate !== 'destructive').map((tool) => tool.name);

type FakeClient = { call: ReturnType<typeof vi.fn> };

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

function fakeClient(payload: unknown = { items: [] }): FakeClient {
  return { call: vi.fn().mockResolvedValue(payload) };
}

async function connectTestServer(server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'manawg-mcp-test', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  cleanup.push(() => client.close());
  cleanup.push(() => server.close());

  return client;
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

it('registers every safe tool with a description and annotations', async () => {
  const client = await connectTestServer(buildServer(fakeClient()));
  const tools = (await client.listTools()).tools;

  expect(tools.map((tool) => tool.name)).toEqual(SAFE_NAMES);
  expect(DESTRUCTIVE_NAMES).toContain('expense_delete');
  expect(DESTRUCTIVE_NAMES).not.toContain('shopping_add');
  expect(tools.length).toBeGreaterThanOrEqual(50);

  for (const tool of tools) {
    expect(tool.description).toBeTruthy();
    expect(tool.title).toBeTruthy();
    expect(tool.annotations?.destructiveHint).toBe(false);
    expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
  }
});

it('hides destructive tools unless destructive mode is enabled', async () => {
  const client = await connectTestServer(buildServer(fakeClient(), { allowDestructive: true }));
  const tools = (await client.listTools()).tools;

  expect(tools.map((tool) => tool.name)).toEqual(
    selectTools(TOOL_DEFS, true).map((tool) => tool.name),
  );
  expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(DESTRUCTIVE_NAMES));

  const readOnly = tools.find((tool) => tool.name === 'dashboard_get');
  const destructive = tools.find((tool) => tool.name === 'expense_delete');
  expect(readOnly?.annotations?.readOnlyHint).toBe(true);
  expect(destructive?.annotations?.destructiveHint).toBe(true);
  expect(destructive?.annotations?.readOnlyHint).toBe(false);
});

it('exposes exactly the documented resource set', async () => {
  const client = await connectTestServer(buildServer(fakeClient()));

  expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual([
    'manawg://current/dashboard',
    'manawg://current/members',
    'manawg://current/expenses',
    'manawg://current/recurring',
    'manawg://current/shopping',
    'manawg://current/inventory',
    'manawg://current/chores',
    'manawg://current/notes',
    'manawg://current/chat',
    'manawg://current/events',
    'manawg://current/absences',
    'manawg://current/activity',
  ]);
});

it('routes shopping_add with trimmed input', async () => {
  const fake = fakeClient({ item: { name: 'Milch', quantity: '2' } });
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({
    name: 'shopping_add',
    arguments: { name: '  Milch  ', quantity: '  2  ' },
  });

  expect(fake.call).toHaveBeenCalledWith({
    method: 'POST',
    path: ['shopping'],
    body: { name: 'Milch', quantity: '2', bought: false },
  });
  expect(JSON.parse((result.content as Array<{ text: string }>)[0]?.text)).toEqual({
    item: { name: 'Milch', quantity: '2' },
  });
  expect(result.structuredContent).toEqual({ item: { name: 'Milch', quantity: '2' } });
});

it('routes chore_complete to the complete action', async () => {
  const fake = fakeClient({ chore: { id: VALID_ID, completed: true } });
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name: 'chore_complete', arguments: { id: VALID_ID } });

  expect(fake.call).toHaveBeenCalledWith({
    method: 'POST',
    path: ['chores', VALID_ID, 'complete'],
    body: {},
  });
  expect(result.structuredContent).toEqual({ chore: { id: VALID_ID, completed: true } });
});

it('routes path ids, bodies and query parameters per tool', async () => {
  const fake = fakeClient({ ok: true });
  const client = await connectTestServer(buildServer(fake));

  await client.callTool({
    name: 'expense_split_settle',
    arguments: { id: VALID_ID, splitId: VALID_ID, settled: false },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['expenses', VALID_ID, 'splits', VALID_ID, 'settle'],
    body: { settled: false },
  });

  await client.callTool({ name: 'members_list', arguments: { limit: 25, offset: 50 } });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['members'],
    query: { limit: 25, offset: 50 },
  });

  await client.callTool({ name: 'wg_overview', arguments: {} });
  expect(fake.call).toHaveBeenLastCalledWith({ method: 'GET', path: [] });

  await client.callTool({
    name: 'expense_create',
    arguments: {
      amountCents: 1500,
      description: 'Pizza',
      splits: [{ debtorMemberId: VALID_ID, amountCents: 1500 }],
    },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['expenses'],
    body: {
      amountCents: 1500,
      description: 'Pizza',
      splits: [{ debtorMemberId: VALID_ID, amountCents: 1500 }],
      currency: 'EUR',
    },
  });
});

const TOO_MANY_SPLITS = Array.from({ length: 51 }, () => ({
  debtorMemberId: VALID_ID,
  amountCents: 2,
}));

const invalidToolCalls: Array<[label: string, name: string, input: Record<string, unknown>]> = [
  ['empty name', 'shopping_add', { name: '', quantity: '2' }],
  ['whitespace name', 'shopping_add', { name: '   ', quantity: '2' }],
  ['name too long', 'shopping_add', { name: 'a'.repeat(121), quantity: '2' }],
  ['empty quantity', 'shopping_add', { name: 'Milch', quantity: '' }],
  ['quantity too long', 'shopping_add', { name: 'Milch', quantity: 'a'.repeat(41) }],
  ['unknown argument', 'shopping_add', { name: 'Milch', admin: true }],
  ['missing name', 'shopping_add', { quantity: '2' }],
  ['invalid chore id', 'chore_complete', { id: 'chore-1' }],
  ['zero amount', 'expense_create', { amountCents: 0, description: 'x', splits: [] }],
  [
    'too many splits',
    'expense_create',
    {
      amountCents: 100,
      description: 'x',
      splits: TOO_MANY_SPLITS,
    },
  ],
  ['consume delta above zero', 'inventory_consume', { id: VALID_ID, delta: 1 }],
  [
    'invalid chat cursor id',
    'chat_messages',
    {
      before: '2026-09-24T10:00:00+02:00',
      beforeId: 'nope',
    },
  ],
];

it.each(invalidToolCalls)('rejects %s at the MCP boundary', async (_label, name, input) => {
  const fake = fakeClient();
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name, arguments: input });

  expect(result.isError).toBe(true);
  expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
    /Input validation error|invalid_input/,
  );
  expect(fake.call).not.toHaveBeenCalled();
});

it('returns a safe tool error with the allowlisted upstream code', async () => {
  const fake = fakeClient();
  fake.call.mockRejectedValue(
    new ManaWgError('shopping_item_duplicate', 409, {
      details: `duplicate ${SECRET}`,
    }),
  );
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name: 'shopping_add', arguments: { name: 'Milch' } });

  expect(result.isError).toBe(true);
  expect((result.content as Array<{ text: string }>)[0]?.text).toBe(
    `ManaWG request failed: shopping_item_duplicate (duplicate ${SECRET})`,
  );
});

it('never leaks secrets or upstream URLs through tool errors', async () => {
  const fake = fakeClient();
  fake.call.mockRejectedValue(new Error(`leaked ${SECRET} https://example.test/api/wg/WG123`));
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name: 'shopping_add', arguments: { name: 'Milch' } });

  expect(result.isError).toBe(true);
  expect((result.content as Array<{ text: string }>)[0]?.text).toBe('ManaWG request failed');
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(JSON.stringify(result)).not.toContain('https://example.test');
});

it('includes retry-after seconds for rate limits', async () => {
  const fake = fakeClient();
  fake.call.mockRejectedValue(new ManaWgError('too_many_requests', 429, { retryAfterSeconds: 30 }));
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name: 'dashboard_get', arguments: {} });

  expect((result.content as Array<{ text: string }>)[0]?.text).toBe(
    'ManaWG request failed: too_many_requests retry_after_s=30',
  );
});

it('reads the dashboard resource as JSON', async () => {
  const fake = fakeClient({ today: [] });
  const client = await connectTestServer(buildServer(fake));

  const result = await client.readResource({ uri: 'manawg://current/dashboard' });

  expect(result.contents).toEqual([
    {
      uri: 'manawg://current/dashboard',
      mimeType: 'application/json',
      text: JSON.stringify({ today: [] }),
    },
  ]);
  expect(fake.call).toHaveBeenCalledWith({ method: 'GET', path: ['dashboard'] });
});

it('reads the chat resource with its default page size', async () => {
  const fake = fakeClient({ messages: [] });
  const client = await connectTestServer(buildServer(fake));

  await client.readResource({ uri: 'manawg://current/chat' });

  expect(fake.call).toHaveBeenCalledWith({
    method: 'GET',
    path: ['chat', 'messages'],
    query: { limit: 50 },
  });
});

it.each([
  ['dashboard', 'manawg://current/dashboard'],
  ['shopping', 'manawg://current/shopping'],
])('returns a safe resource error for %s client failures', async (_label, uri) => {
  const fake = fakeClient();
  fake.call.mockRejectedValue(new Error(`leaked ${SECRET} https://example.test/api/wg/WG123`));
  const client = await connectTestServer(buildServer(fake));

  const message = await rejectedMessage(client.readResource({ uri }));

  expect(message).toContain('ManaWG request failed');
  expect(message).not.toContain(SECRET);
  expect(message).not.toContain('https://example.test');
});

it('reports the allowlisted code on resource failures like tools do', async () => {
  const fake = fakeClient();
  fake.call.mockRejectedValue(new ManaWgError('too_many_requests', 429, { retryAfterSeconds: 30 }));
  const client = await connectTestServer(buildServer(fake));

  const message = await rejectedMessage(client.readResource({ uri: 'manawg://current/expenses' }));

  expect(message).toBe('ManaWG request failed: too_many_requests retry_after_s=30');
});

it('reports the package version as server version', async () => {
  const client = await connectTestServer(buildServer(fakeClient()));

  expect(client.getServerVersion()).toMatchObject({
    name: 'manawg-mcp',
    version: expect.any(String),
  });
  const pkg = (await import('../package.json', { with: { type: 'json' } })).default as {
    version: string;
  };
  expect(client.getServerVersion()?.version).toBe(pkg.version);
});
