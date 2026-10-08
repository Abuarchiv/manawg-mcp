import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ManaWgError } from '../src/errors.js';
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
    'manawg://current/wg',
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
  const expectedNextDueAt = '2026-09-27T12:00:00.000Z';

  const result = await client.callTool({
    name: 'chore_complete',
    arguments: { id: VALID_ID, expectedNextDueAt, expectedAssignedMemberId: null },
  });

  expect(fake.call).toHaveBeenCalledWith({
    method: 'POST',
    path: ['chores', VALID_ID, 'complete'],
    body: { expectedNextDueAt, expectedAssignedMemberId: null },
  });
  expect(result.structuredContent).toEqual({ chore: { id: VALID_ID, completed: true } });
});

it('routes shopping_set_bought with the item version', async () => {
  const fake = fakeClient({ item: { id: VALID_ID, boughtAt: null } });
  const client = await connectTestServer(buildServer(fake));
  const expectedUpdatedAt = '2026-09-27T12:00:00.000Z';

  await client.callTool({
    name: 'shopping_set_bought',
    arguments: { id: VALID_ID, bought: true, expectedUpdatedAt, expectedBoughtAt: null },
  });

  expect(fake.call).toHaveBeenCalledWith({
    method: 'PATCH',
    path: ['shopping', VALID_ID],
    body: { bought: true, expectedUpdatedAt, expectedBoughtAt: null },
  });
});

it('rejects empty member updates and direct PayPal merchant-ID edits', async () => {
  for (const input of [
    { id: VALID_ID },
    { id: VALID_ID, active: false, paypalMerchantId: '2B23456789ABC' },
    { id: VALID_ID, active: true, paypalMerchantId: null },
  ]) {
    const fake = fakeClient();
    const client = await connectTestServer(buildServer(fake, { allowDestructive: true }));
    const result = await client.callTool({ name: 'member_update', arguments: input });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
      /Input validation error|invalid_input/,
    );
    expect(fake.call).not.toHaveBeenCalled();
  }
});

it('routes member_update only with the app-supported active field', async () => {
  const fake = fakeClient({ member: { id: VALID_ID, active: false } });
  const client = await connectTestServer(buildServer(fake, { allowDestructive: true }));

  const result = await client.callTool({
    name: 'member_update',
    arguments: { id: VALID_ID, active: false },
  });

  expect(fake.call).toHaveBeenCalledWith({
    method: 'PATCH',
    path: ['members', VALID_ID],
    body: { active: false },
  });
  expect(result.isError).not.toBe(true);
});

it('documents browser-only PayPal linking and capture reconciliation', async () => {
  const client = await connectTestServer(buildServer(fakeClient(), { allowDestructive: true }));
  const tools = (await client.listTools()).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const update = byName.get('member_update');

  expect(update?.inputSchema.properties).not.toHaveProperty('paypalMerchantId');
  expect(update?.description).toContain('WG-Einstellungen im Browser');
  const orderDescription = byName.get('paypal_order_create')?.description ?? '';
  const captureDescription = byName.get('paypal_capture')?.description ?? '';
  expect(orderDescription).toContain('WG-Einstellungen im Browser verbinden');
  expect(orderDescription).toContain('startet oder bestätigt keinen PayPal-Checkout');
  expect(orderDescription).not.toContain('paypal_recipient_missing');
  expect(orderDescription).not.toContain('paypal_onboarding_pending');
  expect(captureDescription).toContain('vom Zahler bestätigte Order');
  expect(captureDescription).toContain('PENDING');
  expect(captureDescription).toContain('COMPLETED');
  expect(captureDescription).toContain('FAILED/CANCELLED');
  for (const code of ['paypal_order_expired', 'paypal_order_not_found', 'paypal_not_configured']) {
    expect(captureDescription).not.toContain(code);
  }
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
  [
    'missing chore occurrence date',
    'chore_complete',
    { id: VALID_ID, expectedAssignedMemberId: null },
  ],
  [
    'missing chore assignment expectation',
    'chore_complete',
    { id: VALID_ID, expectedNextDueAt: '2026-09-27T12:00:00.000Z' },
  ],
  [
    'missing shopping updatedAt expectation',
    'shopping_set_bought',
    { id: VALID_ID, bought: true, expectedBoughtAt: null },
  ],
  [
    'missing shopping boughtAt expectation',
    'shopping_set_bought',
    { id: VALID_ID, bought: true, expectedUpdatedAt: '2026-09-27T12:00:00.000Z' },
  ],
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

it('routes the new read tools to their routes', async () => {
  const fake = fakeClient({ ok: true });
  const client = await connectTestServer(buildServer(fake));

  await client.callTool({ name: 'note_comments', arguments: { id: VALID_ID } });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['announcements', VALID_ID, 'comments'],
  });

  await client.callTool({ name: 'wg_list', arguments: {} });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['mine'],
    scope: 'account',
  });

  await client.callTool({
    name: 'recurring_advance',
    arguments: { id: VALID_ID, expectedNextDueAt: '2026-11-01T00:00:00Z' },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['recurring-expenses'],
    body: { id: VALID_ID, expectedNextDueAt: '2026-11-01T00:00:00Z' },
  });
});

