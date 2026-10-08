import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const when = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const eventTitle = z.string().trim().min(1).max(200);
const eventDescription = z.string().trim().max(2000);
const eventLocation = z.string().trim().max(200);
const eventRecurrence = z
  .string()
  .trim()
  .max(200)
  .describe(
    'RFC-5545-Teilmenge, ";"-getrennt: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY (Pflicht), INTERVAL 1..365, BYDAY (MO..SU), COUNT 1..366, UNTIL. Sonst recurrence_invalid.',
  );
const reason = z.string().trim().max(120).nullable().optional();

export const calendarTools = [
  defineTool({
    name: 'events_list',
    title: 'Kalendereinträge lesen',
    description:
      'WG-Termine im Fenster from..to (Datum oder ISO mit Offset; der Filter greift nur, wenn beide gesetzt sind). Zu viele Treffer (>1000) ergeben 503 events_window_too_large — dann das Fenster verkleinern.',
    method: 'GET',
    input: z.strictObject({ from: when.optional(), to: when.optional() }),
    path: () => ['events'],
    query: (input) => ({ from: input.from, to: input.to }),
  }),
  defineTool({
    name: 'event_get',
    title: 'Kalendereintrag lesen',
    description: 'Einzelner Termin; 404 event_not_found bei unbekannter id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'event_create',
    title: 'Kalendereintrag anlegen',
    description:
      'title 1..200, startsAt ISO erforderlich (Jahre 1900..2200), endsAt danach (ends_before_start sonst), allDay default false, location/recurrence je max 200, description max 2000.',
    method: 'POST',
    input: z.strictObject({
      title: eventTitle,
      startsAt: isoDateTime,
      description: eventDescription.optional(),
      endsAt: isoDateTime.nullable().optional(),
      allDay: z.boolean().default(false),
      location: eventLocation.optional(),
      recurrence: eventRecurrence.optional(),
    }),
    path: () => ['events'],
    body: (input) => input,
  }),
  defineTool({
    name: 'event_update',
    title: 'Kalendereintrag bearbeiten',
    description:
      'Felder wie event_create, alle optional; nicht gesendete Felder bleiben unverändert, description/location/recurrence/endsAt lassen sich mit null leeren. Nur Ersteller oder Admin (not_owner).',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      title: eventTitle.optional(),
      description: eventDescription.nullable().optional(),
      startsAt: isoDateTime.optional(),
      endsAt: isoDateTime.nullable().optional(),
      allDay: z.boolean().optional(),
      location: eventLocation.nullable().optional(),
      recurrence: eventRecurrence.nullable().optional(),
    }),
    path: (input) => ['events', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'event_delete',
    title: 'Kalendereintrag löschen',
    description:
      'Entfernt den Termin dauerhaft (nur Ersteller oder Admin, sonst not_owner); vorher Datum/Details notieren, wenn sie noch gebraucht werden.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'absences_list',
    title: 'Abwesenheiten lesen',
    description:
      'Künftige und laufende Abwesenheiten (endDate ab Tagesbeginn Berlin) mit id, memberId, memberName, startDate, endDate, reason.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['absences'],
  }),
  defineTool({
    name: 'absence_create',
    title: 'Abwesenheit eintragen',
    description:
      'memberId (selbst oder Admin), startDate/endDate ISO, endDate >= startDate (date_range_invalid), reason max 120. 409 absence_overlaps_existing bei Überschneidung.',
    method: 'POST',
    input: z.strictObject({
      memberId: uuid,
      startDate: isoDateTime,
      endDate: isoDateTime,
      reason,
    }),
    path: () => ['absences'],
    body: (input) => input,
  }),
  defineTool({
    name: 'absence_delete',
    title: 'Abwesenheit löschen',
    description: 'Entfernt den Eintrag; erlaubt für die betroffene Person oder Admin (not_owner).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['absences', input.id],
  }),
];
