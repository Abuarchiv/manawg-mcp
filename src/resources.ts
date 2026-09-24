import type { PayloadLimits } from './payload.js';

export type ResourceDef = {
  name: string;
  uri: string;
  title: string;
  description: string;
  path: string[];
  query?: Record<string, string | number | boolean | undefined>;
  scope?: 'wg' | 'account';
  limits?: PayloadLimits;
};

function resource(
  name: string,
  title: string,
  description: string,
  path: string[],
  query?: Record<string, string | number | boolean | undefined>,
  scope?: 'wg' | 'account',
  limits?: PayloadLimits,
): ResourceDef {
  const def: ResourceDef = { name, uri: `manawg://current/${name}`, title, description, path };
  if (query) {
    def.query = query;
  }
  if (scope) {
    def.scope = scope;
  }
  if (limits) {
    def.limits = limits;
  }
  return def;
}

export const RESOURCE_DEFS: ResourceDef[] = [
  resource(
    'dashboard',
    'ManaWG-Dashboard',
    'Aggregiertes Gesamtbild: Salden, Ausgaben je Tag, offene Einkäufe, anstehende Putzaufgaben, Ankündigungen und WG-Gesundheit.',
    ['dashboard'],
  ),
  resource(
    'members',
    'Mitglieder der WG',
    'WG-Manifest mit Name, Share-Code, allen Mitgliedern (id, name, color) und dem eigenen member.',
    [],
  ),
  resource(
    'expenses',
    'Ausgaben und Splits',
    'Neueste Ausgaben mit Schuldnersplits und Zahlungen; die Liste ist auf 100 Einträge begrenzt (_mcp.truncated), vollständig über expenses_list mit limit/offset.',
    ['expenses'],
    undefined,
    undefined,
    { maxItems: 100, maxBytes: 40_000 },
  ),
  resource(
    'recurring',
    'Fixkosten',
    'Wiederkehrende Ausgaben mit Intervall, nächstem Fälligkeitstermin, Pause-Status und Splits.',
    ['recurring-expenses'],
  ),
  resource(
    'shopping',
    'Einkaufsliste',
    'Offene und gekaufte Artikel samt Eintragenden und Kaufzeitpunkt.',
    ['shopping'],
  ),
  resource('inventory', 'Vorräte', 'Vorratsartikel mit Bestand, Schwelle, Einheit und Kategorie.', [
    'inventory',
  ]),
  resource(
    'chores',
    'Putzplan',
    'Putzaufgaben mit Zuständigem, Intervall und nächstem Fälligkeitstermin.',
    ['chores'],
  ),
  resource('notes', 'Pinnwand', 'Ankündigungen mit Status, Reaktionen, Takers und Kommentaren.', [
    'announcements',
  ]),
  resource(
    'chat',
    'Chatverlauf',
    'Die 50 neuesten Chatnachrichten inklusive Reaktionen und Mentions.',
    ['chat', 'messages'],
    { limit: 50 },
  ),
  resource('events', 'Kalender', 'WG-Termine mit Zeiten, Ort und Wiederholungsregel.', ['events']),
  resource('absences', 'Abwesenheiten', 'Laufende und künftige Abwesenheiten der Mitglieder.', [
    'absences',
  ]),
  resource(
    'activity',
    'Aktivitätsverlauf',
    'Chronologische Timeline aller Änderungen plus aktive Reminder.',
    ['activity'],
  ),
  resource(
    'wg',
    'Eigene WGs',
    'Alle WGs des angemeldeten Accounts mit name, code und memberId (Route /api/wg/mine).',
    ['mine'],
    undefined,
    'account',
  ),
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