it('reads the account-scoped wg resource', async () => {
  const fake = fakeClient({ wgs: [{ name: 'WG', code: 'K3P0AAAA' }] });
  const client = await connectTestServer(buildServer(fake));

  const result = await client.readResource({ uri: 'manawg://current/wg' });

  expect(fake.call).toHaveBeenCalledWith({ method: 'GET', path: ['mine'], scope: 'account' });
  expect((result.contents[0] as { text: string }).text).toBe(
    JSON.stringify({ wgs: [{ name: 'WG', code: 'K3P0AAAA' }] }),
  );
});

it('lists the entity resource templates and reads one', async () => {
  const fake = fakeClient({ event: { id: VALID_ID } });
  const client = await connectTestServer(buildServer(fake));

  const templates = (await client.listResourceTemplates()).resourceTemplates;
  expect(templates.map((template) => template.uriTemplate)).toEqual([
    'manawg://current/event/{id}',
    'manawg://current/chore/{id}',
    'manawg://current/member/{id}',
    'manawg://current/recurring/{id}',
  ]);

  const result = await client.readResource({ uri: `manawg://current/event/${VALID_ID}` });
  expect(fake.call).toHaveBeenCalledWith({ method: 'GET', path: ['events', VALID_ID] });
  expect((result.contents[0] as { text: string }).text).toBe(
    JSON.stringify({ event: { id: VALID_ID } }),
  );
});

it('refuses entity resources with a non-uuid id before calling upstream', async () => {
  const fake = fakeClient();
  const client = await connectTestServer(buildServer(fake));

  const message = await rejectedMessage(
    client.readResource({ uri: 'manawg://current/event/not-a-uuid' }),
  );

  expect(message).toContain('ManaWG request failed');
  expect(fake.call).not.toHaveBeenCalled();
});

it('exposes the documented prompts with their arguments', async () => {
  const client = await connectTestServer(buildServer(fakeClient()));

  const prompts = (await client.listPrompts()).prompts;
  expect(prompts.map((prompt) => prompt.name)).toEqual([
    'daily_brief',
    'shopping_run',
    'payment_reminder',
    'settlement_plan',
  ]);
  for (const prompt of prompts) {
    expect(prompt.description).toBeTruthy();
  }

  const brief = await client.getPrompt({ name: 'daily_brief', arguments: { fokus: 'Küche' } });
  const text = (brief.messages[0]?.content as { type: 'text'; text: string }).text;
  expect(text).toContain('dashboard_get');
  expect(text).toContain('Küche');

  const reminder = await client.getPrompt({ name: 'payment_reminder', arguments: {} });
  const reminderText = (reminder.messages[0]?.content as { type: 'text'; text: string }).text;
  expect(reminderText).toContain('reminder_send nicht aufrufen');
});

