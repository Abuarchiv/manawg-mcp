import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const itemName = z.string().trim().min(1).max(120);
const quantity = z.string().trim().min(1).max(40).optional();

export const shoppingTools = [
  defineTool({
    name: 'shopping_list',
    title: 'Read the shopping list',
    description:
      'All open items (oldest first) followed by up to 1000 recently bought ones. Contains addedBy/addedByName, boughtBy, boughtAt and updatedAt; use both timestamps for shopping_set_bought.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['shopping'],
  }),
  defineTool({
    name: 'shopping_add',
    title: 'Add a shopping item',
    description:
      'Adds to the list: name 1..120, quantity max 40 (for example "2"), bought default false. 409 shopping_item_duplicate when the same name is already open.',
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
    title: 'Mark an item as bought',
    description:
      'Read shopping_list first and send updatedAt and boughtAt (or null) exactly. 409 shopping_item_changed: read again and decide again. boughtBy is set to the caller automatically.',
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
    title: 'Remove a shopping item',
    description:
      'Removes an item. Allowed for the person who added it or an admin (otherwise not_owner); unknown id: item_not_found.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['shopping', input.id],
  }),
  defineTool({
    name: 'shopping_clear_bought',
    title: 'Clear bought items (admin)',
    description:
      'Deletes ALL bought items of the flat in one step (admins only, not_admin). This cannot be undone.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({}),
    path: () => ['shopping'],
  }),
];
