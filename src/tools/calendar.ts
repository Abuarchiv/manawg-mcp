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
    'Repeat rule, an RFC 5545 subset with parts separated by ";", for example "FREQ=WEEKLY;BYDAY=MO,TH;COUNT=10". FREQ=DAILY|WEEKLY|MONTHLY|YEARLY is required; optional INTERVAL 1..365, BYDAY (MO..SU), COUNT 1..366, UNTIL. Anything else fails with recurrence_invalid.',
  );
const reason = z
  .string()
  .trim()
  .max(120)
  .nullable()
  .optional()
  .describe('Optional free-text reason, for example "Holiday". Omit or send null for none.');

/** The app parses a bare date as midnight UTC, which would drop events later that day. */
function endOfBareDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

export const calendarTools = [
  defineTool({
    name: 'events_list',
    title: 'Read calendar events',
    description:
      'List the flat calendar events, optionally inside a time window, ordered by start. Use it to see what is planned or to find an event id; use event_get when you already have the id, and calendar_subscription_get for the feed URL that adds the calendar to a calendar app. Read-only. A recurring event comes back once with its recurrence rule, not expanded into single dates. The window applies only when from and to are both set; without it all events are returned. More than 1000 matches fail with 503 events_window_too_large, so narrow the window. Each event has id, title, description, startsAt, endsAt, allDay, location, recurrence, createdByMemberId and updatedAt.',
    method: 'GET',
    input: z.strictObject({
      from: when
        .optional()
        .describe(
          'Window start: a date (2026-12-01) or an ISO 8601 datetime with offset. Only applies together with to.',
        ),
      to: when
        .optional()
        .describe(
          'Window end: a date or an ISO 8601 datetime with offset. A bare date covers that whole day (sent as 23:59:59.999 UTC). Only applies together with from.',
        ),
    }),
    path: () => ['events'],
    query: (input) => ({ from: input.from, to: input.to && endOfBareDate(input.to) }),
  }),
  defineTool({
    name: 'event_get',
    title: 'Read a calendar event',
    description:
      'Fetch one calendar event with all its fields, including updatedAt, the version token event_update takes as expectedUpdatedAt. Use it when you have an event id and want its current state, for example before editing; use events_list to browse or find events. Read-only. An id that is not in this flat fails with 404 event_not_found.',
    method: 'GET',
    input: z.strictObject({
      id: uuid.describe('Id of the event, from events_list or event_create.'),
    }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'event_create',
    title: 'Create a calendar event',
    description:
      'Add a new event, one-off or repeating, to the flat calendar. Use it for something new; use event_update to change an existing event, and absence_create instead when a member is away. Not idempotent: calling it twice creates two events. The other flat members are notified about the new event, not the caller; a failed notification does not fail the call. An endsAt before startsAt fails with ends_before_start. Returns the created event with its id.',
    method: 'POST',
    input: z.strictObject({
      title: eventTitle.describe(
        'Short name of the event, shown in the calendar and the notification.',
      ),
      startsAt: isoDateTime.describe(
        'Start as ISO 8601 datetime with offset, for example 2026-12-05T19:00:00+01:00; the year must be 1900..2200. For an all-day event only the date counts: send the date at T00:00:00Z.',
      ),
      description: eventDescription.optional().describe('Optional longer details for the event.'),
      endsAt: isoDateTime
        .nullable()
        .optional()
        .describe(
          'Optional end as ISO 8601 datetime with offset, not before startsAt. Omit or send null for an event without an end time.',
        ),
      allDay: z
        .boolean()
        .default(false)
        .describe(
          'true for an event that lasts the whole day (no clock time), false for one at a specific time. Defaults to false.',
        ),
      location: eventLocation
        .optional()
        .describe('Optional place, for example "Kitchen" or an address.'),
      recurrence: eventRecurrence.optional(),
    }),
    path: () => ['events'],
    body: (input) => input,
  }),
  defineTool({
    name: 'event_update',
    title: 'Edit a calendar event',
    description:
      'Change fields of an existing event; fields you leave out stay unchanged, and description, location, recurrence and endsAt can be cleared by sending null. Use event_create for a new event and event_delete to remove one. Only the event creator or a flat admin may edit it, otherwise 403 not_owner. For a recurring event the change applies to the whole series; use event_occurrence_change to cancel or move a single date. When the start or allDay changes and the event is still upcoming (or repeating), the other members are notified that it moved. Pass expectedUpdatedAt to guard against concurrent edits: if someone changed the event since, you get 409 event_changed, so read it again with event_get and decide. An endsAt before startsAt fails with ends_before_start. Returns the updated event.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid.describe('Id of the event to edit, from events_list or event_get.'),
      title: eventTitle.optional().describe('New title.'),
      description: eventDescription
        .nullable()
        .optional()
        .describe('New details. null clears them; omit to keep the current text.'),
      startsAt: isoDateTime
        .optional()
        .describe(
          'New start as ISO 8601 datetime with offset, year 1900..2200. For an all-day event only the date counts.',
        ),
      endsAt: isoDateTime
        .nullable()
        .optional()
        .describe(
          'New end as ISO 8601 datetime with offset, not before the start. null removes the end time.',
        ),
      allDay: z
        .boolean()
        .optional()
        .describe(
          'true to make it an all-day event, false for a timed one. Switching a timed event to all-day without new dates keeps its Berlin dates.',
        ),
      location: eventLocation
        .nullable()
        .optional()
        .describe('New place. null clears it; omit to keep it.'),
      recurrence: eventRecurrence
        .nullable()
        .optional()
        .describe('New repeat rule (format as in event_create). null makes it a one-off event.'),
      expectedUpdatedAt: isoDateTime
        .optional()
        .describe(
          'The updatedAt value you last read from event_get or events_list. When set, the edit only applies if the event is unchanged since; otherwise 409 event_changed.',
        ),
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
      'Permanently delete a calendar event; there is no undo, so note the date and details first if they are still needed. For a recurring event the whole series is deleted; use event_occurrence_change to drop only one date. Use event_update instead to move or rename it. Only the event creator or a flat admin may delete it, otherwise 403 not_owner. When the event is still upcoming (or repeating), the other members are notified that it was cancelled. An unknown id fails with 404 event_not_found.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the event to delete, from events_list or event_get.'),
    }),
    path: (input) => ['events', input.id],
  }),
  defineTool({
    name: 'event_occurrence_change',
    title: 'Cancel or move one occurrence',
    description:
      'Change a single date of a recurring event while the rest of the series stays as it is. action "cancel" skips that date for good, with no undo route; action "detach" turns that date into its own one-off event with new details, for example a different time or title, and the series skips the original date. Use it instead of event_update or event_delete, which always affect the whole series. Only the event creator or a flat admin may do this, otherwise 403 not_owner. An event without a repeat rule fails with 400 not_recurring. events_list and event_get return the series unexpanded, so work out occurrenceStartsAt from the event startsAt and its recurrence rule; a date that the series does not produce fails with 404 occurrence_not_found, and a series that already skips too many dates with exception_limit_reached. Pass expectedUpdatedAt with detach to refuse a stale edit: 409 event_changed means read the event again with event_get. The other members are notified when the affected date is still ahead. Returns the updated series as event and, for detach, the new one-off event as created (null for cancel).',
    method: 'POST',
    gate: 'destructive',
    input: z
      .strictObject({
        id: uuid.describe('Id of the recurring event, from events_list or event_get.'),
        action: z
          .enum(['cancel', 'detach'])
          .describe(
            '"cancel" drops this date from the series. "detach" makes this date a separate one-off event described by title, startsAt and the other detail fields.',
          ),
        occurrenceStartsAt: isoDateTime.describe(
          'Start of the occurrence to change, as ISO 8601 datetime with offset, exactly as the series produces it: the event startsAt moved to that date by its recurrence rule, same time of day (Berlin time). For an all-day event send the date at T00:00:00Z.',
        ),
        title: eventTitle
          .optional()
          .describe('detach only, required: title of the new one-off event.'),
        startsAt: isoDateTime
          .optional()
          .describe(
            'detach only, required: start of the new one-off event as ISO 8601 datetime with offset, year 1900..2200. Send the same value as occurrenceStartsAt to keep the time.',
          ),
        endsAt: isoDateTime
          .nullable()
          .optional()
          .describe(
            'detach only: end of the new event, not before startsAt. Omit or null for none.',
          ),
        allDay: z
          .boolean()
          .optional()
          .describe('detach only: true for an all-day event. Defaults to false.'),
        location: eventLocation
          .nullable()
          .optional()
          .describe('detach only: place of the new event. Omit or null for none.'),
        description: eventDescription
          .nullable()
          .optional()
          .describe('detach only: details of the new event. Omit or null for none.'),
        expectedUpdatedAt: isoDateTime
          .optional()
          .describe(
            'detach only: the updatedAt value you last read from event_get. The change only applies if the series is unchanged since; otherwise 409 event_changed.',
          ),
      })
      .refine((input) => input.action !== 'detach' || (input.title && input.startsAt), {
        message: 'detach needs title and startsAt',
        path: ['title'],
      }),
    path: (input) => ['events', input.id, 'occurrence'],
    body: (input) => {
      const { id, ...body } = input;
      return input.action === 'cancel'
        ? { action: input.action, occurrenceStartsAt: input.occurrenceStartsAt }
        : body;
    },
  }),
  defineTool({
    name: 'absences_list',
    title: 'Read absences',
    description:
      'List the absences of flat members that are running or still ahead (an absence stays listed until its end date has passed, counted in Berlin time), ordered by start. Use it to see who is away; use events_list for flat calendar events, absence_create to record a new absence and absence_delete to remove one. Read-only, takes no parameters. Each entry has id, memberId, memberName, startDate, endDate (ISO 8601) and reason (text or null); the id is what absence_delete needs.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['absences'],
  }),
  defineTool({
    name: 'absence_create',
    title: 'Record an absence',
    description:
      'Record that a flat member is away for a date range, for example a holiday. Use it for a person being away; use event_create for a calendar entry that concerns the whole flat. Members can record their own absence; recording one for another member needs a flat admin, otherwise 403 not_owner. The memberId must belong to an active member of this flat. An endDate before startDate fails with date_range_invalid. An absence that overlaps another absence of the same member (by Berlin calendar day) fails with 409 absence_overlaps_existing. Returns the created absence with its id.',
    method: 'POST',
    input: z.strictObject({
      memberId: uuid.describe(
        'Id of the absent member, from members_list or wg_overview. Use your own member id unless you are a flat admin.',
      ),
      startDate: isoDateTime.describe(
        'First day of the absence as ISO 8601 datetime with offset, for example 2026-12-24T00:00:00+01:00. Only the Berlin calendar day counts.',
      ),
      endDate: isoDateTime.describe(
        'Last day of the absence, inclusive, as ISO 8601 datetime with offset, not before startDate. Only the Berlin calendar day counts.',
      ),
      reason,
    }),
    path: () => ['absences'],
    body: (input) => input,
  }),
  defineTool({
    name: 'absence_delete',
    title: 'Delete an absence',
    description:
      'Permanently remove one absence entry, for example when plans changed. There is no undo, but absence_create can record it again. Allowed for the absent member or a flat admin, otherwise 403 not_owner. An unknown id fails with 404 absence_not_found. Use absences_list to find the id.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the absence to delete, from absences_list or absence_create.'),
    }),
    path: (input) => ['absences', input.id],
  }),
];
