import { z } from 'zod';
import { uuid } from './shared.js';
import { defineTool } from './types.js';

const notifyFlags = z.strictObject({
  pushOptIn: z
    .boolean()
    .optional()
    .describe(
      'Master switch for push notifications on your member. false also deletes all your stored push subscriptions; true alone does not subscribe a device.',
    ),
  notifyAnnouncements: z
    .boolean()
    .optional()
    .describe('Receive notifications about announcements.'),
  notifyChores: z.boolean().optional().describe('Receive notifications about chores.'),
  notifyExpenses: z
    .boolean()
    .optional()
    .describe('Receive notifications about expenses, shares and payments.'),
  notifyShopping: z.boolean().optional().describe('Receive notifications about the shopping list.'),
  notifyInventory: z.boolean().optional().describe('Receive notifications about the inventory.'),
  notifyReminders: z
    .boolean()
    .optional()
    .describe('Receive reminders that other members send you.'),
  notifyChat: z.boolean().optional().describe('Receive notifications for new chat messages.'),
  notifyEvents: z.boolean().optional().describe('Receive notifications about calendar events.'),
  notifyStatementEmail: z.boolean().optional().describe('Receive the monthly statement email.'),
  quietStartHour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .nullable()
    .optional()
    .describe(
      'Hour of day (0-23, Europe/Berlin time) when quiet hours begin. null clears it. Quiet hours are only active when both start and end are set and differ; a start later than the end wraps past midnight.',
    ),
  quietEndHour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .nullable()
    .optional()
    .describe(
      'Hour of day (0-23, Europe/Berlin time) when quiet hours end. null clears it. Pair with quietStartHour.',
    ),
});

export const memberTools = [
  defineTool({
    name: 'members_list',
    title: 'List members',
    description:
      'List every member of the flat, including moved-out ones, with id, name, color, active and viewerIsAdmin, plus pagination total/limit/offset. Use it to look up member ids for other tools (payer, assignee, split debtor) or to find who is active; filter on active yourself. For one member and their open balances call member_get, for what others owe you call balances_get. Read-only.',
    method: 'GET',
    input: z.strictObject({
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Page size. Moved-out members stay listed, so the roster only grows.'),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Number of members to skip, ordered by join date. Use with pagination.total.'),
    }),
    path: () => ['members'],
    query: (input) => ({ limit: input.limit, offset: input.offset }),
  }),
  defineTool({
    name: 'member_get',
    title: 'Read a member and their open balances',
    description:
      'Read one member (id, name, active) plus openBalances: every unsettled debt between them and each other member, with member_id, name, amount_cents, currency and direction owes (this member still owes the other) or owed (the other owes them). Use it before member_update to see what money would be left open on a move-out. For all members at once use members_list, for what others owe you use balances_get, for debts between all members dashboard_get. Read-only; unknown ids give member_not_found.',
    method: 'GET',
    input: z.strictObject({
      id: uuid.describe('Id of the member, from members_list.'),
    }),
    path: (input) => ['members', input.id],
  }),
  defineTool({
    name: 'member_update',
    title: 'Change a member (admin, sensitive)',
    description:
      'Move a member out of the flat (active false) or bring them back (active true). Moving out is a reversible soft delete: history and balances stay, but the member drops from active rosters, loses push subscriptions and push opt-in, and their chores are unassigned and current or future absences deleted. Reactivating needs room in the flat (member_limit_reached) and, if the name was taken meanwhile, the member returns under a numbered name. Allowed for the member themselves or an admin (otherwise not_owner); an admin member cannot be deactivated (admin_required). Check open debts with member_get first. Does not rename members or change roles, and nothing is deleted permanently.',
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the member to change, from members_list.'),
      active: z
        .boolean()
        .describe('false moves the member out of the flat, true reactivates a moved-out member.'),
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
      'Read your own notification settings in this flat: the notify* flags per area (announcements, chores, expenses, shopping, inventory, reminders, chat, events, statement email), quietStartHour/quietEndHour (0-23 or null), pushOptIn and pushConfigured (whether the server can send push at all). Call it before notifications_update to see current values. Settings belong to the calling member only; other members cannot be read or changed. Read-only.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['notifications'],
  }),
  defineTool({
    name: 'notifications_update',
    title: 'Change notification settings',
    description:
      'Change your own notification settings in this flat: any subset of the notify* flags, pushOptIn and quiet hours; omitted fields stay as they are. Use it to mute areas or set quiet hours; to read current values call notifications_get first. Quiet hours use Europe/Berlin time and are skipped for urgent events. pushOptIn false deletes all your push subscriptions, and true does not subscribe a device (that happens in the app). Invalid quiet hours give quiet_hours_invalid. Sending an empty object changes nothing and answers ok. Affects only the calling member and notifies nobody. Cannot change other members or flat settings (see wg_update).',
    method: 'PATCH',
    input: notifyFlags,
    path: () => ['notifications'],
    body: (input) => input,
  }),
  defineTool({
    name: 'wg_update',
    title: 'Change flat settings (admin)',
    description:
      'Rename the flat. The name is the only flat setting this can change. Admins only (otherwise not_admin). The new name shows for all members immediately and can be reverted by renaming again. Does not change the share code, members or invitations. For a member moving out use member_update, for your own preferences notifications_update, to create a new flat use wg_create.',
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe('New display name of the flat, replacing the current one.'),
    }),
    path: () => [],
    body: (input) => input,
  }),
];
