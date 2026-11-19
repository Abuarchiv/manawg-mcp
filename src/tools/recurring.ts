import { z } from 'zod';
import {
  amountCents,
  description,
  expenseCategory,
  intervalMonths,
  isoDateTime,
  splitList,
  uuid,
  withoutId,
} from './shared.js';
import { defineTool } from './types.js';

const templateId = uuid.describe(
  'Id of the fixed-cost template, as returned in recurringExpenses[].id by recurring_list or in recurringExpense.id by recurring_create.',
);
const templateCurrency =
  'Fixed-cost templates are always in EUR, which is the only accepted value (the app rejects others with recurring_currency_unsupported). Omit it.';
const templateSplits =
  'Who owes what per charge, one entry per member. Amounts must add up to amountCents. Member ids come from members_list.';
const expectedDueAt =
  'nextDueAt of the template as you last read it from recurring_get or recurring_list (ISO 8601 with offset). Used as a concurrency guard.';
// The fields the app counts as an edit; the expectedNextDueAt guard alone changes nothing.
const editFields = [
  'description',
  'category',
  'amountCents',
  'currency',
  'paidByMemberId',
  'intervalMonths',
  'nextDueAt',
  'splits',
  'paused',
] as const;

export const recurringTools = [
  defineTool({
    name: 'recurring_list',
    title: 'Read fixed costs',
    description:
      'List all fixed-cost templates (recurring expenses such as rent or internet) of the flat, ordered by nextDueAt, at most 500. Use it to find a template id or to see what is due next; use recurring_get for a single template and expenses_list for charges that were already booked. Read-only. Each entry has description, category, amountCents, paidByMemberId, intervalMonths, nextDueAt, pausedAt (null when active) and splits; currency is always EUR.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['recurring-expenses'],
  }),
  defineTool({
    name: 'recurring_get',
    title: 'Read one fixed cost',
    description:
      'Read one fixed-cost template with its splits, by id. Use it to get the current nextDueAt before recurring_update or recurring_advance; use recurring_list when you do not know the id yet. Read-only. Answers 404 recurring_expense_not_found for an unknown id or an id of another flat.',
    method: 'GET',
    input: z.strictObject({ id: templateId }),
    path: (input) => ['recurring-expenses', input.id],
  }),
  defineTool({
    name: 'recurring_create',
    title: 'Create a fixed cost',
    description:
      'Create a new fixed-cost template (for example monthly rent) that the app books automatically as an expense every intervalMonths, starting at nextDueAt. Use it for charges that repeat; for a one-off payment use expense_create. It does not book a charge itself. Any member may create one. If paidByMemberId is not you, you must carry a positive share in splits, otherwise 403 paid_by_must_include_caller; members who left fail with 400 member_not_in_wg. Returns the new template as recurringExpense. The call carries an idempotency key, so a retried request is not created twice.',
    method: 'POST',
    input: z.strictObject({
      description: description.describe(
        'Short label shown in the expense list for every booked charge, for example "Rent".',
      ),
      category: expenseCategory
        .default('other')
        .describe('Category given to each booked expense. Defaults to other.'),
      amountCents: amountCents.describe(
        'Amount of each charge in cents of EUR, for example 85000 for 850.00 EUR.',
      ),
      paidByMemberId: uuid.describe(
        'Member who pays the charge and is owed the money back, from members_list. Usually the tenant who pays the landlord.',
      ),
      nextDueAt: isoDateTime.describe(
        'When the first charge is due, ISO 8601 with offset. May lie up to 366 days in the past (then the app books the missed cycles) and up to 10 years ahead; later dates keep this day of the month.',
      ),
      splits: splitList.describe(templateSplits),
      currency: z.literal('EUR').default('EUR').describe(templateCurrency),
      intervalMonths: intervalMonths
        .default(1)
        .describe('Months between two charges: 1 monthly, 3 quarterly, 12 yearly. Defaults to 1.'),
    }),
    path: () => ['recurring-expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'recurring_update',
    title: 'Edit or pause a fixed cost',
    description:
      'Change a fixed-cost template or pause and resume it (paused). Send only the fields to change; at least one is required (400 invalid_body otherwise). Use it for edits and pausing; to skip one cycle use recurring_advance, to remove the template for good use recurring_delete. Only the creator of the template or a flat admin may call it, others get 403 not_owner. Resuming does not book the missed cycles: the due date jumps to the next cycle day from today. Changing amountCents, paidByMemberId or splits is checked like recurring_create (403 paid_by_must_include_caller, 400 splits_sum_mismatch). Pass expectedNextDueAt to guard against concurrent edits or bookings: if the template moved meanwhile, the call fails with 409 recurring_expense_changed and nothing is written; read it again with recurring_get and decide. Returns the updated template as recurringExpense.',
    method: 'PATCH',
    input: z
      .strictObject({
        id: templateId,
        description: description.optional().describe('New label for the template.'),
        category: expenseCategory.optional().describe('New category for booked expenses.'),
        amountCents: amountCents
          .optional()
          .describe(
            'New amount per charge in cents of EUR. If you change it, also send splits that add up to it unless the current splits already do.',
          ),
        currency: z.literal('EUR').optional().describe(templateCurrency),
        paidByMemberId: uuid.optional().describe('New paying member, from members_list.'),
        intervalMonths: intervalMonths
          .optional()
          .describe('New number of months between charges, for example 1 monthly or 12 yearly.'),
        nextDueAt: isoDateTime
          .optional()
          .describe(
            'Move the next due date, ISO 8601 with offset. Must lie within 366 days in the past and 10 years ahead. Sending the unchanged value is harmless.',
          ),
        splits: splitList.optional().describe(`${templateSplits} Replaces the whole list.`),
        paused: z
          .boolean()
          .optional()
          .describe(
            'true pauses the template (no automatic bookings), false resumes it. Omit to leave the pause state as it is.',
          ),
        expectedNextDueAt: isoDateTime.optional().describe(expectedDueAt),
      })
      .refine((input) => editFields.some((field) => input[field] !== undefined), {
        message: 'Send at least one field to change',
        path: ['description'],
      }),
    path: (input) => ['recurring-expenses', input.id],
    body: withoutId,
  }),
  defineTool({
    name: 'recurring_advance',
    title: 'Advance a fixed cost now',
    description:
      'Skip ahead one cycle: moves ONLY nextDueAt on by intervalMonths, without creating an expense. It only works once an expense was booked for the current due date, otherwise 409 recurring_expense_not_booked, and a paused template answers 400 recurring_paused. Any member may call it. To book the due payment use expense_create with recurringExpenseId and expectedRecurringNextDueAt instead: it creates the expense and advances the template in one step. To change the schedule itself use recurring_update. expectedNextDueAt is required and prevents double advancing: if the cycle was already advanced, 409 recurring_expense_already_advanced and nothing changes. Returns the updated template as recurringExpense.',
    method: 'PATCH',
    input: z.strictObject({
      id: templateId,
      expectedNextDueAt: isoDateTime.describe(expectedDueAt),
    }),
    path: () => ['recurring-expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'recurring_delete',
    title: 'Delete a fixed cost',
    description:
      'Permanently delete a fixed-cost template, so the app stops booking it automatically. Expenses that were already booked from it stay. It cannot be undone; to stop bookings only for a while use recurring_update with paused true. Only the creator of the template or a flat admin may call it, others get 403 not_owner; an unknown id answers 404 recurring_expense_not_found. Returns { deleted: true }.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: templateId }),
    path: () => ['recurring-expenses'],
    body: (input) => ({ id: input.id }),
  }),
];
