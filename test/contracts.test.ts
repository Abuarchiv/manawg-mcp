import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';

// Input rules that mirror the app's validators but that a stub app does not exercise: calls
// the app would reject must fail inside the MCP before any request, and the request shapes
// of tools that were wrong once stay pinned. Each case is a bug found in the contract audit.

const ID = '00000000-0000-4000-8000-000000000002';
const NOW = '2026-11-01T00:00:00Z';

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

async function connect() {
  const fake = { call: vi.fn().mockResolvedValue({}) };
  const server = buildServer(fake, { allowDestructive: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contracts', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  cleanup.push(
    () => client.close(),
    () => server.close(),
  );
  return { client, fake };
}

const split = { debtorMemberId: ID, amountCents: 1000 };

it.each([
  ['wg_create', { name: 'WG', creatorName: 'a'.repeat(81) }],
  [
    'expense_create',
    { amountCents: 1000, description: 'x', splits: [split], recurringExpenseId: ID },
  ],
  ['recurring_advance', { id: ID }],
  ['recurring_advance', { id: ID, expectedNextDueAt: NOW, amountCents: 1 }],
  ['chore_create', { title: 'Bad', recurrenceType: 'weekly' }],
  ['chore_create', { title: 'Bad', intervalMonths: 2 }],
  ['chat_send', { body: 'hi', mentionMemberIds: Array.from({ length: 21 }, () => ID) }],
  ['inventory_consume', { id: ID, delta: 0 }],
  ['inventory_consume', { id: ID, delta: -1.5 }],
  ['wg_update', {}],
  ['wg_update', { name: 'WG', joiningEnabled: false }],
  ['wg_update', { name: 'WG', rotateShareCode: true }],
  ['wg_update', { name: 'a'.repeat(101) }],
  ['chat_send', {}],
  ['chat_send', { body: 'hi', imageUrl: 'https://example.test/a.png' }],
  ['expense_update', { id: ID, currency: 'CHF' }],
  ['inventory_add', { name: 'Soap', quantity: 1.005 }],
  ['inventory_add', { name: 'Soap', threshold: 10_000 }],
  ['inventory_update', { id: ID, quantityDelta: 0.001 }],
  ['inventory_update', { id: ID, quantity: 1, expectedQuantity: 1.234, expectedUpdatedAt: NOW }],
  ['notifications_update', { notifyStatementEmail: 'yes' }],
  ['export_get', { sections: ['nonsense'] }],
])('refuses %s locally when the app would reject %j', async (name, args) => {
  const { client, fake } = await connect();

  const result = await client.callTool({ name, arguments: args });

  expect(result.isError).toBe(true);
  expect(fake.call).not.toHaveBeenCalled();
});

it('sends the request shapes the app expects', async () => {
  const { client, fake } = await connect();
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });

  await call('export_get', { sections: ['members', 'events'] });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['export'],
    query: { format: 'json', sections: 'members,events' },
  });

  await call('event_update', { id: ID, endsAt: null, location: null });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['events', ID],
    body: { endsAt: null, location: null },
  });

  await call('expense_create', {
    amountCents: 1000,
    description: 'Miete',
    splits: [split],
    recurringExpenseId: ID,
    expectedRecurringNextDueAt: NOW,
  });
  expect(fake.call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ recurringExpenseId: ID, expectedRecurringNextDueAt: NOW }),
    }),
  );
});

it('sends only the name the app accepts for wg_update', async () => {
  const { client, fake } = await connect();

  await client.callTool({ name: 'wg_update', arguments: { name: '  Sonnen-WG ' } });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: [],
    body: { name: 'Sonnen-WG' },
  });
});

it('sends chat_send as text only', async () => {
  const { client, fake } = await connect();

  await client.callTool({ name: 'chat_send', arguments: { body: ' hi ', replyToMessageId: ID } });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['chat', 'messages'],
    body: { body: 'hi', replyToMessageId: ID },
  });
});

it('accepts two-decimal inventory quantities like the app', async () => {
  const { client, fake } = await connect();

  await client.callTool({
    name: 'inventory_add',
    arguments: { name: 'Milk', quantity: 1.25, threshold: 0.5 },
  });
  expect(fake.call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ quantity: 1.25, threshold: 0.5 }),
    }),
  );

  await client.callTool({
    name: 'inventory_update',
    arguments: {
      id: ID,
      quantity: 2.5,
      expectedQuantity: 1.25,
      expectedUpdatedAt: NOW,
      quantityDelta: -0.75,
    },
  });
  expect(fake.call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: {
        quantity: 2.5,
        expectedQuantity: 1.25,
        expectedUpdatedAt: NOW,
        quantityDelta: -0.75,
      },
    }),
  );
});

it('sends the notification and export keys the app knows', async () => {
  const { client, fake } = await connect();

  await client.callTool({
    name: 'notifications_update',
    arguments: { notifyStatementEmail: false },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['notifications'],
    body: { notifyStatementEmail: false },
  });

  await client.callTool({
    name: 'export_get',
    arguments: { sections: ['choreCompletions', 'inventory'] },
  });
  expect(fake.call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ sections: 'choreCompletions,inventory' }),
    }),
  );
});

it('widens a bare-date events_list "to" to the end of that day', async () => {
  const { client, fake } = await connect();

  await client.callTool({
    name: 'events_list',
    arguments: { from: '2026-11-01', to: '2026-11-30' },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['events'],
    query: { from: '2026-11-01', to: '2026-11-30T23:59:59.999Z' },
  });

  await client.callTool({
    name: 'events_list',
    arguments: { from: '2026-11-01T00:00:00Z', to: '2026-11-30T12:00:00+01:00' },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['events'],
    query: { from: '2026-11-01T00:00:00Z', to: '2026-11-30T12:00:00+01:00' },
  });
});

it('forwards the offset flag of preview splits to settlement_commit', async () => {
  const { client, fake } = await connect();
  const other = '00000000-0000-4000-8000-000000000003';

  await client.callTool({
    name: 'settlement_commit',
    arguments: {
      fromMemberId: ID,
      toMemberId: other,
      currency: 'EUR',
      expected: {
        netCents: 700,
        settleableCents: 700,
        remainingCents: 0,
        splits: [
          { id: ID, expenseId: 'e', amountCents: 1000 },
          { id: other, expenseId: 'f', amountCents: 300, offset: true },
        ],
      },
    },
  });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['expenses', 'settle-batch'],
    body: {
      fromMemberId: ID,
      toMemberId: other,
      currency: 'EUR',
      expected: {
        currency: 'EUR',
        netCents: 700,
        settleableCents: 700,
        splits: [
          { id: ID, amountCents: 1000 },
          { id: other, amountCents: 300, offset: true },
        ],
      },
    },
  });
});
