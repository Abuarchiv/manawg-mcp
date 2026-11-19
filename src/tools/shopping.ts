import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const itemName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe(
    'Item name as shown on the list, for example "Oat milk". Compared to open items to detect duplicates.',
  );
const quantity = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .optional()
  .describe(
    'Free-text amount shown next to the name, for example "2" or "1 kg". Omit when no amount is needed.',
  );

export const shoppingTools = [
  defineTool({
    name: 'shopping_list',
    title: 'Read the shopping list',
    description:
      "Read the flat's shopping list: every open item (oldest first), followed by the most recently bought items (newest first, capped at about 1000). Each item has id, name, quantity, addedBy/addedByName, boughtBy, boughtAt (null while open) and updatedAt. Call it first to get the id (for shopping_set_bought and shopping_remove) and the updatedAt and boughtAt that shopping_set_bought requires, or to check for an open duplicate before shopping_add. For supplies stock instead of things to buy, use inventory_list.",
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['shopping'],
  }),
  defineTool({
    name: 'shopping_add',
    title: 'Add a shopping item',
    description:
      "Add one item to the flat's shared shopping list, optionally with a quantity. Use it when something needs to be bought; to tick off an existing item use shopping_set_bought, and to track household stock use inventory_add. Every other member gets a notification (a system notice and a push; the caller is excluded). Fails with 409 shopping_item_duplicate when an open item with the same name already exists, so read shopping_list first instead of retrying. Rate limited per member (too_many_requests with retry_after_s). Returns the created item.",
    method: 'POST',
    input: z.strictObject({
      name: itemName,
      quantity,
      bought: z
        .boolean()
        .default(false)
        .describe(
          'Set true to record an item that was already bought, so it lands directly in the bought history. Leave false for something still to buy.',
        ),
    }),
    path: () => ['shopping'],
    body: (input) => input,
  }),
  defineTool({
    name: 'shopping_set_bought',
    title: 'Mark an item as bought',
    description:
      "Mark one open item as bought, or put a bought item back on the open list (bought=false). Any member may do it. It only changes the bought state: to rename the item or change its quantity use shopping_update, and to delete it use shopping_remove. Uses optimistic locking: call shopping_list first and pass the item's updatedAt and boughtAt unchanged. If someone changed the item in between, the call fails with 409 shopping_item_changed and nothing is written: read the list again and decide again. If the item is already in the requested state the call succeeds without changes. Marking as bought records the caller as boughtBy and sets boughtAt to now; reopening clears both. Reopening can fail with 409 shopping_item_duplicate when another open item has the same name. Returns the updated item; item_not_found for an unknown id.",
    method: 'PATCH',
    input: z.strictObject({
      id: uuid.describe('Id of the shopping item, from shopping_list.'),
      bought: z
        .boolean()
        .describe('true marks the item as bought by the caller; false reopens a bought item.'),
      expectedUpdatedAt: isoDateTime.describe(
        "The item's updatedAt exactly as returned by shopping_list (ISO 8601 with offset). Guards against concurrent edits.",
      ),
      expectedBoughtAt: isoDateTime
        .nullable()
        .describe(
          "The item's boughtAt exactly as returned by shopping_list, or null if it is still open. Guards against concurrent edits.",
        ),
    }),
    path: (input) => ['shopping', input.id],
    body: (input) => ({
      bought: input.bought,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedBoughtAt: input.expectedBoughtAt,
    }),
  }),
  defineTool({
    name: 'shopping_update',
    title: 'Edit a shopping item',
    description:
      "Rename a shopping item or change or clear its quantity, for example to fix a typo or a wrong amount, keeping its id, adder and bought state. Any member may do it. Send only the fields to change, at least one of name and quantity. To tick an item off or reopen it use shopping_set_bought; to delete it use shopping_remove. Uses optimistic locking: call shopping_list first and pass the item's updatedAt and boughtAt unchanged. If someone changed the item in between, the call fails with 409 shopping_item_changed and nothing is written: read the list again and decide again. Renaming to the name of another open item fails with 409 shopping_item_duplicate. Nobody is notified. Returns the updated item; item_not_found for an unknown id.",
    method: 'PATCH',
    input: z
      .strictObject({
        id: uuid.describe('Id of the shopping item, from shopping_list.'),
        name: itemName.optional().describe('New item name. Omit to keep the current one.'),
        quantity: z
          .string()
          .trim()
          .max(40)
          .nullable()
          .optional()
          .describe(
            'New free-text amount, for example "2" or "1 kg". Send null or an empty string to clear it. Omit to keep the current one.',
          ),
        expectedUpdatedAt: isoDateTime.describe(
          "The item's updatedAt exactly as returned by shopping_list (ISO 8601 with offset). Guards against concurrent edits.",
        ),
        expectedBoughtAt: isoDateTime
          .nullable()
          .describe(
            "The item's boughtAt exactly as returned by shopping_list, or null if it is still open. Guards against concurrent edits.",
          ),
      })
      .refine((input) => input.name !== undefined || input.quantity !== undefined, {
        message: 'Send at least one of name and quantity',
        path: ['name'],
      }),
    path: (input) => ['shopping', input.id],
    body: (input) => ({
      name: input.name,
      quantity: input.quantity,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedBoughtAt: input.expectedBoughtAt,
    }),
  }),
  defineTool({
    name: 'shopping_remove',
    title: 'Remove a shopping item',
    description:
      'Permanently delete a single shopping item, open or bought, for example one added by mistake. Only the member who added the item or a flat admin may do it, otherwise 403 not_owner; unknown id gives item_not_found. It cannot be undone and nobody is notified. To only tick an item off, use shopping_set_bought; to wipe all bought items at once, use shopping_clear_bought. Returns { deleted: true }.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the shopping item to delete, from shopping_list.'),
    }),
    path: (input) => ['shopping', input.id],
  }),
  defineTool({
    name: 'shopping_clear_bought',
    title: 'Clear bought items (admin)',
    description:
      "Permanently delete all bought items of the flat's shopping list in one step, leaving open items untouched. Flat admins only, otherwise 403 not_admin. It cannot be undone and nobody is notified. Use it to tidy up the bought history; to delete one item use shopping_remove. Rate limited (too_many_requests with retry_after_s). Returns { deleted: <number of items removed> }.",
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({}),
    path: () => ['shopping'],
  }),
];
