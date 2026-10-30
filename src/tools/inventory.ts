import { z } from 'zod';
import { uuid } from './shared.js';
import { defineTool } from './types.js';

const units = z.enum(['piece', 'litre', 'kilogram', 'roll', 'pack']);
const categories = z.enum(['bathroom', 'kitchen', 'cleaning', 'other']);
const itemName = z.string().trim().min(1).max(120);
const quantity = z.number().int().min(0).max(9999);
const threshold = z.number().int().min(0).max(9999);

export const inventoryTools = [
  defineTool({
    name: 'inventory_list',
    title: 'Read supplies',
    description:
      'All supply items with quantity, unit, threshold, category and decrementCount30d. Low stock means quantity <= threshold.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['inventory'],
  }),
  defineTool({
    name: 'inventory_add',
    title: 'Add a supply item',
    description:
      'name 1..120; quantity 0..9999 (default 0), unit piece|litre|kilogram|roll|pack, threshold 0..9999 (default 1), category bathroom|kitchen|cleaning|other (default other).',
    method: 'POST',
    input: z.strictObject({
      name: itemName,
      quantity: quantity.default(0),
      unit: units.default('piece'),
      threshold: threshold.default(1),
      category: categories.default('other'),
    }),
    path: () => ['inventory'],
    body: (input) => input,
  }),
  defineTool({
    name: 'inventory_update',
    title: 'Edit a supply item',
    description:
      'quantityDelta (-9999..9999) counts up or down, quantity sets an absolute value (then expectedQuantity and expectedUpdatedAt are required). On 409 version_conflict read again. At least one field is needed (empty_update).',
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
    title: 'Use up stock',
    description:
      'delta -100..-1 (for example -1 when one piece was taken). The answer has clamped (true when limited to 0) and autoPushedShoppingItemId (item added to the shopping list). 409 version_conflict on a concurrent change.',
    method: 'POST',
    input: z.strictObject({ id: uuid, delta: z.number().int().min(-100).max(-1) }),
    path: (input) => ['inventory', input.id, 'consume'],
    body: (input) => ({ delta: input.delta }),
  }),
  defineTool({
    name: 'inventory_remove',
    title: 'Delete a supply item',
    description: 'Removes the item and its history for good.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['inventory', input.id],
  }),
];
