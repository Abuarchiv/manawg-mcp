import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const recurrenceType = z.enum(['days', 'months']);

export const choreTools = [
  defineTool({
    name: 'chores_list',
    title: 'Read the cleaning rota',
    description:
      'All chores with assignedMemberId, intervalDays, recurrenceType (days|months), nextDueAt and lastCompletedAt.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['chores'],
  }),
  defineTool({
    name: 'chore_get',
    title: 'Read one chore',
    description: 'One chore in detail; 404 chore_not_found for an unknown id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chores', input.id],
  }),
  defineTool({
    name: 'chore_create',
    title: 'Create a chore',
    description:
      'title 1..120, intervalDays (default 7) 1..365 days; with recurrenceType months, intervalDays is the number of months (1..60). nextDueAt ISO optional, assignedMemberId optional (must be a member).',
    method: 'POST',
    input: z.strictObject({
      title: z.string().trim().min(1).max(120),
      nextDueAt: isoDateTime.optional(),
      assignedMemberId: uuid.nullable().optional(),
      intervalDays: z.number().int().min(1).max(365).optional(),
      recurrenceType: recurrenceType.optional(),
    }),
    path: () => ['chores'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chore_update',
    title: 'Edit a chore',
    description:
      'Any member may edit. assignedMemberId null removes the assignment; nextDueAt/intervalDays/recurrenceType move the cycle (with months, intervalDays is the number of months). 409 chore_changed when the cycle changed at the same time: read again.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      assignedMemberId: uuid.nullable().optional(),
      nextDueAt: isoDateTime.optional(),
      intervalDays: z.number().int().min(1).max(365).optional(),
      recurrenceType: recurrenceType.optional(),
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
      'Read chores_list first; send nextDueAt as expectedNextDueAt and assignedMemberId (UUID or null) as expectedAssignedMemberId exactly. 409 chore_occurrence_changed: read again and decide again, do not retry blindly; chore_already_completed: this round is already done.',
    method: 'POST',
    input: z.strictObject({
      id: uuid,
      expectedNextDueAt: isoDateTime,
      expectedAssignedMemberId: uuid.nullable(),
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
      'Removes the chore and its history for good; only for chores created by mistake. Admins only (admin_required).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chores', input.id],
  }),
];
