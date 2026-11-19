import { z } from 'zod';

export const isoDateTime = z.iso.datetime({ offset: true });
export const uuid = z.uuid();
export const splitSchema = z.strictObject({
  debtorMemberId: uuid.describe(
    'Member who owes this share, from members_list. The payer may appear here to cover their own share.',
  ),
  amountCents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .describe('Share of this member in cents. All shares together must equal the total.'),
});
/** The bound is the app's maximum number of splits per expense. */
export const splitList = z.array(splitSchema).min(1).max(50);
/** The bound is the app's maximum interval for a fixed cost. */
export const intervalMonths = z.number().int().min(1).max(24);
export const amountCents = z.number().int().min(1).max(100_000_000);
export const currency = z.enum(['EUR', 'CHF', 'USD', 'GBP']).default('EUR');
export const description = z.string().trim().min(1).max(200);
export const expenseCategory = z.enum([
  'groceries',
  'household',
  'housing',
  'leisure',
  'transport',
  'other',
]);
export const imageUrl = z.string().trim().max(2048).optional();

/** Request body of a tool whose `id` is a path segment: the rest of the input. */
export const withoutId = <T extends { id: string }>({ id: _id, ...rest }: T): Omit<T, 'id'> => rest;
