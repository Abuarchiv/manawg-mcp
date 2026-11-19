import { z } from 'zod';
import { defineTool } from './types.js';

const exportSection = z.enum([
  'members',
  'expenses',
  'expensePayments',
  'recurringExpenses',
  'shoppingItems',
  'chores',
  'choreCompletions',
  'inventory',
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
      'Lists every flat the signed-in account is an active member of, each with id, name, share code (code) and your memberId in it. Use it first when the account belongs to several flats, then pass the chosen code as wgCode to every other tool; it is the only tool that needs no wgCode. To see the members and details of one flat, call wg_overview instead. Read-only.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['mine'],
    scope: 'account',
  }),
  defineTool({
    name: 'wg_overview',
    title: 'Flat overview',
    description:
      'Returns the manifest of the connected flat: wg (id, name, shareCode, createdAt), members (id, name, color) and currentMember (your memberId and name). Call it at the start of a task to resolve member names to the member ids that all other tools take. For balances, spending and open items use dashboard_get; to list the other flats of the account use wg_list. Read-only; any member may call it.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => [],
  }),
  defineTool({
    name: 'dashboard_get',
    title: 'Read the dashboard',
    description:
      'Returns the compact overall picture of the flat in one call: balances, spendByDay, spending totals in cents (per currency in totalSpendByCurrency, weekSpendByCurrency, monthSpendByCurrency), openShoppingCount, openShoppingTop, dueChores, activity, latestAnnouncement, myOpenAnnouncements, dueRecurringExpenses, absentMembers and wgHealth setup state. Use it for a quick status check; for full lists use the dedicated tools such as expenses_list, shopping_list or chores_list, and for the event history use activity_get. Read-only; limited to 60 reads per minute per member (error rate_limited).',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['dashboard'],
  }),
  defineTool({
    name: 'activity_get',
    title: 'Read the activity feed',
    description:
      'Returns the chronological timeline of the newest 80 entries of the flat (expenses, shopping, announcements, chore completions, recurring costs, absences, audit events) plus active reminders (kind, title, detail, href; top 6) for open shopping items, overdue chores and open announcements. Use it to see what happened recently and who did it; it takes no filters or paging. For current totals and balances use dashboard_get, for a complete data dump use export_get. Read-only.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['activity'],
  }),
  defineTool({
    name: 'export_get',
    title: 'Export flat data',
    description:
      'Exports the stored data of the flat for backup or analysis. With format json (default) it returns the requested sections, or all of them when sections is omitted; with format csv it returns exactly one section (expenses when omitted) as { contentType, content }. Members are never paged; limit and offset page every other section. Use the specific list tools for everyday reads and this one only for bulk dumps. Read-only; limited to 20 exports per hour per member (error rate_limited). An unusable format, section or paging value is rejected with format_invalid, section_invalid or pagination_invalid.',
    method: 'GET',
    input: z.strictObject({
      format: z
        .enum(['json', 'csv'])
        .default('json')
        .describe('Output format. json can hold several sections, csv exactly one.'),
      section: exportSection
        .optional()
        .describe('Only for format csv: the one section to export. Defaults to expenses.'),
      sections: z
        .array(exportSection)
        .min(1)
        .optional()
        .describe('Only for format json: the sections to include. Omit to export all sections.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100_000)
        .optional()
        .describe('Maximum rows per section. Omit to return all rows. Members are never limited.'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Rows to skip per section, for paging together with limit. Defaults to 0.'),
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
