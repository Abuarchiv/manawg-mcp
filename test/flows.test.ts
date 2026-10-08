import { afterEach, expect, it } from 'vitest';
import { TOOL_DEFS } from '../src/tools/registry.js';
import { type Harness, MEMBER_A, MEMBER_B, startHarness } from './helpers/app.js';

// Whole-system regression flows: real session controller + HTTP client + MCP server against a
// stateful stub of the ManaWG app (see helpers/app.ts).

const open: Harness[] = [];

afterEach(async () => {
  while (open.length > 0) {
    await open.pop()?.close();
  }
});

async function harness(options: Parameters<typeof startHarness>[0] = {}) {
  const started = await startHarness(options);
  open.push(started);
  return started;
}

function resourceJson(result: { contents: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.contents[0] as { text: string }).text);
}

it('keeps one session across tools and resources, and recovers when it is revoked', async () => {
  const h = await harness();

  await h.call('dashboard_get');
  await h.client.readResource({ uri: 'manawg://current/dashboard' });
  expect(h.app.tokenCalls()).toBe(1);

  h.app.revokeSession();
  await h.call('dashboard_get');
  expect(h.app.tokenCalls()).toBe(2);
});

it('walks the shopping list: duplicates and stale versions are reported, a re-read fixes them', async () => {
  const h = await harness();

  await h.call('shopping_add', { name: '  Milch ', quantity: '2' });
  expect(await h.callError('shopping_add', { name: 'Milch' })).toContain('shopping_item_duplicate');

  const [item] = (await h.call('shopping_list')).items as Array<{
    id: string;
    updatedAt: string;
    boughtAt: string | null;
  }>;
  const stale = {
    id: item?.id,
    bought: true,
    expectedUpdatedAt: '2020-01-01T00:00:00Z',
    expectedBoughtAt: null,
  };
  expect(await h.callError('shopping_set_bought', stale)).toContain('shopping_item_changed');

  await h.call('shopping_set_bought', {
    id: item?.id,
    bought: true,
    expectedUpdatedAt: item?.updatedAt,
    expectedBoughtAt: item?.boughtAt,
  });
  expect(h.app.state.shopping[0]?.bought).toBe(true);
});

it('completes a monthly chore once and refuses a second completion of the old occurrence', async () => {
  const h = await harness();

  const created = (await h.call('chore_create', {
    title: 'Bad putzen',
    intervalDays: 1,
    recurrenceType: 'months',
    nextDueAt: '2026-11-01T08:00:00.000Z',
    assignedMemberId: MEMBER_A,
  })) as { chore: { id: string; nextDueAt: string } };
  expect(h.app.seen.at(-1)?.body).toMatchObject({ recurrenceType: 'months', intervalDays: 1 });

  const completion = {
    id: created.chore.id,
    expectedNextDueAt: created.chore.nextDueAt,
    expectedAssignedMemberId: MEMBER_A,
  };
  await h.call('chore_complete', completion);
  expect(await h.callError('chore_complete', completion)).toContain('chore_occurrence_changed');
});

it('books an expense, previews the settlement and commits the preview unchanged', async () => {
  const h = await harness();
  const splits = [{ debtorMemberId: MEMBER_B, amountCents: 1200 }];

  expect(
    await h.callError('expense_create', { amountCents: 1000, description: 'Pizza', splits }),
  ).toContain('splits_sum_mismatch');
  await h.call('expense_create', { amountCents: 1200, description: 'Pizza', splits });

  const preview = await h.call('settlement_preview', {
    fromMemberId: MEMBER_B,
    toMemberId: MEMBER_A,
  });
  expect(preview.settleableCents).toBe(1200);

  // The app rejects unknown keys in `expected`; the preview carries extra ones.
  await h.call('settlement_commit', {
    fromMemberId: MEMBER_B,
    toMemberId: MEMBER_A,
    currency: 'EUR',
    expected: preview,
  });
});

