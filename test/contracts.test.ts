import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { SAFE_UPSTREAM_CODES } from '../src/errors.js';
import { buildServer } from '../src/server.js';
import { TOOL_DEFS } from '../src/tools/registry.js';

// Request shapes pinned against the real ManaWG API routes (apps/web/src/app/api/wg/**).

const ID = '00000000-0000-4000-8000-000000000002';
const OTHER_ID = '00000000-0000-4000-8000-000000000003';

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

async function connect(payload: unknown = {}) {
  const fake = { call: vi.fn().mockResolvedValue(payload) };
  const server: McpServer = buildServer(fake, { allowDestructive: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contracts', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  cleanup.push(() => client.close());
  cleanup.push(() => server.close());
  return { client, fake };
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

it('has no tool for a route the app does not serve', () => {
  expect(TOOL_DEFS.map((tool) => tool.name)).not.toContain('search');
});

it('keeps tool names unique', () => {
  const names = TOOL_DEFS.map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);
});

it('creates a WG on the bare account collection, not on /wg/wg', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'wg_create', { name: 'WG', creatorName: 'Ada' });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: [],
    scope: 'account',
    body: { name: 'WG', creatorName: 'Ada' },
  });
});

it('limits creatorName to the 80 characters the app accepts', async () => {
  const { client } = await connect();
  const result = await callTool(client, 'wg_create', { name: 'WG', creatorName: 'a'.repeat(81) });
  expect(result.isError).toBe(true);
});

it('strips settlement_commit.expected down to the keys the app accepts', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'settlement_commit', {
    fromMemberId: ID,
    toMemberId: OTHER_ID,
    currency: 'EUR',
    expected: {
      currency: 'EUR',
      netCents: 500,
      settleableCents: 500,
      remainingCents: 0,
      reason: 'no_direct_splits',
      splits: [{ id: ID, expenseId: OTHER_ID, amountCents: 500 }],
    },
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['expenses', 'settle-batch'],
    body: {
      fromMemberId: ID,
      toMemberId: OTHER_ID,
      currency: 'EUR',
      expected: {
        currency: 'EUR',
        netCents: 500,
        settleableCents: 500,
        splits: [{ id: ID, amountCents: 500 }],
      },
    },
  });
});

it('books a recurring charge through expense_create with both fields or neither', async () => {
  const { client, fake } = await connect();
  const base = {
    amountCents: 1000,
    description: 'Miete',
    splits: [{ debtorMemberId: ID, amountCents: 1000 }],
  };

  const lone = await callTool(client, 'expense_create', { ...base, recurringExpenseId: ID });
  expect(lone.isError).toBe(true);
  expect(fake.call).not.toHaveBeenCalled();

  await callTool(client, 'expense_create', {
    ...base,
    recurringExpenseId: ID,
    expectedRecurringNextDueAt: '2026-11-01T00:00:00Z',
  });
  expect(fake.call).toHaveBeenCalledTimes(1);
});

it('advances a recurring template with a mandatory expectedNextDueAt only', async () => {
  const { client, fake } = await connect();
  const missing = await callTool(client, 'recurring_advance', { id: ID });
  expect(missing.isError).toBe(true);
  const override = await callTool(client, 'recurring_advance', {
    id: ID,
    expectedNextDueAt: '2026-11-01T00:00:00Z',
    amountCents: 1,
  });
  expect(override.isError).toBe(true);
  expect(fake.call).not.toHaveBeenCalled();
});

it('sends the legacy proof headers for member_claim', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'member_claim', { id: ID, legacyMemberToken: 'f'.repeat(64) });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['members', ID, 'claim'],
    headers: { 'x-manawg-member-id': ID, 'x-manawg-member-token': 'f'.repeat(64) },
  });
  const bad = await callTool(client, 'member_claim', { id: ID, legacyMemberToken: 'short' });
  expect(bad.isError).toBe(true);
});

it('maps monthly chores to recurrenceType months and rejects free-form types', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'chore_create', {
    title: 'Bad',
    intervalDays: 3,
    recurrenceType: 'months',
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'POST',
    path: ['chores'],
    body: { title: 'Bad', intervalDays: 3, recurrenceType: 'months' },
  });
  const bad = await callTool(client, 'chore_create', { title: 'Bad', recurrenceType: 'weekly' });
  expect(bad.isError).toBe(true);
  const dropped = await callTool(client, 'chore_create', { title: 'Bad', intervalMonths: 2 });
  expect(dropped.isError).toBe(true);
});

it('removes a chat reaction with DELETE and the emoji as query', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'chat_unreact', { id: ID, emoji: '👍' });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'DELETE',
    path: ['chat', 'messages', ID, 'reactions'],
    query: { emoji: '👍' },
  });
});

it('rejects more than 20 chat mentions and a zero inventory delta', async () => {
  const { client, fake } = await connect();
  const mentions = await callTool(client, 'chat_send', {
    body: 'hi',
    mentionMemberIds: Array.from({ length: 21 }, () => ID),
  });
  const zero = await callTool(client, 'inventory_consume', { id: ID, delta: 0 });
  expect(mentions.isError).toBe(true);
  expect(zero.isError).toBe(true);
  expect(fake.call).not.toHaveBeenCalled();
});

it('exports json with sections and csv with a single section', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'export_get', { sections: ['members', 'events'] });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['export'],
    query: { format: 'json', sections: 'members,events' },
  });
  await callTool(client, 'export_get', { format: 'csv', section: 'chatMessages' });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'GET',
    path: ['export'],
    query: { format: 'csv', section: 'chatMessages' },
  });
});

it('lets event_update clear optional fields with null', async () => {
  const { client, fake } = await connect();
  await callTool(client, 'event_update', {
    id: ID,
    endsAt: null,
    location: null,
    description: null,
  });
  expect(fake.call).toHaveBeenLastCalledWith({
    method: 'PATCH',
    path: ['events', ID],
    body: { endsAt: null, location: null, description: null },
  });
});

it('keeps every error code a tool description promises on the allowlist', () => {
  const missing: string[] = [];
  for (const tool of TOOL_DEFS) {
    for (const [code] of tool.description.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)) {
      if (code.endsWith('_invalid') || code.endsWith('_changed') || code.endsWith('_pending')) {
        if (!SAFE_UPSTREAM_CODES.has(code)) {
          missing.push(`${tool.name}:${code}`);
        }
      }
    }
  }
  expect(missing).toEqual([]);
});
