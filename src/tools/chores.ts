import { z } from 'zod';
import { defineTool, isoDateTime, uuid } from './finance.js';

const recurrenceTypes = z.string().trim().min(1).max(40);

export const choreTools = [
  defineTool({
    name: 'chores_list',
    title: 'Putzplan lesen',
    description:
      'Alle Aufgaben mit assignedMemberId, intervalDays/intervalMonths, nextDueAt, recurrenceType, lastCompletedAt.',
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
      'title 1..120, nextDueAt ISO erforderlich, intervalDays 1..365 oder intervalMonths bis 60, assignedMemberId optional (muss Mitglied sein).',
    method: 'POST',
    input: z.strictObject({
      title: z.string().trim().min(1).max(120),
      nextDueAt: isoDateTime,
      assignedMemberId: uuid.optional(),
      intervalDays: z.number().int().min(1).max(365).optional(),
      intervalMonths: z.number().int().min(1).max(60).optional(),
      recurrenceType: recurrenceTypes.optional(),
    }),
    path: () => ['chores'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chore_update',
    title: 'Putzaufgabe bearbeiten',
    description:
      'Nur Ersteller oder Admin (not_owner). assignedMemberId null entziegt die Zuweisung; nextDueAt/intervalDays/recurrenceType verschieben den Turnus.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      assignedMemberId: uuid.nullable().optional(),
      nextDueAt: isoDateTime.optional(),
      intervalDays: z.number().int().min(1).max(365).optional(),
      recurrenceType: recurrenceTypes.optional(),
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
      'Vorher chores_list lesen; nextDueAt als expectedNextDueAt und assignedMemberId (UUID oder null) als expectedAssignedMemberId exakt mitsenden. 409 chore_occurrence_changed: neu lesen und erneut entscheiden, nicht blind wiederholen.',
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
    description: 'Entfernt die Aufgabe und ihren Verlauf endgültig — nur bei fehlerhaften Anlagen.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chores', input.id],
  }),
];
