import { z } from 'zod';
import {
  amountCents,
  currency,
  description,
  imageUrl,
  isoDateTime,
  splitSchema,
  uuid,
} from './shared.js';
import { defineTool } from './types.js';

export const financeTools = [
  defineTool({
    name: 'expenses_list',
    title: 'Ausgaben und Zahlungen lesen',
    description:
      'Ausgaben nach occurredAt absteigend mit splits (debtorMemberId, amountCents, settledAt) sowie abgeschlossene payments. limit 1..500 (default 100) und offset blättern; Antwort enthält total und hasMore. Grundlage für offene Salden und settlement_preview.',
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
    title: 'Ausgabe anlegen',
    description:
      'Neue Ausgabe mit Schuldnersplits. amountCents 1..100000000, description max 200, splits 1..50 Einträge, Summe der splits muss exakt amountCents ergeben (error: splits_sum_mismatch). Der Anrufende muss payer oder debtor sein (paid_by_must_include_caller).',
    method: 'POST',
    input: z.strictObject({
      amountCents,
      description,
      splits: z.array(splitSchema).min(1).max(50),
      paidByMemberId: uuid.optional(),
      currency,
      occurredAt: isoDateTime.optional(),
      imageUrl,
    }),
    path: () => ['expenses'],
    body: (input) => input,
  }),
  defineTool({
    name: 'expense_update',
    title: 'Ausgabe bearbeiten',
    description:
      'Nur der payer darf bearbeiten (not_payer). amountCents erfordert dann ebenfalls vollständige splits (splits_required_with_amount). expectedUpdatedAt (ISO) schützt vor Doppeländerungen: 409 expense_changed bedeutet erneut lesen und entscheiden.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      description: description.optional(),
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
    title: 'Ausgabe löschen',
    description:
      'Löscht eine Ausgabe endgültig — nur bei Tippfehlern oder doppelter Erfassung nutzen. Erlaubt für payer oder beteiligte debtor (sonst not_owner).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['expenses', input.id],
  }),
  defineTool({
    name: 'expense_split_settle',
    title: 'Schuldsplit als beglichen markieren',
    description:
      'Setzt settled (default true) auf einem einzelnen split: person bezahlt bar zurück, ohne dass sich die Ausgabe ändert. Nur debtor oder payer (not_split_party); 409 paypal_payment_pending wenn eine PayPal-Zahlung läuft.',
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
    title: 'Ausgleich vorberechnen',
    description:
      'Berechnet netCents, settleableCents, remainingCents und betroffene splits für die Richtung fromMemberId → toMemberId. Der Aufrufende muss eine der beiden Parteien sein (not_party_to_debt). Ergebnis unverändert als expected an settlement_commit übergeben.',
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
    title: 'Ausgleich ausführen',
    description:
      'Setzt mehrere offene splits in einem Schritt als beglichen. expected muss exakt das payload von settlement_preview sein (Felder netCents, settleableCents, splits); sonst 409 settlement_changed — dann neu previewen.',
    method: 'POST',
    input: z.strictObject({
      fromMemberId: uuid,
      toMemberId: uuid,
      currency: z.enum(['EUR', 'CHF', 'USD', 'GBP']),
      expected: z.record(z.string(), z.unknown()),
    }),
    path: () => ['expenses', 'settle-batch'],
    body: (input) => input,
  }),
  defineTool({
    name: 'balances_get',
    title: 'Offene Salden lesen',
    description:
      'Offene Salden je Schuldner: debtor_id, debtor_name, amount_cents, currency, oldest_age_days. Leer, wenn nichts offen ist.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['reminders', 'balances'],
  }),
  defineTool({
    name: 'reminders_list',
    title: 'Erinnerungshistorie lesen',
    description:
      'Versandte Mahnungen der letzten 30 Tage (max 50 Einträge) inklusive Status und Zeitpunkt.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['reminders'],
  }),
  defineTool({
    name: 'reminder_send',
    title: 'Mahnung senden',
    description:
      'Sendet dem Schuldner eine Erinnerung (channel push oder inapp) — benachrichtigt einen Menschen, deshalb nur auf ausdrücklichen Wunsch. Cooldown beachten; 429 wenn zu häufig.',
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
