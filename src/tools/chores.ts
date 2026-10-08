import { z } from 'zod';
import { isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const recurrenceType = z.enum(['days', 'months']);

export const choreTools = [
  defineTool({
    name: 'chores_list',
    title: 'Putzplan lesen',
    description:
      'Alle Aufgaben mit assignedMemberId, intervalDays, recurrenceType (days|months), nextDueAt, lastCompletedAt.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['chores'],
  }),
  defineTool({
    name: 'chore_get',
    title: 'Putzaufgabe einzeln lesen',
    description: 'Eine Aufgabe im Detail; 404 chore_not_found bei unbekannter id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chores', input.id],
  }),
  defineTool({
    name: 'chore_create',
    title: 'Putzaufgabe anlegen',
    description:
      'title 1..120, intervalDays (default 7) 1..365 Tage; mit recurrenceType months ist intervalDays die Anzahl Monate (1..60). nextDueAt ISO optional, assignedMemberId optional (muss Mitglied sein).',
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
    title: 'Putzaufgabe bearbeiten',
    description:
      'Jedes Mitglied darf bearbeiten. assignedMemberId null entzieht die Zuweisung; nextDueAt/intervalDays/recurrenceType verschieben den Turnus (bei months ist intervalDays die Monatszahl). 409 chore_changed bei gleichzeitiger Änderung des Turnus: neu lesen.',
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
    title: 'Putzaufgabe erledigen',
    description:
      'Vorher chores_list lesen; nextDueAt als expectedNextDueAt und assignedMemberId (UUID oder null) als expectedAssignedMemberId exakt mitsenden. 409 chore_occurrence_changed: neu lesen und erneut entscheiden, nicht blind wiederholen; chore_already_completed: der Durchlauf ist schon erledigt.',
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
    title: 'Putzaufgabe löschen',
    description:
      'Entfernt die Aufgabe und ihren Verlauf endgültig — nur bei fehlerhaften Anlagen. Nur Admin (admin_required).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chores', input.id],
  }),
];
