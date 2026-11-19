import type { Client } from '@modelcontextprotocol/client';
import { expect, it, vi } from 'vitest';
import type { WgRequest } from '../src/manawg-client.js';
import { buildServer } from '../src/server.js';
import { TOOL_DEFS } from '../src/tools/registry.js';
import { connectClient, useCleanup } from './helpers/app.js';

// Input rules the app enforces. The MCP must reject these calls itself, before any request, and
// the request shapes below must stay as the app expects them.

const ID = '00000000-0000-4000-8000-000000000002';
const NOW = '2026-11-01T00:00:00Z';

const later = useCleanup();

const send = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

async function connect({ allowDestructive = true } = {}) {
  const fake = { call: vi.fn().mockResolvedValue({}) };
  // The cancel signal is plumbing, not part of the request shape the app sees.
  const server = buildServer(
    { call: ({ signal: _signal, ...request }: WgRequest) => fake.call(request) },
    { allowDestructive },
  );
  const client = await connectClient(server, 'contracts');
  later(() => client.close());
  later(() => server.close());
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
  ['export_get', { format: 'csv', sections: ['members'] }],
  ['export_get', { section: 'members' }],
  ['events_list', { from: NOW }],
  ['events_list', { to: NOW }],
  ['event_create', { title: 'Party', startsAt: '0026-01-01T00:00:00Z' }],
  ['event_create', { title: 'Party', startsAt: '20266-01-01T00:00:00Z' }],
  [
    'event_occurrence_change',
    { id: ID, occurrenceStartsAt: NOW, action: 'cancel', expectedUpdatedAt: NOW },
  ],
  [
    'event_occurrence_change',
    { id: ID, occurrenceStartsAt: NOW, action: 'cancel', title: 'Moved' },
  ],
  ['note_update', { id: ID }],
  ['note_update', { id: ID, expectedUpdatedAt: NOW }],
  ['chore_create', { title: 'Bad', intervalDays: 61, recurrenceType: 'months' }],
  ['recurring_update', { id: ID, currency: 'CHF' }],
  [
    'recurring_create',
    {
      description: 'Rent',
      amountCents: 90_000,
      paidByMemberId: ID,
      nextDueAt: NOW,
      splits: [split],
      currency: 'CHF',
    },
  ],
  ['chat_messages', { before: NOW }],
  ['activity_get', { limit: 79 }],
  ['activity_get', { limit: 321 }],
  ['import_preview', { source: 'bogus_csv', payload: 'x' }],
  ['shopping_update', { id: ID }],
  ['inventory_update', { id: ID }],
  ['inventory_update', { id: ID, wgCode: 'K7Q2M9XD' }],
  ['inventory_update', { id: ID, quantity: 1, expectedQuantity: 2 }],
  ['inventory_update', { id: ID, quantity: 1, expectedUpdatedAt: NOW }],
  ['recurring_update', { id: ID }],
  ['recurring_update', { id: ID, expectedNextDueAt: NOW, wgCode: 'K7Q2M9XD' }],
])('refuses %s locally when the app would reject %j', async (name, args) => {
  const { client, fake } = await connect();

  const result = await client.callTool({ name, arguments: args });

  expect(result.isError).toBe(true);
  expect(fake.call).not.toHaveBeenCalled();
});

it('lists destructive tools only when allowed', async () => {
  const listed = async (allowDestructive: boolean) => {
    const { client } = await connect({ allowDestructive });
    return (await client.listTools()).tools;
  };
  const [guarded, unguarded] = [await listed(false), await listed(true)];
  const guardedNames = guarded.map((tool) => tool.name);
  const hidden = unguarded.filter((tool) => !guardedNames.includes(tool.name));

  expect(guardedNames).not.toEqual(
    expect.arrayContaining(['expense_delete', 'reminder_send', 'cash_payment_void']),
  );
  expect(guarded.filter((tool) => tool.annotations?.destructiveHint)).toEqual([]);
  expect(hidden.map((tool) => tool.name).sort()).toEqual(
    TOOL_DEFS.filter((tool) => tool.gate)
      .map((tool) => tool.name)
      .sort(),
  );
  expect(hidden.every((tool) => tool.annotations?.destructiveHint)).toBe(true);
});

it('sends the export sections as one comma-separated query value', async () => {
  const { client, fake } = await connect();

  await send(client, 'export_get', { sections: ['choreCompletions', 'inventory'] });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['export'],
    query: { format: 'json', sections: 'choreCompletions,inventory' },
  });
});

it('sends null to clear optional event fields', async () => {
  const { client, fake } = await connect();

  await send(client, 'event_update', { id: ID, endsAt: null, location: null });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['events', ID],
    body: { endsAt: null, location: null },
  });
});