it('sends an idempotency key on every write and none on reads', async () => {
  const h = await harness();

  await h.call('shopping_list');
  await h.call('shopping_add', { name: 'Brot' });

  const [read, write] = h.app.seen.filter((entry) => entry.path.endsWith('/shopping'));
  expect(read?.idempotencyKey).toBeUndefined();
  expect(write?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

it('adds and removes a chat reaction', async () => {
  const h = await harness();
  const message = '00000000-0000-4000-8000-0000000000c1';

  await h.call('chat_react', { id: message, emoji: '👍' });
  expect(h.app.state.reactions).toEqual(['👍']);
  await h.call('chat_unreact', { id: message, emoji: '👍' });
  expect(h.app.state.reactions).toEqual([]);
});

it('keeps destructive tools out of the default surface and offers them on request', async () => {
  const off = await harness();
  const on = await harness({ allowDestructive: true });

  const defaultNames = (await off.client.listTools()).tools.map((tool) => tool.name);
  const gatedNames = (await on.client.listTools()).tools.map((tool) => tool.name);

  expect(defaultNames).not.toContain('expense_delete');
  expect(gatedNames).toContain('expense_delete');
  // Deleting, notifying people and money outside the app stay gated. The one ungated DELETE
  // is taking back your own chat reaction, which is as harmless as adding it.
  const exposed = TOOL_DEFS.filter((tool) => tool.gate !== 'destructive');
  expect(exposed.filter((tool) => tool.method === 'DELETE').map((tool) => tool.name)).toEqual([
    'chat_unreact',
  ]);
  expect(exposed.map((tool) => tool.name)).not.toContain('reminder_send');
  expect(exposed.map((tool) => tool.name)).not.toContain('paypal_capture');
});

it('retries transient failures, reusing the idempotency key on writes', async () => {
  const h = await harness();

  h.app.failNext(2, 503);
  await h.call('shopping_list');

  h.app.failNext(1, 502);
  await h.call('shopping_add', { name: 'Eier' });
  const attempts = h.app.seen.filter((entry) => entry.method === 'POST');
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.idempotencyKey).toBe(attempts[1]?.idempotencyKey);
});

it('reports long rate limits with retry_after_s instead of sleeping, and never leaks upstream bodies', async () => {
  const h = await harness();

  h.app.failNext(1, 429, { 'retry-after': '120' });
  const message = await h.callError('shopping_list');

  expect(message).toBe('ManaWG request failed: too_many_requests retry_after_s=120');
  expect(message).not.toContain('do-not-leak');
});

it('reports an unreachable app without revealing its address', async () => {
  const h = await harness();
  await h.call('dashboard_get');
  await h.app.goOffline();

  const message = await h.callError('dashboard_get');

  expect(message).toBe('ManaWG request failed: upstream_network_error');
  expect(message).not.toContain('127.0.0.1');
});

it('bounds large payloads and pages the expense list', async () => {
  const h = await harness();
  h.app.state.expenses = Array.from({ length: 250 }, (_, i) => ({
    id: `e${i}`,
    amountCents: i,
    description: 'x',
    splits: [],
  }));

  const resource = resourceJson(await h.client.readResource({ uri: 'manawg://current/expenses' }));
  expect((resource.expenses as unknown[]).length).toBe(100);
  expect(resource._mcp).toEqual({ truncated: true, fields: ['expenses'] });

  const page = (await h.call('expenses_list', { limit: 20, offset: 240 })) as {
    expenses: Array<{ id: string }>;
    total: number;
    hasMore: boolean;
  };
  expect(page.expenses.map((expense) => expense.id)[0]).toBe('e240');
  expect(page.expenses).toHaveLength(10);
  expect(page).toMatchObject({ total: 250, hasMore: false });
});

it('returns the CSV export as text', async () => {
  const h = await harness();

  expect(await h.call('export_get', { format: 'csv', section: 'expenses' })).toEqual({
    contentType: 'text/csv; charset=utf-8',
    content: 'id,description\n1,Pizza\n',
  });
  expect(h.app.seen.at(-1)?.query).toEqual({ format: 'csv', section: 'expenses' });
});

it('reaches account routes without the WG code', async () => {
  const h = await harness({ allowDestructive: true });

  const mine = await h.call('wg_list');
  expect(mine.wgs).toHaveLength(1);
  await h.call('wg_create', { name: 'Zweite WG', creatorName: 'Ada' });

  expect(h.app.seen.map((entry) => entry.path)).toEqual(['/api/wg/mine', '/api/wg']);
});

it('serves entity resources by id and refuses malformed ids before any request', async () => {
  const h = await harness();
  const before = h.app.seen.length;

  await expect(h.client.readResource({ uri: 'manawg://current/event/not-a-uuid' })).rejects.toThrow(
    'ManaWG request failed',
  );
  expect(h.app.seen.length).toBe(before);

  await h.client.readResource({ uri: `manawg://current/event/${MEMBER_A}` });
  expect(h.app.seen.at(-1)?.path).toBe(`/api/wg/WG123/events/${MEMBER_A}`);
});
