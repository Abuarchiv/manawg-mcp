import { z } from 'zod';
import { uuid } from './shared.js';
import { defineTool } from './types.js';

const notifyFlags = z.strictObject({
  pushOptIn: z.boolean().optional(),
  notifyAnnouncements: z.boolean().optional(),
  notifyChores: z.boolean().optional(),
  notifyExpenses: z.boolean().optional(),
  notifyShopping: z.boolean().optional(),
  notifyInventory: z.boolean().optional(),
  notifyReminders: z.boolean().optional(),
  notifyChat: z.boolean().optional(),
  notifyEvents: z.boolean().optional(),
  quietStartHour: z.number().int().min(0).max(23).nullable().optional(),
  quietEndHour: z.number().int().min(0).max(23).nullable().optional(),
});

export const memberTools = [
  defineTool({
    name: 'members_list',
    title: 'List members',
    description:
      'All members with id, name, color, active and viewerIsAdmin; pagination total/limit/offset. limit max 500 (default 100).',
    method: 'GET',
    input: z.strictObject({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }),
    path: () => ['members'],
    query: (input) => ({ limit: input.limit, offset: input.offset }),
  }),
  defineTool({
    name: 'member_get',
    title: 'Read a member and their open balances',
    description: 'One member plus openBalances (direction owes|owed).',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['members', input.id],
  }),
  defineTool({
    name: 'member_update',
    title: 'Change a member (admin, sensitive)',
    description:
      'Sets active false for a reversible move-out or active true to reactivate. Allowed for the member themselves or an admin (otherwise not_owner); admin members cannot be deactivated (admin_required). active is required.',
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid,
      active: z.boolean(),
    }),
    path: (input) => ['members', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'notifications_get',
    title: 'Read notification settings',
    description:
      'All notify* flags, quietStartHour/quietEndHour (0..23), pushOptIn and pushConfigured.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['notifications'],
  }),
  defineTool({
    name: 'notifications_update',
    title: 'Change notification settings',
    description:
      'Sets any notify* flags and/or quiet hours 0..23 (otherwise quiet_hours_invalid). pushOptIn false removes all push subscriptions. Without fields nothing happens (answers ok).',
    method: 'PATCH',
    input: notifyFlags,
    path: () => ['notifications'],
    body: (input) => input,
  }),
  defineTool({
    name: 'wg_update',
    title: 'Change flat settings (admin)',
    description:
      'name 1..100, joiningEnabled turns joining on or off, rotateShareCode true creates a NEW 8-character join code and turns joining on. The old code stops working, and MANAWG_WG_CODE of this server must then be set to the new code, otherwise every further call answers wg_not_found. Admins only (not_admin), at least one field.',
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({
      name: z.string().trim().min(1).max(100).optional(),
      joiningEnabled: z.boolean().optional(),
      rotateShareCode: z.boolean().optional(),
    }),
    path: () => [],
    body: (input) => input,
  }),
];
