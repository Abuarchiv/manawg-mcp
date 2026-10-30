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
    'RFC 5545 subset, separated by ";": FREQ=DAILY|WEEKLY|MONTHLY|YEARLY (required), INTERVAL 1..365, BYDAY (MO..SU), COUNT 1..366, UNTIL. Otherwise recurrence_invalid.',
  );
const reason = z.string().trim().max(120).nullable().optional();

export const calendarTools = [
  defineTool({
    name: 'events_list',
    title: 'Read calendar events',
    description:
      'Flat events in the window from..to (a date or ISO with offset; the filter applies only when both are set). Too many matches (>1000) give 503 events_window_too_large; then narrow the window.',
    method: 'GET',
    input: z.strictObject({ from: when.optional(), to: when.optional() }),
    path: () => ['events'],
    query: (input) => ({ from: input.from, to: input.to }),
  }),
  defineTool({
    name: 'event_get',
    title: 'Read a calendar event',
    description: 'One event; 404 event_not_found for an unknown id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'event_create',
    title: 'Create a calendar event',
    description:
      'title 1..200, startsAt ISO required (years 1900..2200), endsAt not before it (otherwise ends_before_start), allDay default false, location/recurrence max 200 each, description max 2000. An all-day event keeps only the date: send the date at T00:00:00Z.',
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
    title: 'Edit a calendar event',
    description:
      'Fields as in event_create, all optional; fields not sent stay unchanged, description/location/recurrence/endsAt can be cleared with null. Only the creator or an admin (not_owner). expectedUpdatedAt (updatedAt from event_get) guards against concurrent edits: 409 event_changed means read again and decide.',
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
      expectedUpdatedAt: isoDateTime.optional(),
    }),
    path: (input) => ['events', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'event_delete',
    title: 'Delete a calendar event',
    description:
      'Removes the event for good (only the creator or an admin, otherwise not_owner); note the date and details first if they are still needed.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'absences_list',
    title: 'Read absences',
    description:
      'Current and upcoming absences (endDate from the start of today in Berlin) with id, memberId, memberName, startDate, endDate and reason.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['absences'],
  }),
  defineTool({
    name: 'absence_create',
    title: 'Record an absence',
    description:
      'memberId (yourself, or anyone as an admin), startDate/endDate ISO, endDate >= startDate (date_range_invalid), reason max 120. 409 absence_overlaps_existing when it overlaps another absence.',
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
    title: 'Delete an absence',
    description: 'Removes the entry; allowed for the absent person or an admin (not_owner).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['absences', input.id],
  }),
];
