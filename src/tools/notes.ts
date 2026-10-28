import { z } from 'zod';
import { imageUrl, uuid } from './shared.js';
import { defineTool } from './types.js';

const content = z.string().trim().min(1).max(2000);
const commentContent = z.string().trim().min(1).max(600);
const noteKind = z.enum(['info', 'question', 'problem', 'request', 'decision']);
const reaction = z.enum(['seen', 'take', 'ok']);

export const noteTools = [
  defineTool({
    name: 'notes_list',
    title: 'Pinnwand lesen',
    description:
      'Ankündigungen mit reactionCounts, myReactions, takers, comments (pinned zuerst). status open|resolved, kind info|question|problem|request|decision.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['announcements'],
  }),
  defineTool({
    name: 'note_comments',
    title: 'Kommentare einer Ankündigung lesen',
    description:
      'Alle Kommentare einer Ankündigung (max 500) in chronologischer Reihenfolge mit authorName, authorColor und createdAt. 404 announcement_not_found bei unbekannter id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['announcements', input.id, 'comments'],
  }),
  defineTool({
    name: 'note_create',
    title: 'Ankündigung verfassen',
    description:
      'content 1..2000, kind default info. imageUrl muss eine von der App ausgestellte Upload-URL sein (sonst image_invalid; gelöschte Uploads image_removed). Antwort enthält warning falls die Push-Benachrichtigung nicht bestätigt werden konnte.',
    method: 'POST',
    input: z.strictObject({
      content,
      kind: noteKind.default('info'),
      imageUrl,
    }),
    path: () => ['announcements'],
    body: (input) => input,
  }),
  defineTool({
    name: 'note_update',
    title: 'Ankündigung ändern',
    description:
      'pinned oder kind nur durch Autor oder Admin (not_owner). status open|resolved nur durch den Autor oder Mitglieder mit eigener take-Reaktion — auch ein Admin ohne take bekommt status_change_not_allowed.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      status: z.enum(['open', 'resolved']).optional(),
      pinned: z.boolean().optional(),
      kind: noteKind.optional(),
    }),
    path: (input) => ['announcements', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'note_delete',
    title: 'Ankündigung löschen',
    description: 'Löscht die Ankündigung inklusive Kommentaren. Erlaubt für Autor oder Admin.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['announcements', input.id],
  }),
  defineTool({
    name: 'note_comment',
    title: 'Kommentar schreiben',
    description:
      'Kommentar zu einer Ankündigung, content 1..600. Antwort: comment (inkl. authorName, authorColor) und warning.',
    method: 'POST',
    input: z.strictObject({ id: uuid, content: commentContent }),
    path: (input) => ['announcements', input.id, 'comments'],
    body: (input) => ({ content: input.content }),
  }),
  defineTool({
    name: 'note_comment_update',
    title: 'Eigenen Kommentar bearbeiten',
    description: 'Nur der Autor des Kommentars (not_owner), content weiterhin 1..600.',
    method: 'PATCH',
    input: z.strictObject({ id: uuid, commentId: uuid, content: commentContent }),
    path: (input) => ['announcements', input.id, 'comments', input.commentId],
    body: (input) => ({ content: input.content }),
  }),
  defineTool({
    name: 'note_comment_delete',
    title: 'Eigenen Kommentar löschen',
    description: 'Entfernt den Kommentar endgültig; nur dessen Autor darf das.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid, commentId: uuid }),
    path: (input) => ['announcements', input.id, 'comments', input.commentId],
  }),
  defineTool({
    name: 'note_react',
    title: 'Reaktion setzen',
    description:
      'Reaktion seen|take|ok auf eine Ankündigung. active true setzt, false entfernt; eine Wiederholung ändert nichts. take auf resolved ist nicht erlaubt (reaction_invalid).',
    method: 'POST',
    input: z.strictObject({
      id: uuid,
      reaction,
      active: z.boolean(),
    }),
    path: (input) => ['announcements', input.id, 'reactions'],
    body: (input) => ({ reaction: input.reaction, active: input.active }),
  }),
];
