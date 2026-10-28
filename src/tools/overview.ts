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
    title: 'Eigene WGs auflisten',
    description:
      'Alle WGs des angemeldeten Accounts mit name, code (Share-Code) und memberId — unabhängig von MANAWG_WG_CODE, damit ein Wechsel oder eine Wiederherstellung ohne lokalen Stand möglich ist.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['mine'],
    scope: 'account',
  }),
  defineTool({
    name: 'wg_overview',
    title: 'WG-Übersicht',
    description:
      'Manifest der verbundenen WG: wg (name, shareCode, joiningEnabled), members (id, name, color) und currentMember. Startpunkt für jede Aufgabe — memberId-Werte von hier in alle anderen Tools verwenden.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => [],
  }),
  defineTool({
    name: 'dashboard_get',
    title: 'Dashboard lesen',
    description:
      'Kompaktes Gesamtbild: balances, spendByDay, Ausgabensummen (zent), openShoppingCount, openShoppingTop, dueChores, activity, latestAnnouncement, myOpenAnnouncements, dueRecurringExpenses, absentMembers, wgHealth, setup. Summen je Währung in totalSpendByCurrency/weekSpendByCurrency/monthSpendByCurrency.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['dashboard'],
  }),
  defineTool({
    name: 'activity_get',
    title: 'Aktivitätsverlauf lesen',
    description:
      'Chronologische Timeline (expenses, shopping, announcements, chores, recurring, absences, audit) plus aktiv Reminder (kind, title, detail, href; top 6). Lesezugriffe sind pro IP auf 120 Anfragen/Minute begrenzt.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['activity'],
  }),
  defineTool({
    name: 'export_get',
    title: 'WG-Daten exportieren',
    description:
      'Export der WG-Daten. format json liefert alle Abschnitte oder nur die in sections genannten; format csv liefert genau EINEN Abschnitt (section, ohne Angabe expenses) als { contentType, content }. Abschnitte: members, expenses, expensePayments, recurringExpenses, shoppingItems, chores, absences, announcements, announcementComments, events, chatMessages, auditEvents. limit bis 100000 und offset zum Blättern (members werden nie gepaged).',
    method: 'GET',
    input: z.strictObject({
      format: z.enum(['json', 'csv']).default('json'),
      section: exportSection.optional().describe('Nur für format csv: der eine Abschnitt.'),
      sections: z
        .array(exportSection)
        .min(1)
        .optional()
        .describe('Nur für format json: auf diese Abschnitte beschränken.'),
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
