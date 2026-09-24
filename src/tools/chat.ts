import { z } from 'zod';
import { defineTool, imageUrl, uuid } from './finance.js';

const body = z.string().trim().min(1).max(4000);

export const chatTools = [
  defineTool({
    name: 'chat_messages',
    title: 'Chatverlauf lesen',
    description:
      'Nachrichtenseite, standardmäßig die neuesten. Cursor: before (ISO) und beforeId (uuid) gemeinsam senden (before_cursor_incomplete sonst), limit 1..100. Enthält messages, reactions, mentions.',
    method: 'GET',
    input: z.strictObject({
      before: z.iso.datetime({ offset: true }).optional(),
      beforeId: uuid.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    path: () => ['chat', 'messages'],
    query: (input) => ({ before: input.before, beforeId: input.beforeId, limit: input.limit }),
  }),
  defineTool({
    name: 'chat_send',
    title: 'Chatnachricht senden',
    description:
      'Schreibt in den WG-Chat als eingeloggtes Mitglied. body bis 4000 Zeichen oder imageUrl; beides leer ist nicht erlaubt (empty_message). replyToMessageId und mentionMemberIds (uuid[]) optional.',
    method: 'POST',
    input: z.strictObject({
      body: body.optional(),
      imageUrl,
      replyToMessageId: uuid.optional(),
      mentionMemberIds: z.array(uuid).max(50).optional(),
    }),
    path: () => ['chat', 'messages'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chat_edit',
    title: 'Chatnachricht bearbeiten',
    description:
      'Nur eigene Nachrichten (not_owner) und nur innerhalb von 15 Minuten nach Versand (edit window).',
    method: 'PATCH',
    input: z.strictObject({ id: uuid, body }),
    path: (input) => ['chat', 'messages', input.id],
    body: (input) => ({ body: input.body }),
  }),
  defineTool({
    name: 'chat_react',
    title: 'Chatreaktion setzen',
    description:
      'Emoji-Reaktion an-/abwählen (toggle). Auf gelöschte Nachrichten: 409 message_deleted.',
    method: 'POST',
    input: z.strictObject({ id: uuid, emoji: z.string().trim().min(1).max(16) }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    body: (input) => ({ emoji: input.emoji }),
  }),
  defineTool({
    name: 'chat_mark_read',
    title: 'Chat als gelesen markieren',
    description:
      'Setzt den Lesezeiger auf lastReadMessageId (uuid oder null für zurücksetzen). Nur monoton fortschreitend — der Marker rückt nie rückwärts.',
    method: 'POST',
    input: z.strictObject({ lastReadMessageId: uuid.nullable().optional() }),
    path: () => ['chat', 'read'],
    body: (input) => ({ lastReadMessageId: input.lastReadMessageId ?? null }),
  }),
  defineTool({
    name: 'chat_unread',
    title: 'Ungelesene Nachrichten zählen',
    description: 'Anzahl ungelesener Nachrichten bis max. 99 plus overflow (true ab 100).',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['chat', 'unread-count'],
  }),
  defineTool({
    name: 'chat_delete',
    title: 'Chatnachricht löschen',
    description:
      'Entfernt die Nachricht für alle; Text und Bild werden aus der Anzeige gestript. Erlaubt für Autor (geprüfte Identität).',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chat', 'messages', input.id],
  }),
];