it('links an expense to the recurring expense it books', async () => {
  const { client, fake } = await connect();

  await send(client, 'expense_create', {
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

it('sends the recurrence of a monthly chore', async () => {
  const { client, fake } = await connect();

  await send(client, 'chore_create', {
    title: 'Bad putzen',
    intervalDays: 1,
    recurrenceType: 'months',
  });

  expect(fake.call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ recurrenceType: 'months', intervalDays: 1 }),
    }),
  );
});

it('sends only the name the app accepts for wg_update', async () => {
  const { client, fake } = await connect();

  await send(client, 'wg_update', { name: '  Sonnen-WG ' });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: [],
    body: { name: 'Sonnen-WG' },
  });
});

it('trims the chat_send body and forwards replyToMessageId', async () => {
  const { client, fake } = await connect();

  await send(client, 'chat_send', { body: ' hi ', replyToMessageId: ID });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['chat', 'messages'],
    body: { body: 'hi', replyToMessageId: ID },
  });
});

it('accepts two-decimal inventory quantities like the app', async () => {
  const { client, fake } = await connect();

  await send(client, 'inventory_add', { name: 'Milk', quantity: 1.25, threshold: 0.5 });
  expect(fake.call).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ quantity: 1.25, threshold: 0.5 }),
    }),
  );

  await send(client, 'inventory_update', {
    id: ID,
    quantity: 2.5,
    expectedQuantity: 1.25,
    expectedUpdatedAt: NOW,
    quantityDelta: -0.75,
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

it('sends the notification flags it is given', async () => {
  const { client, fake } = await connect();

  await send(client, 'notifications_update', { notifyStatementEmail: false });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['notifications'],
    body: { notifyStatementEmail: false },
  });
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

it('pages chat_messages with beforeId and limit', async () => {
  const { client, fake } = await connect();

  await send(client, 'chat_messages', { beforeId: ID, limit: 20 });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['chat', 'messages'],
    query: { beforeId: ID, limit: 20 },
  });
});

it('passes the activity_get limit through', async () => {
  const { client, fake } = await connect();

  await send(client, 'activity_get', { limit: 200 });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['activity'],
    query: { limit: 200 },
  });
});

it('sends the optimistic-lock guard of chore_update', async () => {
  const { client, fake } = await connect();

  await send(client, 'chore_update', { id: ID, title: 'Bins', expectedUpdatedAt: NOW });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['chores', ID],
    body: { title: 'Bins', expectedUpdatedAt: NOW },
  });
});

it.each(['tricount_csv', 'settleup_csv'])('previews an import from %s', async (source) => {
  const { client, fake } = await connect();

  await send(client, 'import_preview', { source, payload: 'x' });

  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['imports', 'preview'],
    body: { source, payload: 'x' },
  });
});

it('accepts a day interval above the months limit', async () => {
  const { client, fake } = await connect();

  await send(client, 'chore_create', { title: 'Bins', intervalDays: 61, recurrenceType: 'days' });

  expect(fake.call).toHaveBeenCalledTimes(1);
});

it('keeps the id of fixed-cost, supply and shopping calls where the app reads it', async () => {
  const { client, fake } = await connect();

  // The collection route of recurring-expenses takes the id in the body, not in the path.
  await send(client, 'recurring_advance', { id: ID, expectedNextDueAt: NOW });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['recurring-expenses'],
    body: { id: ID, expectedNextDueAt: NOW },
  });

  await send(client, 'recurring_delete', { id: ID });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'DELETE',
    path: ['recurring-expenses'],
    body: { id: ID },
  });

  await send(client, 'recurring_update', { id: ID, paused: true, expectedNextDueAt: NOW });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['recurring-expenses', ID],
    body: { paused: true, expectedNextDueAt: NOW },
  });

  await send(client, 'inventory_consume', { id: ID, delta: -2 });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['inventory', ID, 'consume'],
    body: { delta: -2 },
  });

  await send(client, 'inventory_update', { id: ID, quantityDelta: 3 });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['inventory', ID],
    body: { quantityDelta: 3 },
  });

  await send(client, 'shopping_set_bought', {
    id: ID,
    bought: true,
    expectedUpdatedAt: NOW,
    expectedBoughtAt: null,
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['shopping', ID],
    body: { bought: true, expectedUpdatedAt: NOW, expectedBoughtAt: null },
  });

  await send(client, 'shopping_update', {
    id: ID,
    quantity: null,
    expectedUpdatedAt: NOW,
    expectedBoughtAt: null,
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['shopping', ID],
    body: { quantity: null, expectedUpdatedAt: NOW, expectedBoughtAt: null },
  });
});

it('pages expenses_list over the full list the app returns', async () => {
  const { client, fake } = await connect();
  const expenses = Array.from({ length: 5 }, (_, index) => ({ id: `e${index}` }));
  fake.call.mockResolvedValueOnce({ expenses, payments: [] });

  const result = await send(client, 'expenses_list', { limit: 2, offset: 1 });

  expect(result.structuredContent).toEqual({
    expenses: expenses.slice(1, 3),
    payments: [],
    total: 5,
    hasMore: true,
  });
});
