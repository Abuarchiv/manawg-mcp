import { z } from 'zod';
import { defineTool } from './types.js';

const exportSection = z.enum([
  'members',
  'expenses',
  'expensePayments',
  'recurringExpenses',
  'shoppingItems',
  'chores',
  'absences',
  'announcements',
  'announcementComments',
  'events',
  'chatMessages',
  'auditEvents',
]);

export const overviewTools = [
  defineTool({
    name: 'wg_list',
    title: 'List your flats',
    description:
      'All flats of the signed-in account with name, code (share code) and memberId, independent of MANAWG_WG_CODE, so switching or recovering works without local state.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['mine'],
    scope: 'account',
  }),
  defineTool({
    name: 'wg_overview',
    title: 'Flat overview',
    description:
      'Manifest of the connected flat: wg (name, shareCode, joiningEnabled), members (id, name, color) and currentMember. The starting point for every task; use the memberId values from here in all other tools.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => [],
  }),
  defineTool({
    name: 'dashboard_get',
    title: 'Read the dashboard',
    description:
      'Compact overall picture: balances, spendByDay, spending totals (cents), openShoppingCount, openShoppingTop, dueChores, activity, latestAnnouncement, myOpenAnnouncements, dueRecurringExpenses, absentMembers, wgHealth and setup. Totals per currency in totalSpendByCurrency/weekSpendByCurrency/monthSpendByCurrency.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['dashboard'],
  }),
  defineTool({
    name: 'activity_get',
    title: 'Read the activity feed',
    description:
      'Chronological timeline (expenses, shopping, announcements, chores, recurring, absences, audit) plus active reminders (kind, title, detail, href; top 6). Reads are limited to 120 requests per minute per IP.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['activity'],
  }),
  defineTool({
    name: 'export_get',
    title: 'Export flat data',
    description:
      'Export of the flat data. format json returns all sections or only those named in sections; format csv returns exactly ONE section (section, expenses when omitted) as { contentType, content }. Sections: members, expenses, expensePayments, recurringExpenses, shoppingItems, chores, absences, announcements, announcementComments, events, chatMessages, auditEvents. limit up to 100000 and offset for paging (members are never paged).',
    method: 'GET',
    input: z.strictObject({
      format: z.enum(['json', 'csv']).default('json'),
      section: exportSection.optional().describe('Only for format csv: the one section.'),
      sections: z
        .array(exportSection)
        .min(1)
        .optional()
        .describe('Only for format json: limit the export to these sections.'),
      limit: z.number().int().min(1).max(100_000).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    path: () => ['export'],
    query: (input) => ({
      format: input.format,
      ...(input.format === 'csv'
        ? { section: input.section }
        : { sections: input.sections?.join(',') }),
      limit: input.limit,
      offset: input.offset,
    }),
  }),
];
