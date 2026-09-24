import { z } from 'zod';
import { defineTool, uuid } from './finance.js';

const units = z.enum(['Stück', 'L', 'kg', 'Rolle', 'Packung']);
const categories = z.enum(['bad', 'kueche', 'putzmittel', 'sonstiges']);
const itemName = z.string().trim().min(1).max(120);
const quantity = z.number().int().min(0).max(9999);
const threshold = z.number().int().min(0).max(9999);

export const inventoryTools = [
  defineTool({
    name: 'inventory_list',
    title: 'Vorräte lesen',
    description:
      'Alle Vorratsartikel mit quantity, unit, threshold, category, decrementCount30d. Niedrigbestand = quantity <= threshold.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['inventory'],
  }),
  defineTool({
    name: 'inventory_add',
    title: 'Vorratsartikel anlegen',
    description:
      'name 1..120; quantity 0..9999 (default 0), unit Stück|L|kg|Rolle|Packung, threshold 0..9999 (default 1), category bad|kueche|putzmittel|sonstiges (default sonstiges).',
    method: 'POST',
    input: z.strictObject({
      name: itemName,
      quantity: quantity.default(0),
      unit: units.default('Stück'),
      threshold: threshold.default(1),
      category: categories.default('sonstiges'),
    }),
    path: () => ['inventory'],
    body: (input) => input,
  }),
  defineTool({
    name: 'inventory_update',
    title: 'Vorratsartikel bearbeiten',
    description:
      'quantityDelta (-9999..9999) zählt um, quantity setzt absolut (dann expectedQuantity und expectedUpdatedAt Pflicht). Bei Versionssprung 409 version_conflict neu lesen. mindestens ein Feld nötig (empty_update).',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      name: itemName.optional(),
      quantityDelta: z.number().int().min(-9999).max(9999).optional(),
      quantity: quantity.optional(),
      expectedQuantity: quantity.optional(),
      expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
      threshold: threshold.optional(),
      unit: units.optional(),
      category: categories.optional(),
    }),
    path: (input) => ['inventory', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'inventory_consume',
    title: 'Bestand abbuchen',
    description:
      'delta strikt -100..0 (z. B. -1 für ein Stück entnommen). Antwort mit clamped (true wenn auf 0 begrenzt) und autoPushedShoppingItemId (Bestellvorschlag). 409 version_conflict bei gleichzeitiger Änderung.',
    method: 'POST',
    input: z.strictObject({ id: uuid, delta: z.number().int().min(-100).max(0) }),
    path: (input) => ['inventory', input.id, 'consume'],
    body: (input) => ({ delta: input.delta }),
  }),
  defineTool({
    name: 'inventory_remove',
    title: 'Vorratsartikel löschen',
    description: 'Entfernt den Artikel samt Verlauf dauerhaft.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['inventory', input.id],
  }),
];
