import { z } from 'zod';
import { imageUrl, uuid } from './shared.js';
import { defineTool } from './types.js';

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
      'Schreibt in den WG-Chat als eingeloggtes Mitglied. body bis 4000 Zeichen oder imageUrl; beides leer ist nicht erlaubt (empty_message). replyToMessageId und mentionMemberIds (uuid[], max 20) optional. imageUrl muss eine von der App ausgestellte Upload-URL sein (sonst image_invalid; gelöschte Uploads image_removed).',
    method: 'POST',
    input: z.strictObject({
      body: body.optional(),
      imageUrl,
      replyToMessageId: uuid.optional(),
      mentionMemberIds: z.array(uuid).max(20).optional(),
    }),
    path: () => ['chat', 'messages'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chat_edit',
    title: 'Chatnachricht bearbeiten',
    description:
      'Nur eigene Textnachrichten und nur innerhalb von 15 Minuten nach Versand (edit window); sonst 403 edit_not_allowed. Unbekannte Nachricht: message_not_found.',
    method: 'PATCH',
    input: z.strictObject({ id: uuid, body }),
    path: (input) => ['chat', 'messages', input.id],
    body: (input) => ({ body: input.body }),
  }),
  defineTool({
    name: 'chat_react',
    title: 'Chatreaktion setzen',
    description:
      'Fügt eine Emoji-Reaktion hinzu (genau ein Emoji, sonst emoji_invalid); ist sie schon gesetzt, bleibt es dabei. Entfernen mit chat_unreact. Auf gelöschte Nachrichten: 409 message_deleted.',
    method: 'POST',
    input: z.strictObject({ id: uuid, emoji: z.string().trim().min(1).max(16) }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    body: (input) => ({ emoji: input.emoji }),
  }),
  defineTool({
    name: 'chat_unreact',
    title: 'Chatreaktion entfernen',
    description:
      'Nimmt die eigene Emoji-Reaktion von einer Nachricht zurück (dasselbe Emoji wie bei chat_react). Auf gelöschte Nachrichten: 409 message_deleted.',
    method: 'DELETE',
    input: z.strictObject({ id: uuid, emoji: z.string().trim().min(1).max(16) }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    query: (input) => ({ emoji: input.emoji }),
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
      'Entfernt die Nachricht für alle; Text und Bild werden aus der Anzeige gestript. Erlaubt für den Autor oder einen Admin; erneutes Löschen ist harmlos.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chat', 'messages', input.id],
  }),
];
