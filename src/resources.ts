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
    title: 'ManaWG dashboard',
    description:
      'Aggregated overall picture: balances, spending per day, open shopping, upcoming chores, posts and flat health.',
    path: ['dashboard'],
  }),
  resource({
    name: 'members',
    title: 'Flat members',
    description:
      'Flat manifest with name, share code, all members (id, name, color) and currentMember (memberId, name).',
    path: [],
  }),
  resource({
    name: 'expenses',
    title: 'Expenses and splits',
    description:
      'Newest expenses with debtor splits and payments; the list is capped at 100 entries (_mcp.truncated), the full list is in expenses_list with limit/offset.',
    path: ['expenses'],
    limits: { maxItems: 100, maxBytes: 40_000 },
  }),
  resource({
    name: 'recurring',
    title: 'Fixed costs',
    description: 'Recurring expenses with interval, next due date, pause state and splits.',
    path: ['recurring-expenses'],
  }),
  resource({
    name: 'shopping',
    title: 'Shopping list',
    description: 'Open and bought items with who added them and when they were bought.',
    path: ['shopping'],
  }),
  resource({
    name: 'inventory',
    title: 'Supplies',
    description: 'Supply items with stock, threshold, unit and category.',
    path: ['inventory'],
  }),
  resource({
    name: 'chores',
    title: 'Cleaning rota',
    description: 'Chores with assignee, interval and next due date.',
    path: ['chores'],
  }),
  resource({
    name: 'notes',
    title: 'Noticeboard',
    description: 'Posts with status, reactions, takers and comments.',
    path: ['announcements'],
  }),
  resource({
    name: 'chat',
    title: 'Chat',
    description: 'The 50 newest chat messages with reactions and mentions.',
    path: ['chat', 'messages'],
    query: { limit: 50 },
  }),
  resource({
    name: 'events',
    title: 'Calendar',
    description: 'Flat events with times, location and recurrence rule.',
    path: ['events'],
  }),
  resource({
    name: 'absences',
    title: 'Absences',
    description: 'Current and upcoming absences of the members.',
    path: ['absences'],
  }),
  resource({
    name: 'activity',
    title: 'Activity feed',
    description: 'Chronological timeline of all changes plus active reminders.',
    path: ['activity'],
  }),
  resource({
    name: 'wg',
    title: 'Your flats',
    description:
      'All flats of the signed-in account with name, code and memberId (route /api/wg/mine).',
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
  entityResource('event', 'Event', 'One calendar event by id (events/[id]).', ['events']),
  entityResource('chore', 'Chore', 'One chore by id (chores/[id]).', ['chores']),
  entityResource('member', 'Member', 'One member by id (members/[id]).', ['members']),
  entityResource(
    'recurring',
    'Fixed-cost template',
    'One fixed-cost template by id (recurring-expenses/[id]).',
    ['recurring-expenses'],
  ),
];
