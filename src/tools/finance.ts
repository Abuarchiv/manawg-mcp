import { z } from 'zod';
import {
  amountCents,
  currency,
  description,
  expenseCategory,
  imageUrl,
  isoDateTime,
  splitSchema,
  uuid,
} from './shared.js';
import { defineTool } from './types.js';

/** The `settlement_preview` payload; extra keys (remainingCents, expenseId, reason) are tolerated. */
const settlementPreview = z.looseObject({
  netCents: z.number().int().min(0),
  settleableCents: z.number().int().min(0),
  splits: z.array(z.looseObject({ id: uuid, amountCents: z.number().int().min(0) })).max(500),
});

export const financeTools = [
  defineTool({
    name: 'expenses_list',
    title: 'Read expenses and payments',
    description:
      'Expenses by occurredAt, newest first, with splits (debtorMemberId, amountCents, settledAt) and recorded payments. Page with limit 1..500 (default 100) and offset; the answer has total and hasMore. Basis for open balances and settlement_preview.',
    method: 'GET',
    input: z.strictObject({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }),
    path: () => ['expenses'],
    transform: (input, payload) => {
      const { limit, offset } = input as { limit: number; offset: number };
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return payload;
      }
      const record = payload as Record<string, unknown>;
      const all = Array.isArray(record.expenses) ? record.expenses : undefined;
      if (!all) {
        return payload;
      }
      const page = all.slice(offset, offset + limit);
      return {
        ...record,
        expenses: page,
        total: all.length,
        hasMore: offset + page.length < all.length,
      };
    },
  }),
  defineTool({
    name: 'expense_create',
    title: 'Create an expense',
    description:
      'New expense with debtor splits. amountCents 1..100000000, description max 200, category groceries|household|housing|leisure|transport|other (default other), splits 1..50 entries whose sum must equal amountCents exactly (error: splits_sum_mismatch). The caller must be the payer or a debtor (paid_by_must_include_caller). A due fixed cost is booked here: always send recurringExpenseId and expectedRecurringNextDueAt (nextDueAt from recurring_get) together; the app then creates the expense and advances the template atomically.',
    method: 'POST',
    input: z
      .strictObject({
        amountCents,
        description,
        category: expenseCategory.default('other'),
        splits: z.array(splitSchema).min(1).max(50),
        paidByMemberId: uuid.optional(),
        currency,
        occurredAt: isoDateTime.optional(),
        imageUrl,
        recurringExpenseId: uuid.optional(),
        expectedRecurringNextDueAt: isoDateTime.optional(),
      })
      .refine(
        (input) =>
          (input.recurringExpenseId === undefined) ===
          (input.expectedRecurringNextDueAt === undefined),
        {
          message: 'recurringExpenseId and expectedRecurringNextDueAt only together',
          path: ['recurringExpenseId'],
        },
      ),
    path: () => ['expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'expense_update',
    title: 'Edit an expense',
    description:
      'Only the payer may edit (not_payer). amountCents also needs the complete splits (splits_required_with_amount). expectedUpdatedAt (ISO) guards against concurrent edits: 409 expense_changed means read again and decide.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      description: description.optional(),
      category: expenseCategory.optional(),
      amountCents: amountCents.optional(),
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).optional(),
      splits: z.array(splitSchema).min(1).max(50).optional(),
      expectedUpdatedAt: isoDateTime.optional(),
      imageUrl,
    }),
    path: (input) => ['expenses', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'expense_delete',
    title: 'Delete an expense',
    description:
      'Deletes an expense for good; use it only for typos or duplicate entries. Allowed for the payer or a debtor of the expense (otherwise not_owner).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['expenses', input.id],
  }),
  defineTool({
    name: 'expense_split_settle',
    title: 'Mark a split as settled',
    description:
      'Sets settled (default true) on a single split: the person paid back in cash, the expense itself stays unchanged. Only the debtor or the payer (not_split_party).',
    method: 'POST',
    input: z.strictObject({
      id: uuid,
      splitId: uuid,
      settled: z.boolean().default(true),
    }),
    path: (input) => ['expenses', input.id, 'splits', input.splitId, 'settle'],
    body: (input) => ({ settled: input.settled }),
  }),
  defineTool({
    name: 'settlement_preview',
    title: 'Preview a settlement',
    description:
      'Computes netCents, settleableCents, remainingCents and the affected splits for the direction fromMemberId → toMemberId. The caller must be one of the two parties (not_party_to_debt). Pass the result unchanged as expected to settlement_commit.',
    method: 'GET',
    input: z.strictObject({ fromMemberId: uuid, toMemberId: uuid, currency }),
    path: () => ['expenses', 'settle-batch'],
    query: (input) => ({
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      currency: input.currency,
    }),
  }),
  defineTool({
    name: 'settlement_commit',
    title: 'Commit a settlement',
    description:
      'Marks several open splits as settled in one step. expected is the unchanged result of settlement_preview (the MCP server forwards only currency, netCents, settleableCents and splits[id, amountCents]); otherwise 409 settlement_changed, then preview again.',
    method: 'POST',
    input: z.strictObject({
      fromMemberId: uuid,
      toMemberId: uuid,
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']),
      expected: settlementPreview,
    }),
    path: () => ['expenses', 'settle-batch'],
    body: ({ expected, ...rest }) => ({
      ...rest,
      // The app rejects unknown keys: keep only what it checks.
      expected: {
        currency: rest.currency,
        netCents: expected.netCents,
        settleableCents: expected.settleableCents,
        splits: expected.splits.map(({ id, amountCents }) => ({ id, amountCents })),
      },
    }),
  }),
  defineTool({
    name: 'cash_payment_record',
    title: 'Record a cash payment',
    description:
      'Records a cash payment that already happened, over the whole current net debt fromMemberId → toMemberId; ManaWG moves no money. The caller must be one of the two parties (not_party_to_debt). expectedNetCents is netCents from settlement_preview; if the debt changed since, the answer is 409 settlement_changed, then preview again. Both must still be active in the flat (member_not_in_wg). Notifies the other party.',
    method: 'POST',
    input: z.strictObject({
      fromMemberId: uuid,
      toMemberId: uuid,
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).default('EUR'),
      expectedNetCents: z.number().int().min(1).max(2_147_483_647),
    }),
    path: () => ['payments', 'manual'],
    body: (input) => input,
  }),
  defineTool({
    name: 'cash_payment_void',
    title: 'Void a cash payment',
    description:
      'Voids a recorded cash payment (id from expenses_list payments); the debt is open again afterwards. Only one of the two parties (not_party_to_debt); payment_not_found or 409 payment_voided when it does not exist (any more). To correct one, void it and record it again. Notifies the other party.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['payments', 'manual', input.id],
  }),
  defineTool({
    name: 'balances_get',
    title: 'Read open balances',
    description:
      'What others owe the caller (creditor view): per debtor debtor_id, debtor_name, amount_cents, currency, oldest_age_days. Empty when nobody owes the caller anything; debts between other members are in dashboard_get.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['reminders', 'balances'],
  }),
  defineTool({
    name: 'reminders_list',
    title: 'Read the reminder history',
    description:
      'Reminders sent in the last 30 days (max 50 entries) with channel, message, amountCents, currency, oldestDebtAgeDays and sentAt.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['reminders'],
  }),
  defineTool({
    name: 'reminder_send',
    title: 'Send a payment reminder',
    description:
      'Sends the debtor a reminder (channel push or inapp). It notifies a person, so only on an explicit request. Only the creditor or an admin may send (not_creditor); without an open debt no_open_debt, a 48 h cooldown (reminder_cooldown), reminder_rate_limited when sent too often.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({
      debtorMemberId: uuid,
      creditorMemberId: uuid,
      channel: z.enum(['push', 'inapp']),
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).default('EUR'),
    }),
    path: () => ['reminders'],
    body: (input) => input,
  }),
];
