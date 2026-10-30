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
