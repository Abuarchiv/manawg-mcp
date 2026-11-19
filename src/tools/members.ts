import { z } from 'zod';
import { uuid, withoutId } from './shared.js';
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
        .optional()
        .describe(
          'Page size, default and maximum 500. Moved-out members stay listed, so the roster only grows.',
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
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
    title: 'Move a member out or back in',
    description:
      'Move a member out of the flat (active false) or bring them back (active true). Moving out is a reversible soft delete: history and balances stay, but the member drops from active rosters, loses push subscriptions and push opt-in, and their chores are unassigned and current or future absences deleted. Reactivating needs room in the flat (member_limit_reached) and, if the name was taken meanwhile, the member returns under a numbered name. Allowed for the member themselves or an admin (otherwise not_owner); an admin member cannot be deactivated (admin_required). Check open debts with member_get first. Does not rename members or change roles, and nothing is deleted permanently.',
    method: 'PATCH',
    idempotent: true,
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the member to change, from members_list.'),
      active: z
        .boolean()
        .describe('false moves the member out of the flat, true reactivates a moved-out member.'),
    }),
    path: (input) => ['members', input.id],
    body: withoutId,
  }),
  defineTool({
    name: 'invite_create',
    title: 'Create an invite link',
    description:
      'Create a link that lets one or more people join the flat; this is the only way to add flatmates, because the share code alone does not allow joining. The link works for 14 days and for up to 10 joins, and a flat holds at most 20 active links (invite_limit_reached; free one with invite_revoke). Use it when the user wants to hand the link over themselves; to send it by email use invite_email instead, to see existing links use invites_list. Any member may call it. Not idempotent: every call creates a new link. Returns id, url and expiresAt. url is a secret that lets anyone who has it join the flat, so show it only to the user and never post it in chat, notes or logs. It cannot be read again later, because invites_list never returns it.',
    method: 'POST',
    input: z.strictObject({}),
    path: () => ['invites'],
  }),
  defineTool({
    name: 'invites_list',
    title: 'List active invite links',
    description:
      'List the active invite links of the flat, newest first, each with id, createdAt, expiresAt, maxUses, useCount and createdByName. Links that expired, were revoked or reached their use limit are not listed. Use it to find the id for invite_revoke or to see whether a link was used; it never returns the link URL itself (only invite_create does), so a lost link has to be revoked and recreated. Read-only; any member may call it.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['invites'],
  }),
  defineTool({
    name: 'invite_revoke',
    title: 'Revoke an invite link',
    description:
      'Switch off one active invite link at once, so nobody can join with it any more. Use it when a link was shared too widely or sent to the wrong person; people who already joined stay members, and to remove a member use member_update. The id comes from invites_list or from invite_create. Any member may revoke any link of the flat. A revoked link cannot be restored, but invite_create makes a new one. Fails with 404 invite_not_found when the link is unknown or already revoked. Notifies nobody and writes an audit entry. Returns revoked true.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the invite link, from invites_list or invite_create.'),
    }),
    path: (input) => ['invites', input.id],
  }),
  defineTool({
    name: 'invite_email',
    title: 'Email an invite link',
    description:
      'Send an invitation email with a fresh invite link (valid 14 days) to one address. Use it when the user names a person to invite; if the user wants to pass on the link themselves use invite_create, which returns it. Any member may call it. The email goes to an external person, so confirm the address with the user first. The address is not stored. Only one mail per address and flat is sent per day: a repeat returns status duplicate and sends nothing. Returns status: sent, or unconfirmed (the mail provider timed out, so it may still arrive and the link stays valid). Fails with mail_unavailable (nothing sent, try later), invite_rate_limited when a limit is reached (10 mails per hour per member, 20 per day per account, 2 per day per address), and invite_limit_reached when the flat already has 20 active links (free one with invite_revoke).',
    method: 'POST',
    input: z.strictObject({
      email: z
        .email()
        .max(254)
        .describe(
          'Email address of the person to invite, given by the user. Lower-cased automatically.',
        ),
    }),
    path: () => ['invitations'],
    body: (input) => input,
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
    idempotent: true,
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
    idempotent: true,
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
