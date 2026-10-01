import { z } from 'zod';
import { amountCents, description, isoDateTime, splitSchema, uuid } from './shared.js';
import { defineTool } from './types.js';

export const recurringTools = [
  defineTool({
    name: 'recurring_list',
    title: 'Fixkosten lesen',
    description:
      'Alle wiederkehrenden Ausgaben (max 500) mit intervalMonths, nextDueAt, pausedAt, splits. serialize liefert currency fix EUR.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['recurring-expenses'],
  }),
  defineTool({
    name: 'recurring_get',
    title: 'Fixkosten einzeln lesen',
    description:
      'Einzelne Fixkosten-Template inklusive splits; 404 recurring_expense_not_found bei unbekannter id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['recurring-expenses', input.id],
  }),
  defineTool({
    name: 'recurring_create',
    title: 'Fixkosten anlegen',
    description:
      'Wiederkehrende Ausgabe: description max 200, amountCents 1..100000000 (nur EUR, sonst recurring_currency_unsupported), intervalMonths 1..24, nextDueAt ISO (max 366 Tage in der Vergangenheit), splits 1..50 mit Summe == amountCents.',
    method: 'POST',
    input: z.strictObject({
      description,
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
    title: 'Fixkosten bearbeiten oder pausieren',
    description:
      'Nur Ersteller oder Admin (not_owner). paused pausiert/aktiviert; alle anderen Felder ändern das Template. 409 recurring_expense_already_advanced wenn bereits manuell fortgeschrieben.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      description: description.optional(),
      amountCents: amountCents.optional(),
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).optional(),
      paidByMemberId: uuid.optional(),
      intervalMonths: z.number().int().min(1).max(24).optional(),
      nextDueAt: isoDateTime.optional(),
      splits: z.array(splitSchema).min(1).max(50).optional(),
      paused: z.boolean().optional(),
    }),
    path: (input) => ['recurring-expenses', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'recurring_advance',
    title: 'Fixkosten jetzt fortschreiben',
    description:
      'Erzeugt sofort eine Ausgabe aus dem Template und rückt nextDueAt um intervalMonths weiter; alle Felder sind optionale Überschreibungen. Nur Ersteller oder Admin (not_owner). expectedNextDueAt dient als Optimistic-Lock: 409 recurring_expense_already_advanced, wenn dieser Zyklus bereits fortgeschrieben wurde.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      expectedNextDueAt: isoDateTime.optional(),
      description: description.optional(),
      amountCents: amountCents.optional(),
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']).optional(),
      paidByMemberId: uuid.optional(),
      intervalMonths: z.number().int().min(1).max(24).optional(),
      nextDueAt: isoDateTime.optional(),
      splits: z.array(splitSchema).min(1).max(50).optional(),
    }),
    path: () => ['recurring-expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'recurring_delete',
    title: 'Fixkosten löschen',
    description:
      'Entfernt das Template dauerhaft (kein weiterer Automausgleich). Nur Ersteller oder Admin; id als body.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: () => ['recurring-expenses'],
    body: (input) => ({ id: input.id }),
  }),
];
