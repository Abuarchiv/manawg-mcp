import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const itemName = z.string().trim().min(1).max(120);
const quantity = z.string().trim().min(1).max(40).optional();

export const shoppingTools = [
  defineTool({
    name: 'shopping_list',
    title: 'Einkaufsliste lesen',
    description:
      'Alle offenen Artikel (älteste zuerst) gefolgt von bis zu 1000 zuletzt gekauften. Enthält addedBy/addedByName, boughtBy, boughtAt und updatedAt; beide Zeitstempel für shopping_set_bought verwenden.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['shopping'],
  }),
  defineTool({
    name: 'shopping_add',
    title: 'Einkaufsartikel hinzufügen',
    description:
      'Fügt der Liste hinzu: name 1..120, quantity max 40 (z. B. "2"), bought default false. 409 shopping_item_duplicate wenn derselbe name bereits offen ist.',
    method: 'POST',
    input: z.strictObject({
      name: itemName,
      quantity,
      bought: z.boolean().default(false),
    }),
    path: () => ['shopping'],
    body: (input) => input,
  }),
  defineTool({
    name: 'shopping_set_bought',
    title: 'Artikel als gekauft markieren',
    description:
      'Vorher shopping_list lesen und updatedAt sowie boughtAt (oder null) exakt mitsenden. 409 shopping_item_changed: neu lesen und erneut entscheiden. boughtBy wird automatisch zum Aufrufer gesetzt.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      bought: z.boolean(),
      expectedUpdatedAt: isoDateTime,
      expectedBoughtAt: isoDateTime.nullable(),
    }),
    path: (input) => ['shopping', input.id],
    body: (input) => ({
      bought: input.bought,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedBoughtAt: input.expectedBoughtAt,
    }),
  }),
  defineTool({
    name: 'shopping_remove',
    title: 'Einkaufsartikel entfernen',
    description:
      'Entfernt einen Artikel. Erlaubt für die eintragende Person oder einen Admin (sonst not_owner); unbekannte id: item_not_found.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['shopping', input.id],
  }),
  defineTool({
    name: 'shopping_clear_bought',
    title: 'Gekauftes leeren (Admin)',
    description:
      'Löscht ALLE bereits gekauften Artikel der WG in einem Schritt (nur Admin, not_admin) — unwiderruflich, Rückgängigmachen nicht möglich.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({}),
    path: () => ['shopping'],
  }),
];
