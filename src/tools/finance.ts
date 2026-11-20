import { z } from 'zod';
import { isRecord } from '../payload.js';
import {
  amountCents,
  currency,
  description,
  expenseCategory,
  imageUrl,
  isoDateTime,
  splitList,
  uuid,
  withoutId,
} from './shared.js';
import { defineTool } from './types.js';

// Loose because the app returns more keys (remainingCents, expenseId, reason) than it checks;
// settlement_commit sends back only the checked ones.
const settlementPreview = z
  .looseObject({
    netCents: z
      .number()
      .int()
      .min(0)
      .describe('netCents from the preview: the net debt in cents between the two members.'),
    settleableCents: z
      .number()
      .int()
      .min(0)
      .describe(
        'settleableCents from the preview: the part of the net debt the listed splits settle.',
      ),
    splits: z
      .array(
        z.looseObject({
          id: uuid.describe('Split id, from the preview splits list.'),
          amountCents: z
            .number()
            .int()
            .min(0)
            .describe('Amount of this split in cents, as listed in the preview.'),
          offset: z
            .boolean()
            .optional()
            .describe(
              'Copy offset from the preview when present: the split cancels a counter-debt.',
            ),
        }),
      )
      .max(500)
      .describe('The preview splits list, copied unchanged.'),
  })
  .describe(
    'The settlement_preview result for the same members and currency, passed back unchanged. It proves what the caller reviewed; extra keys such as remainingCents are ignored.',
  );

