import { z } from 'zod';
import { defineTool } from './types.js';

export const overviewTools = [
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
      'Kompaktes Gesamtbild: balances, spendByDay, total/week/month spend (zent), openShoppingCount, dueChores, activity, latestAnnouncement, dueRecurringExpenses, absentMembers, wgHealth, setup.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['dashboard'],
  }),
  defineTool({
    name: 'activity_get',
    title: 'Aktivitätsverlauf lesen',
    description:
      'Chronologische Timeline (expenses, shopping, announcements, chores, recurring, absences, audit) plus aktiv Reminder (kind, title, detail, href; top 6). Kein Rate-Limit.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['activity'],
  }),
  defineTool({
    name: 'search',
    title: 'WG-weit suchen',
    description:
      'Volltextsuche über pinnwand, putzen, ausgaben, fixkosten, einkauf, abwesenheiten. Liefert groups [{module, count, results[{id, module, title, meta, href, tags}]}] und suggestions.',
    method: 'GET',
    input: z.strictObject({ q: z.string().trim().min(1).max(200) }),
    path: () => ['search'],
    query: (input) => ({ q: input.q }),
  }),
  defineTool({
    name: 'export_get',
    title: 'WG-Daten exportieren',
    description:
      'Export aller WG-Daten. format: json (sections members, expenses, recurringExpenses, shoppingItems, chores, absences, announcements, auditEvents) oder csv (pro section eine CSV). limit bis 100000, offset für Blättern.',
    method: 'GET',
    input: z.strictObject({
      format: z.enum(['json', 'csv']).default('json'),
      section: z
        .enum([
          'members',
          'expenses',
          'recurringExpenses',
          'shoppingItems',
          'chores',
          'absences',
          'announcements',
          'auditEvents',
        ])
        .optional(),
      limit: z.number().int().min(1).max(100_000).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    path: () => ['export'],
    query: (input) => ({
      format: input.format,
      section: input.section,
      limit: input.limit,
      offset: input.offset,
    }),
  }),
];
