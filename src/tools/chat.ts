import { z } from 'zod';
import { imageUrl, uuid } from './shared.js';
import { defineTool } from './types.js';

const body = z.string().trim().min(1).max(4000);

export const chatTools = [
  defineTool({
    name: 'chat_messages',
    title: 'Read the chat',
    description:
      'A page of messages, the newest by default. Cursor: send before (ISO) and beforeId (uuid) together (otherwise before_cursor_incomplete), limit 1..100. Contains messages, reactions and mentions.',
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
    title: 'Send a chat message',
    description:
      'Writes to the flat chat as the signed-in member. body up to 4000 characters or imageUrl; both empty is not allowed (empty_message). replyToMessageId and mentionMemberIds (uuid[], max 20) are optional. imageUrl must be an upload URL issued by the app (otherwise image_invalid; deleted uploads give image_removed).',
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
    title: 'Edit a chat message',
    description:
      'Only your own text messages and only within 15 minutes of sending (edit window); otherwise 403 edit_not_allowed. Unknown message: message_not_found.',
    method: 'PATCH',
    input: z.strictObject({ id: uuid, body }),
    path: (input) => ['chat', 'messages', input.id],
    body: (input) => ({ body: input.body }),
  }),
  defineTool({
    name: 'chat_react',
    title: 'Add a chat reaction',
    description:
      'Adds an emoji reaction (exactly one emoji, otherwise emoji_invalid); if it is already set, nothing changes. Remove it with chat_unreact. On deleted messages: 409 message_deleted.',
    method: 'POST',
    input: z.strictObject({ id: uuid, emoji: z.string().trim().min(1).max(16) }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    body: (input) => ({ emoji: input.emoji }),
  }),
  defineTool({
    name: 'chat_unreact',
    title: 'Remove a chat reaction',
    description:
      'Takes your own emoji reaction off a message (the same emoji as in chat_react). On deleted messages: 409 message_deleted.',
    method: 'DELETE',
    input: z.strictObject({ id: uuid, emoji: z.string().trim().min(1).max(16) }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    query: (input) => ({ emoji: input.emoji }),
  }),
  defineTool({
    name: 'chat_mark_read',
    title: 'Mark the chat as read',
    description:
      'Sets the read marker to lastReadMessageId (uuid, or null to reset). It only moves forward, never back.',
    method: 'POST',
    input: z.strictObject({ lastReadMessageId: uuid.nullable().optional() }),
    path: () => ['chat', 'read'],
    body: (input) => ({ lastReadMessageId: input.lastReadMessageId ?? null }),
  }),
  defineTool({
    name: 'chat_unread',
    title: 'Count unread messages',
    description: 'Number of unread messages up to 99, plus overflow (true from 100).',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['chat', 'unread-count'],
  }),
  defineTool({
    name: 'chat_delete',
    title: 'Delete a chat message',
    description:
      'Removes the message for everyone; its text and image are no longer shown. Allowed for the author or an admin; deleting again is harmless.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['chat', 'messages', input.id],
  }),
];
