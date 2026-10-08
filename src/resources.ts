import type { QueryParams, RequestScope } from './manawg-client.js';
import type { PayloadLimits } from './payload.js';

export type ResourceDef = {
  name: string;
  uri: string;
  title: string;
  description: string;
  path: string[];
  query?: QueryParams;
  scope?: RequestScope;
  limits?: PayloadLimits;
};

type ResourceSpec = Omit<ResourceDef, 'uri'>;

function resource(spec: ResourceSpec): ResourceDef {
  return { ...spec, uri: `manawg://current/${spec.name}` };
}

export const RESOURCE_DEFS: ResourceDef[] = [
  resource({
    name: 'dashboard',
    title: 'ManaWG-Dashboard',
    description:
      'Aggregiertes Gesamtbild: Salden, Ausgaben je Tag, offene Einkäufe, anstehende Putzaufgaben, Ankündigungen und WG-Gesundheit.',
    path: ['dashboard'],
  }),
  resource({
    name: 'members',
    title: 'Mitglieder der WG',
    description:
      'WG-Manifest mit Name, Share-Code, allen Mitgliedern (id, name, color) und currentMember (memberId, name).',
    path: [],
  }),
  resource({
    name: 'expenses',
    title: 'Ausgaben und Splits',
    description:
      'Neueste Ausgaben mit Schuldnersplits und Zahlungen; die Liste ist auf 100 Einträge begrenzt (_mcp.truncated), vollständig über expenses_list mit limit/offset.',
    path: ['expenses'],
    limits: { maxItems: 100, maxBytes: 40_000 },
  }),
  resource({
    name: 'recurring',
    title: 'Fixkosten',
    description:
      'Wiederkehrende Ausgaben mit Intervall, nächstem Fälligkeitstermin, Pause-Status und Splits.',
    path: ['recurring-expenses'],
  }),
  resource({
    name: 'shopping',
    title: 'Einkaufsliste',
    description: 'Offene und gekaufte Artikel samt Eintragenden und Kaufzeitpunkt.',
    path: ['shopping'],
  }),
  resource({
    name: 'inventory',
    title: 'Vorräte',
    description: 'Vorratsartikel mit Bestand, Schwelle, Einheit und Kategorie.',
    path: ['inventory'],
  }),
  resource({
    name: 'chores',
    title: 'Putzplan',
    description: 'Putzaufgaben mit Zuständigem, Intervall und nächstem Fälligkeitstermin.',
    path: ['chores'],
  }),
  resource({
    name: 'notes',
    title: 'Pinnwand',
    description: 'Ankündigungen mit Status, Reaktionen, Takers und Kommentaren.',
    path: ['announcements'],
  }),
  resource({
    name: 'chat',
    title: 'Chatverlauf',
    description: 'Die 50 neuesten Chatnachrichten inklusive Reaktionen und Mentions.',
    path: ['chat', 'messages'],
    query: { limit: 50 },
  }),
  resource({
    name: 'events',
    title: 'Kalender',
    description: 'WG-Termine mit Zeiten, Ort und Wiederholungsregel.',
    path: ['events'],
  }),
  resource({
    name: 'absences',
    title: 'Abwesenheiten',
    description: 'Laufende und künftige Abwesenheiten der Mitglieder.',
    path: ['absences'],
  }),
  resource({
    name: 'activity',
    title: 'Aktivitätsverlauf',
    description: 'Chronologische Timeline aller Änderungen plus aktive Reminder.',
    path: ['activity'],
  }),
  resource({
    name: 'wg',
    title: 'Eigene WGs',
    description:
      'Alle WGs des angemeldeten Accounts mit name, code und memberId (Route /api/wg/mine).',
    path: ['mine'],
    scope: 'account',
  }),
];

export type ResourceTemplateDef = {
  name: string;
  uriTemplate: string;
  title: string;
  description: string;
  path: (id: string) => string[];
};

function entityResource(
  name: string,
  title: string,
  description: string,
  segments: string[],
): ResourceTemplateDef {
  return {
    name,
    uriTemplate: `manawg://current/${name}/{id}`,
    title,
    description,
    path: (id) => [...segments, id],
  };
}

/** Single-entity URIs for the routes that answer GET on their own. */
export const RESOURCE_TEMPLATE_DEFS: ResourceTemplateDef[] = [
  entityResource('event', 'Termin', 'Einzelner Kalendereintrag nach id (events/[id]).', ['events']),
  entityResource('chore', 'Putzaufgabe', 'Einzelne Putzaufgabe nach id (chores/[id]).', ['chores']),
  entityResource('member', 'Mitglied', 'Einzelnes Mitglied nach id (members/[id]).', ['members']),
  entityResource(
    'recurring',
    'Fixkosten-Template',
    'Einzelnes Fixkosten-Template nach id (recurring-expenses/[id]).',
    ['recurring-expenses'],
  ),
];
