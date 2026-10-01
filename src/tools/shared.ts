import { z } from 'zod';

export const isoDateTime = z.iso.datetime({ offset: true });
export const uuid = z.uuid();
export const splitSchema = z
  .object({
    debtorMemberId: uuid,
    amountCents: z.number().int().min(0).max(100_000_000),
  })
  .strict();
export const amountCents = z.number().int().min(1).max(100_000_000);
export const currency = z.enum(['EUR', 'CHF', 'USD', 'GBP']).default('EUR');
export const description = z.string().trim().min(1).max(200);
export const imageUrl = z.string().trim().max(2048).optional();
