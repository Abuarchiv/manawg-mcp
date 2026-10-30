import { z } from 'zod';
import {
  amountCents,
  description,
  expenseCategory,
  isoDateTime,
  splitSchema,
  uuid,
} from './shared.js';
import { defineTool } from './types.js';

export const recurringTools = [
  defineTool({
    name: 'recurring_list',
    title: 'Read fixed costs',
    description:
      'All recurring expenses (max 500) with category, intervalMonths, nextDueAt, pausedAt and splits. currency is always EUR.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['recurring-expenses'],
  }),
  defineTool({
    name: 'recurring_get',
    title: 'Read one fixed cost',
    description:
      'One fixed-cost template with its splits; 404 recurring_expense_not_found for an unknown id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['recurring-expenses', input.id],
  }),
  defineTool({
    name: 'recurring_create',
    title: 'Create a fixed cost',
    description:
      'Recurring expense: description max 200, category (default other), amountCents 1..100000000 (EUR only, otherwise recurring_currency_unsupported), intervalMonths 1..24, nextDueAt ISO (at most 366 days in the past), splits 1..50 whose sum equals amountCents.',
    method: 'POST',
    input: z.strictObject({
      description,
      category: expenseCategory.default('other'),
      amountCents,
      paidByMemberId: uuid,
      nextDueAt: isoDateTime,
      splits: z.array(splitSchema).min(1).max(50),
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).default('EUR'),
      intervalMonths: z.number().int().min(1).max(24).default(1),
    }),
    path: () => ['recurring-expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'recurring_update',
    title: 'Edit or pause a fixed cost',
    description:
      'Only the creator or an admin (not_owner). paused pauses or resumes; every other field changes the template. expectedNextDueAt (nextDueAt from recurring_get) guards against concurrent edits: 409 recurring_expense_changed means read again and decide.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      description: description.optional(),
      category: expenseCategory.optional(),
      amountCents: amountCents.optional(),
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).optional(),
      paidByMemberId: uuid.optional(),
      intervalMonths: z.number().int().min(1).max(24).optional(),
      nextDueAt: isoDateTime.optional(),
      splits: z.array(splitSchema).min(1).max(50).optional(),
      paused: z.boolean().optional(),
      expectedNextDueAt: isoDateTime.optional(),
    }),
    path: (input) => ['recurring-expenses', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'recurring_advance',
    title: 'Advance a fixed cost now',
    description:
      'Moves ONLY nextDueAt on by intervalMonths, without creating an expense (any member may do this). expectedNextDueAt (nextDueAt from recurring_get) is required and guards against double booking: 409 recurring_expense_already_advanced when the cycle was already advanced; a paused template answers recurring_paused. To book the due payment, use expense_create with recurringExpenseId + expectedRecurringNextDueAt instead: it creates the expense and advances the template atomically.',
    method: 'PATCH',
    input: z.strictObject({ id: uuid, expectedNextDueAt: isoDateTime }),
    path: () => ['recurring-expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'recurring_delete',
    title: 'Delete a fixed cost',
    description:
      'Removes the template for good (no further automatic bookings). Only the creator or an admin; id goes in the body.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: () => ['recurring-expenses'],
    body: (input) => ({ id: input.id }),
  }),
];