it('caps the expenses resource at 100 entries and announces truncation', async () => {
  const expenses = Array.from({ length: 250 }, (_, i) => ({ id: `e${i}`, amountCents: i }));
  const client = await connectTestServer(buildServer(fakeClient({ expenses, payments: [] })));

  const result = await client.readResource({ uri: 'manawg://current/expenses' });
  const payload = JSON.parse((result.contents[0] as { text: string }).text) as Record<
    string,
    unknown
  >;

  expect((payload.expenses as unknown[]).length).toBe(100);
  expect(payload._mcp).toEqual({ truncated: true, fields: ['expenses'] });
});

it('leaves a small expenses resource untouched', async () => {
  const payload = { expenses: [{ id: VALID_ID }], payments: [] };
  const client = await connectTestServer(buildServer(fakeClient(payload)));

  const result = await client.readResource({ uri: 'manawg://current/expenses' });

  expect((result.contents[0] as { text: string }).text).toBe(JSON.stringify(payload));
});

it('pages expenses_list with limit, offset, total and hasMore', async () => {
  const expenses = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}` }));
  const fake = fakeClient({ expenses, payments: [] });
  const client = await connectTestServer(buildServer(fake));

  const first = await client.callTool({ name: 'expenses_list', arguments: {} });
  const firstPayload = first.structuredContent as {
    expenses: unknown[];
    total: number;
    hasMore: boolean;
  };
  expect(firstPayload.expenses.length).toBe(100);
  expect(firstPayload.total).toBe(150);
  expect(firstPayload.hasMore).toBe(true);

  const second = await client.callTool({
    name: 'expenses_list',
    arguments: { limit: 20, offset: 140 },
  });
  const secondPayload = second.structuredContent as {
    expenses: Array<{ id: string }>;
    total: number;
    hasMore: boolean;
  };
  expect(secondPayload.expenses.map((expense) => expense.id)).toEqual([
    'e140',
    'e141',
    'e142',
    'e143',
    'e144',
    'e145',
    'e146',
    'e147',
    'e148',
    'e149',
  ]);
  expect(secondPayload.total).toBe(150);
  expect(secondPayload.hasMore).toBe(false);
  expect(fake.call).toHaveBeenLastCalledWith({ method: 'GET', path: ['expenses'] });
});

it('registers the coverage tools with the right annotations and gates', async () => {
  const client = await connectTestServer(buildServer(fakeClient(), { allowDestructive: true }));
  const tools = (await client.listTools()).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  expect(byName.has('import_preview')).toBe(true);
  expect(byName.has('import_commit')).toBe(true);
  expect(byName.has('paypal_order_create')).toBe(true);
  expect(byName.has('paypal_capture')).toBe(true);
  expect(byName.has('member_claim')).toBe(true);
  expect(byName.has('wg_create')).toBe(true);
  expect(byName.has('calendar_subscription_get')).toBe(true);

  expect(byName.get('import_preview')?.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
  });
  expect(byName.get('calendar_subscription_get')?.annotations?.readOnlyHint).toBe(true);
  for (const name of [
    'import_commit',
    'paypal_order_create',
    'paypal_capture',
    'member_claim',
    'wg_create',
  ]) {
    expect(byName.get(name)?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  }
});

it('routes coverage tools per scope with their bodies', async () => {
  const fake = fakeClient();
  const client = await connectTestServer(buildServer(fake, { allowDestructive: true }));

  await client.callTool({
    name: 'import_preview',
    arguments: { source: 'splitwise_csv', payload: 'Date,Betrag' },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['imports', 'preview'],
    body: { source: 'splitwise_csv', payload: 'Date,Betrag' },
  });

  await client.callTool({
    name: 'member_claim',
    arguments: { id: VALID_ID, legacyMemberToken: 'c'.repeat(64) },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['members', VALID_ID, 'claim'],
    headers: { 'x-manawg-member-id': VALID_ID, 'x-manawg-member-token': 'c'.repeat(64) },
  });

  await client.callTool({
    name: 'wg_create',
    arguments: { name: 'Zweite WG', creatorName: 'Ada' },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: [],
    scope: 'account',
    body: { name: 'Zweite WG', creatorName: 'Ada' },
  });

  await client.callTool({ name: 'calendar_subscription_get', arguments: {} });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['calendar-subscription'],
  });
});
