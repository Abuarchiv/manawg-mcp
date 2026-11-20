import { z } from 'zod';
import { isoDateTime, uuid, withoutId } from './shared.js';
import { defineTool } from './types.js';

const units = z.enum(['piece', 'litre', 'kilogram', 'roll', 'pack']);
const categories = z.enum(['bathroom', 'kitchen', 'cleaning', 'other']);
const itemName = z.string().trim().min(1).max(120);
const MAX_STOCK = 9999;
// Quantities and thresholds share the app's bounds: 0 to 9999 in steps of 0.01.
const stock = z.number().multipleOf(0.01).min(0).max(MAX_STOCK);

const editFields = ['name', 'quantityDelta', 'quantity', 'threshold', 'unit', 'category'] as const;

export const inventoryTools = [
  defineTool({
    name: 'inventory_list',
    title: 'Read supplies',
    description:
      'Lists all household supply items (toilet paper, detergent and similar) of the flat with quantity, unit, threshold, category and decrementCount30d (times the stock was reduced in the last 30 days). An item is low on stock when quantity <= threshold. Read-only. Call it first to get the item ids that inventory_update, inventory_consume and inventory_remove need, and to check for an existing item before inventory_add. Not for the shopping list; use shopping_list for that.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['inventory'],
  }),
  defineTool({
    name: 'inventory_add',
    title: 'Add a supply item',
    description:
      'Creates a new supply item in the flat. Use it only for a product that is not tracked yet; to change stock of an existing item use inventory_consume or inventory_update. Item names are unique per flat, ignoring case and surrounding spaces; a taken name fails with 409 inventory_item_duplicate. If the starting quantity is already <= threshold (which the defaults give), the item is put on the shopping list automatically. Returns the created item.',
    method: 'POST',
    input: z.strictObject({
      name: itemName.describe(
        'Display name of the product, for example "Toilet paper". Must be new in the flat.',
      ),
      quantity: stock.default(0).describe('Current stock in the chosen unit. Defaults to 0.'),
      unit: units
        .default('piece')
        .describe('Unit of measure for quantity and threshold. Defaults to piece.'),
      threshold: stock
        .default(1)
        .describe(
          'Low-stock limit in the chosen unit: at or below this quantity the item counts as low and goes on the shopping list. Defaults to 1.',
        ),
      category: categories
        .default('other')
        .describe('Category used to group the item. Defaults to other.'),
    }),
    path: () => ['inventory'],
    body: (input) => input,
  }),
  defineTool({
    name: 'inventory_update',
    title: 'Edit a supply item',
    description:
      'Edits one supply item: rename it, change unit, category or threshold, or change its stock. For stock use quantityDelta to add or subtract (restock or relative change, no version check) or quantity to set an absolute value after a stocktake; the absolute form requires expectedQuantity and expectedUpdatedAt from a fresh inventory_list and fails with 409 version_conflict if the item changed since, so read again and retry. To record that something was used up, prefer inventory_consume. Send only the fields to change; an empty update fails with empty_update. A rename to a name already in the flat fails with 409 inventory_item_duplicate. A change that moves the stock from above to at or below threshold puts the item on the shopping list. Returns the updated item; unknown ids give 404 item_not_found.',
    method: 'PATCH',
    input: z
      .strictObject({
        id: uuid.describe('Id of the supply item to edit, from inventory_list.'),
        name: itemName
          .optional()
          .describe('New display name. Must not match another item in the flat.'),
        quantityDelta: z
          .number()
          .multipleOf(0.01)
          .min(-MAX_STOCK)
          .max(MAX_STOCK)
          .optional()
          .describe(
            'Relative stock change in the item unit: positive to restock, negative to use. Result is clamped to 0..9999. Do not combine with quantity.',
          ),
        quantity: stock
          .optional()
          .describe(
            'Absolute stock to set in the item unit (stocktake correction). Requires expectedQuantity and expectedUpdatedAt. Do not combine with quantityDelta.',
          ),
        expectedQuantity: stock
          .optional()
          .describe(
            'Quantity of the item as last read from inventory_list. Required when quantity is set; a mismatch gives 409 version_conflict.',
          ),
        expectedUpdatedAt: isoDateTime
          .optional()
          .describe(
            'updatedAt of the item as last read from inventory_list, ISO 8601 with offset. Required when quantity is set; a mismatch gives 409 version_conflict.',
          ),
        threshold: stock
          .optional()
          .describe(
            'New low-stock threshold in the item unit; stock at or below it counts as low.',
          ),
        unit: units.optional().describe('New unit of measure for quantity and threshold.'),
        category: categories.optional().describe('New category used to group the item.'),
      })
      .refine((input) => editFields.some((field) => input[field] !== undefined), {
        message: 'Send at least one field to change',
        path: ['name'],
      })
      .refine(
        (input) =>
          input.quantity === undefined ||
          (input.expectedQuantity !== undefined && input.expectedUpdatedAt !== undefined),
        {
          message: 'quantity needs expectedQuantity and expectedUpdatedAt',
          path: ['quantity'],
        },
      ),
    path: (input) => ['inventory', input.id],
    body: withoutId,
  }),
  defineTool({
    name: 'inventory_consume',
    title: 'Use up stock',
    description:
      'Records that stock of one item was used up by lowering its quantity; use it for everyday use (someone took a roll) instead of inventory_update. Stock never goes below 0. When this use takes the item from above threshold to at or below it, the item is added to the shopping list and the other flat members get a low-stock notification (not the caller). Returns the item, clamped (true when the change was limited at 0), autoPushedShoppingItemId (shopping item created, or null) and a notification warning. Concurrent uses are applied one after another; a rare race gives 409 version_conflict, then retry. Unknown ids give 404 item_not_found. To restock or correct stock use inventory_update.',
    method: 'POST',
    input: z.strictObject({
      id: uuid.describe('Id of the supply item that was used, from inventory_list.'),
      delta: z
        .number()
        .int()
        .min(-100)
        .max(-1)
        .describe(
          'Whole units used, as a negative number in the item unit (for example -1 when one piece or roll was taken).',
        ),
    }),
    path: (input) => ['inventory', input.id, 'consume'],
    body: withoutId,
  }),
  defineTool({
    name: 'inventory_remove',
    title: 'Delete a supply item',
    description:
      'Permanently deletes one supply item together with its usage history; this cannot be undone. Use it only when the product is no longer kept in the flat. To lower stock use inventory_consume, and to rename or correct the item use inventory_update. Any flat member may delete. Does not touch shopping list entries already created from the item. Unknown ids give 404 item_not_found.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the supply item to delete, from inventory_list.'),
    }),
    path: (input) => ['inventory', input.id],
  }),
];
