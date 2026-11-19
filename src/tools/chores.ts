import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const recurrenceType = z.enum(['days', 'months']);

export const choreTools = [
  defineTool({
    name: 'chores_list',
    title: 'Read the cleaning rota',
    description:
      'List every recurring chore of the flat, soonest nextDueAt first. Each chore carries assignedMemberId, intervalDays, recurrenceType, nextDueAt, lastCompletedAt and lastCompletedByName; the response also has monthCompletions (completions this month per member id). Use this to see who is due and as the required read before chore_complete, which needs nextDueAt and assignedMemberId from here. For a single chore use chore_get. Read-only, no pagination.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['chores'],
  }),
  defineTool({
    name: 'chore_get',
    title: 'Read one chore',
    description:
      'Fetch a single chore by id with its schedule (title, intervalDays, recurrenceType, nextDueAt, assignedMemberId). Use when you already know the id; use chores_list to find ids, see all chores, or read last completion data, which this tool does not include. Returns chore_not_found if the id is not a chore of this flat.',
    method: 'GET',
    input: z.strictObject({
      id: uuid.describe('Id of the chore, from chores_list.'),
    }),
    path: (input) => ['chores', input.id],
  }),
  defineTool({
    name: 'chore_create',
    title: 'Create a chore',
    description:
      'Create a new recurring chore in the flat. Use for a task that repeats on a fixed rhythm; to mark an existing chore as done use chore_complete, and to change an existing chore use chore_update. If nextDueAt is omitted the first due date is one interval from now. A chore assigned to another member that is due within 24 hours sends that member a push notification; self-assignment does not. An assignee who is not an active member fails with member_not_in_wg. Returns the created chore.',
    method: 'POST',
    input: z.strictObject({
      title: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe('Short name of the chore, e.g. "Bathroom".'),
      nextDueAt: isoDateTime
        .optional()
        .describe(
          'First due date as ISO 8601 with offset, e.g. 2026-12-01T18:00:00+01:00. Defaults to one interval from now.',
        ),
      assignedMemberId: uuid
        .nullable()
        .optional()
        .describe(
          'Id of the member who does the first round, from members_list. Omit or null for no assignee.',
        ),
      intervalDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe(
          'Repeat interval. Counts days, or months when recurrenceType is months (then at most 60). Defaults to 7.',
        ),
      recurrenceType: recurrenceType
        .optional()
        .describe(
          'Unit of intervalDays: days (default) or months. Months keep the same day of the month.',
        ),
    }),
    path: () => ['chores'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chore_update',
    title: 'Edit a chore',
    description:
      'Change the assignee, next due date or rhythm of an existing chore; send only the fields to change. Use this to reassign or reschedule. To record that the chore was done use chore_complete, which also rotates the assignee. The title cannot be changed with this tool. Any member may edit. Handing a chore due within 24 hours to another member sends that member a push notification. Returns chore_not_found for an unknown id, member_not_in_wg for an assignee who is not an active member and chore_changed if the schedule was changed by someone else in the meantime: read the chore again and retry. Returns the updated chore.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid.describe('Id of the chore, from chores_list.'),
      assignedMemberId: uuid
        .nullable()
        .optional()
        .describe(
          'Id of the new assignee, from members_list. Null removes the assignment; omit to keep it.',
        ),
      nextDueAt: isoDateTime
        .optional()
        .describe('New due date as ISO 8601 with offset. Omit to keep the current one.'),
      intervalDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe(
          'New repeat interval in days, or in months when the recurrenceType is months (then at most 60).',
        ),
      recurrenceType: recurrenceType
        .optional()
        .describe('New unit of intervalDays: days or months. Omit to keep the current one.'),
    }),
    path: (input) => ['chores', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'chore_complete',
    title: 'Complete a chore',
    description:
      "Mark the current round of a chore as done by the calling member. The app schedules the next due date from the cadence, moves the chore to the next available member in the rotation (skipping absent members), and closes an open swap request for it. Call chores_list first and pass the chore's current nextDueAt and assignedMemberId as the expected values so a stale or double completion is rejected. Returns chore_occurrence_changed if the chore moved on since you read it: read again and decide again, do not retry blindly. Returns chore_already_completed if this round was just completed. Not for editing a chore: use chore_update.",
    method: 'POST',
    input: z.strictObject({
      id: uuid.describe('Id of the chore, from chores_list.'),
      expectedNextDueAt: isoDateTime.describe(
        "The chore's nextDueAt exactly as returned by chores_list. Identifies the round being completed.",
      ),
      expectedAssignedMemberId: uuid
        .nullable()
        .describe(
          "The chore's assignedMemberId exactly as returned by chores_list, or null if it has no assignee.",
        ),
    }),
    path: (input) => ['chores', input.id, 'complete'],
    body: (input) => ({
      expectedNextDueAt: input.expectedNextDueAt,
      expectedAssignedMemberId: input.expectedAssignedMemberId,
    }),
  }),
  defineTool({
    name: 'chore_delete',
    title: 'Delete a chore',
    description:
      'Permanently delete a chore from the flat, including its completion history; this cannot be undone. Use only for a chore created by mistake or that no longer applies. To just reschedule or reassign use chore_update, and to record a finished round use chore_complete. Only a flat admin may delete (admin_required for other members). Returns chore_not_found for an unknown id. Only available when destructive tools are enabled.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the chore to delete, from chores_list.'),
    }),
    path: (input) => ['chores', input.id],
  }),
];