export const financeTools = [
  defineTool({
    name: 'expenses_list',
    title: 'Read expenses and payments',
    description:
      "Lists the flat's expenses, newest first by occurredAt, each with its splits (debtorMemberId, amountCents, settledAt) and the recorded cash payments, one page at a time. Use it to find an expense, split or payment id, to check updatedAt before expense_update, or to review history. For what others owe the caller use balances_get, for the amount to settle between two members use settlement_preview. Read only. The answer carries expenses, payments, total (all expenses) and hasMore; payments are returned in full on every page.",
    method: 'GET',
    input: z.strictObject({
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Page size: how many expenses to return.'),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe(
          'Number of newest expenses to skip. Use limit plus the previous offset while hasMore is true.',
        ),
    }),
    path: () => ['expenses'],
    transform: ({ limit, offset }, payload) => {
      if (!isRecord(payload) || !Array.isArray(payload.expenses)) {
        return payload;
      }
      const all = payload.expenses;
      const page = all.slice(offset, offset + limit);
      return {
        ...payload,
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
      'Creates one expense in the flat, paid by the caller or by paidByMemberId and divided into debtor splits whose sum must equal amountCents (otherwise splits_sum_mismatch). Use it for a new purchase or for booking a due fixed cost; to change an existing expense use expense_update, to repay a debt use cash_payment_record or settlement_commit. If someone else paid, the caller must carry a positive share (otherwise paid_by_must_include_caller). To book a due fixed cost send recurringExpenseId and expectedRecurringNextDueAt together (nextDueAt from recurring_get): the expense is created and the template advanced in one step. Side effects: posts a chat notice and notifies the other members by push, not the caller. The answer holds the created expense and a warning that is null when notifications went out normally.',
    method: 'POST',
    input: z
      .strictObject({
        amountCents: amountCents.describe(
          'Total price of the expense in cents, e.g. 1250 for 12.50.',
        ),
        description: description.describe(
          'Short title shown in the expense list, e.g. "Groceries".',
        ),
        category: expenseCategory
          .default('other')
          .describe('Spending category; use other when none fits.'),
        splits: splitList.describe(
          'Who owes what. One entry per debtor, no duplicate members, amounts summing to amountCents.',
        ),
        paidByMemberId: uuid
          .optional()
          .describe('Member who paid, from members_list. Omit when the caller paid.'),
        currency: currency.describe('Currency of the expense and its splits.'),
        occurredAt: isoDateTime
          .optional()
          .describe('When the purchase happened, ISO 8601 with offset. Omit for now.'),
        imageUrl: imageUrl.describe(
          'URL of a receipt image already uploaded to this flat in the ManaWG app. Omit unless you have one.',
        ),
        recurringExpenseId: uuid
          .optional()
          .describe(
            'Id of the fixed cost (recurring_list) this expense books. Send with expectedRecurringNextDueAt.',
          ),
        expectedRecurringNextDueAt: isoDateTime
          .optional()
          .describe(
            'nextDueAt of that fixed cost as read from recurring_get; the booking fails if it has moved.',
          ),
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
      'Edits an existing expense: description, category, total amount, splits or receipt image. Only the payer may edit (otherwise not_payer). To remove an expense, use expense_delete. Send only the fields to change. A new amountCents needs the complete replacement splits in the same call (splits_required_with_amount), and the currency cannot be changed. Splits that stay the same keep their settled state. Pass expectedUpdatedAt (updatedAt from expenses_list) to refuse a stale edit: 409 expense_changed means read again and decide. Side effects: members whose share changed get a push, and the chat notice is refreshed when description or amount changes. The answer holds the updated expense.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid.describe('Id of the expense to edit, from expenses_list.'),
      description: description.optional().describe('New title. Omit to keep the current one.'),
      category: expenseCategory.optional().describe('New category. Omit to keep the current one.'),
      amountCents: amountCents
        .optional()
        .describe(
          'New total in cents. Omit to keep the current total; when set, splits must be sent too.',
        ),
      splits: splitList
        .optional()
        .describe(
          'Complete replacement list of debtor shares, summing to the (new) total. Omit to keep the current splits.',
        ),
      expectedUpdatedAt: isoDateTime
        .optional()
        .describe(
          'updatedAt of the expense as last read from expenses_list; guards against editing a stale version.',
        ),
      imageUrl: imageUrl.describe(
        'URL of a receipt image already uploaded to this flat in the ManaWG app. Omit to keep the current image.',
      ),
    }),
    path: (input) => ['expenses', input.id],
    body: withoutId,
  }),
  defineTool({
    name: 'expense_delete',
    title: 'Delete an expense',
    description:
      "Permanently deletes one expense with its splits and removes its chat notice; this cannot be undone. Use it only for typos, duplicates or invented entries; to correct values use expense_update, to take back a cash payment use cash_payment_void. Allowed for the payer or any debtor of the expense (otherwise not_owner). Refused with 409 expense_has_settled_shares when another debtor's share was already settled. Members whose balance changes are notified by push.",
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the expense to delete, from expenses_list.'),
    }),
    path: (input) => ['expenses', input.id],
  }),
  defineTool({
    name: 'expense_split_settle',
    title: 'Mark a split as settled',
    description:
      'Marks one debtor share of an expense as settled (the person paid it back in cash), or reopens it with settled false; the expense itself stays unchanged. Use it for a single share; to settle several shares between two members use settlement_preview then settlement_commit, to settle the whole net debt use cash_payment_record. Only the debtor or the payer of that expense may call it (otherwise not_split_party). Settling is refused with 409 split_already_offset when the share is larger than what the debtor still owes net, and split_not_found when the split id does not belong to the expense. Settling notifies the other party; reopening does not. The answer holds the split.',
    method: 'POST',
    input: z.strictObject({
      id: uuid.describe('Id of the expense the split belongs to, from expenses_list.'),
      splitId: uuid.describe(
        'Id of the split to change, from the splits of that expense in expenses_list.',
      ),
      settled: z
        .boolean()
        .default(true)
        .describe(
          'true marks the share as paid back; false reopens a share that was settled by mistake.',
        ),
    }),
    path: (input) => ['expenses', input.id, 'splits', input.splitId, 'settle'],
    body: (input) => ({ settled: input.settled }),
  }),
  defineTool({
    name: 'settlement_preview',
    title: 'Preview a settlement',
    description:
      'Computes, without changing anything, what settling the debt from fromMemberId to toMemberId would cover: netCents (net debt), settleableCents, remainingCents and the affected splits. Call it before settlement_commit (pass the result as expected) or cash_payment_record (use netCents as expectedNetCents). For a quick overview of what others owe the caller use balances_get instead. The caller must be one of the two members (otherwise not_party_to_debt); both must be active in the flat (member_not_in_wg).',
    method: 'GET',
    input: z.strictObject({
      fromMemberId: uuid.describe('Member who owes the money and pays, from members_list.'),
      toMemberId: uuid.describe('Member who is owed the money and receives it, from members_list.'),
      currency: currency.describe('Currency of the debt to preview.'),
    }),
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
      'Marks the open splits listed by a settlement_preview as settled in one step, for the debt from fromMemberId to toMemberId. Run settlement_preview first and pass its result unchanged as expected; if the debts changed in between, the call fails with 409 settlement_changed, then preview again. Use it to settle several shares at once; for one share use expense_split_settle, to record a cash payment over the whole net debt use cash_payment_record. The caller must be one of the two members (otherwise not_party_to_debt). Moves no money. Notifies the other member and writes an audit entry.',
    method: 'POST',
    input: z.strictObject({
      fromMemberId: uuid.describe(
        'Member who owes the money and pays; same value as in the preview.',
      ),
      toMemberId: uuid.describe('Member who is owed the money; same value as in the preview.'),
      currency: currency
        .unwrap()
        .describe(
          'Currency of the debt to settle. Debts in different currencies are settled separately.',
        ),
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
        splits: expected.splits.map(({ id, amountCents, offset }) => ({
          id,
          amountCents,
          ...(offset ? { offset: true } : {}),
        })),
      },
    }),
  }),
  defineTool({
    name: 'cash_payment_record',
    title: 'Record a cash payment',
    description:
      'Records a cash payment that already happened over the whole current net debt from fromMemberId to toMemberId; ManaWG moves no money. Use it once the debt was handed over; to mark only selected shares use settlement_commit or expense_split_settle, to take a wrong entry back use cash_payment_void. The caller must be one of the two members (otherwise not_party_to_debt), both active in the flat (member_not_in_wg). expectedNetCents guards against a changed debt: 409 settlement_changed means run settlement_preview again. Notifies the other member and writes an audit entry.',
    method: 'POST',
    input: z.strictObject({
      fromMemberId: uuid.describe(
        'Member who paid the cash and owed the money, from members_list.',
      ),
      toMemberId: uuid.describe('Member who received the cash, from members_list.'),
      currency: currency.describe('Currency of the debt that was paid.'),
      expectedNetCents: z
        .number()
        .int()
        .min(1)
        .max(2_147_483_647)
        .describe(
          'netCents from settlement_preview for the same members and currency: the net debt in cents you expect to settle.',
        ),
    }),
    path: () => ['payments', 'manual'],
    body: (input) => input,
  }),
  defineTool({
    name: 'cash_payment_void',
    title: 'Void a cash payment',
    description:
      'Voids a recorded cash payment so the debt is open again afterwards. Use it when a payment was entered by mistake; to correct one, void it and record it again with cash_payment_record. To remove an expense use expense_delete instead. Only one of the two members of the payment may void it (otherwise not_party_to_debt); payment_not_found when it does not exist, 409 payment_voided when it was already voided. Notifies the other member and writes an audit entry.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the payment to void, from the payments list of expenses_list.'),
    }),
    path: (input) => ['payments', 'manual', input.id],
  }),
  defineTool({
    name: 'balances_get',
    title: 'Read open balances',
    description:
      'Lists what other members currently owe the caller (creditor view), one entry per debtor and currency with debtor_id, debtor_name, amount_cents (cents), currency and oldest_age_days. Read only. Use it to find who to remind with reminder_send; the result is empty when nobody owes the caller. It does not show what the caller owes or debts between other members (use dashboard_get), and gives no settlement detail (use settlement_preview).',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['reminders', 'balances'],
  }),
  defineTool({
    name: 'reminders_list',
    title: 'Read the reminder history',
    description:
      'Lists the payment reminders sent in the flat in the last 30 days, newest first, at most 50, each with channel, message, amountCents, currency, oldestDebtAgeDays and sentAt. Read only. Use it to check whether a reminder went out recently before calling reminder_send (which has a 48 h cooldown per debtor); for who owes the caller money use balances_get.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['reminders'],
  }),
  defineTool({
    name: 'reminder_send',
    title: 'Send a payment reminder',
    description:
      'Sends one flatmate a payment reminder for an open debt to the creditor and stores it in the reminder history. It contacts a person, so only on an explicit request; check balances_get for the debt and reminders_list for earlier reminders first. Only the creditor or an admin may send (otherwise not_creditor). Fails with no_open_debt when the debtor owes nothing in that currency, debtor_opted_out when the debtor turned reminders off, reminder_cooldown within 48 h of the previous reminder for the same pair, and reminder_rate_limited when the caller sends too many. The message text is generated by ManaWG. A push that could not be delivered falls back to an email to the debtor; inapp does not.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({
      debtorMemberId: uuid.describe(
        'Member who owes the money and receives the reminder, from the debtor_id of balances_get.',
      ),
      creditorMemberId: uuid.describe(
        'Member who is owed the money, usually the caller; admins may send for others.',
      ),
      channel: z
        .enum(['push', 'inapp'])
        .describe(
          'How to deliver: push sends a push notification (email fallback if undeliverable), inapp shows it only inside the app.',
        ),
      currency: currency.describe(
        'Currency of the debt to remind about, matching the currency in balances_get.',
      ),
    }),
    path: () => ['reminders'],
    body: (input) => input,
  }),
];
