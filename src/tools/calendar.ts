import { z } from 'zod';
import { defineTool, isoDateTime, uuid } from './finance.js';

const when = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const eventTitle = z.string().trim().min(1).max(200);
const reason = z.string().trim().max(120).nullable().optional();

export const calendarTools = [
  defineTool({
    name: 'events_list',
    title: 'Kalendereinträge lesen',
    description:
      'WG-Termine im Fenster from..to (Datum oder ISO mit Offset; gemeinsam optional, window darf nicht zu groß sein, sonst 503 events_window_too_large). Max 1000 Einträge.',
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
      'title 1..200, startsAt ISO erforderlich, endsAt danach (ends_before_start sonst), allDay default false, location/recurrence je max 200, description max 2000.',
    method: 'POST',
    input: z.strictObject({
      title: eventTitle,
      startsAt: isoDateTime,
      description: z.string().trim().max(2000).optional(),
      endsAt: isoDateTime.optional(),
      allDay: z.boolean().default(false),
      location: z.string().trim().max(200).optional(),
      recurrence: z.string().trim().max(200).optional(),
    }),
    path: () => ['events'],
    body: (input) => input,
  }),
  defineTool({
    name: 'event_update',
    title: 'Kalendereintrag bearbeiten',
    description:
      'Felder wie event_create, alle optional; nicht gesendete Felder bleiben unverändert.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      title: eventTitle.optional(),
      description: z.string().trim().max(2000).optional(),
      startsAt: isoDateTime.optional(),
      endsAt: isoDateTime.optional(),
      allDay: z.boolean().optional(),
      location: z.string().trim().max(200).optional(),
      recurrence: z.string().trim().max(200).optional(),
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
      'Entfernt den Termin dauerhaft; vorher Datum/Details notieren, wenn sie noch gebraucht werden.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'absences_list',
    title: 'Abwesenheiten lesen',
    description:
      'Künftige und laufende Abwesenheiten (endDate >= jetzt) mit memberName, startDate, endDate, reason.',
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
