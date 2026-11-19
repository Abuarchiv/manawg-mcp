import { z } from 'zod';
import { uuid } from './shared.js';
import { defineTool } from './types.js';

const body = z.string().trim().min(1).max(4000);

export const chatTools = [
  defineTool({
    name: 'chat_messages',
    title: 'Read the chat',
    description:
      "Reads one page of the flat chat, newest messages by default, in chronological order. Use it to catch up or to find a message id for chat_edit, chat_react, chat_delete or chat_mark_read; it does not change the read marker (use chat_mark_read) and does not count unread messages (use chat_unread). To page back, send beforeId of the oldest message you have; a malformed id gives before_id_invalid. The result holds messages, their reactions and mentions, and each member's read position; deleted messages show no text.",
    method: 'GET',
    input: z.strictObject({
      beforeId: uuid
        .optional()
        .describe(
          'Cursor: id of the oldest message you already have, from a previous chat_messages result; the page then holds the messages sent before it. Omit for the newest page.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum number of messages in the page. Omit for the default page size.'),
    }),
    path: () => ['chat', 'messages'],
    query: (input) => ({ beforeId: input.beforeId, limit: input.limit }),
  }),
  defineTool({
    name: 'chat_send',
    title: 'Send a chat message',
    description:
      'Posts a new text message to the flat chat as the signed-in member; use chat_edit to change a message you already sent. Notifies the other members, and anyone mentioned gets a separate mention notification, so confirm the wording with the user first. Text only, no images; a blank body gives empty_message. A reply target that is missing or deleted gives reply_to_not_found. Each call creates a new message, so do not retry blindly. The result returns the created message and the mentioned member ids.',
    method: 'POST',
    input: z.strictObject({
      body: body.describe(
        'Message text, trimmed, up to 4000 characters. Write "@Name" with the exact member name to mention someone.',
      ),
      replyToMessageId: uuid
        .optional()
        .describe(
          'Id of an existing, not deleted message in this flat to reply to, from chat_messages.',
        ),
      mentionMemberIds: z
        .array(uuid)
        .max(20)
        .optional()
        .describe(
          'Member ids to mention, from members_list. A member is only mentioned if body also contains their "@Name"; you cannot mention yourself.',
        ),
    }),
    path: () => ['chat', 'messages'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chat_edit',
    title: 'Edit a chat message',
    description:
      "Replaces the text of a message you sent yourself, within 15 minutes of sending; the message is then marked as edited and its mentions are recalculated from the new text. Other members' messages, deleted messages and older messages give 403 edit_not_allowed, an unknown id gives message_not_found, and a message deleted in the meantime gives 409 message_deleted. To post a new message use chat_send, to remove one use chat_delete. Returns the updated message.",
    method: 'PATCH',
    input: z.strictObject({
      id: uuid.describe('Id of your own message to edit, from chat_messages or chat_send.'),
      body: body.describe(
        'New message text that fully replaces the old one, trimmed, up to 4000 characters.',
      ),
    }),
    path: (input) => ['chat', 'messages', input.id],
    body: (input) => ({ body: input.body }),
  }),
  defineTool({
    name: 'chat_react',
    title: 'Add a chat reaction',
    description:
      'Adds your emoji reaction to any message in the flat chat; you can add several different emojis to one message. Each member holds a given emoji at most once per message, so an emoji you already set stays as it is. Does not change or post message text. Returns ok. Only a single emoji (one pictograph, flag or keycap, with skin-tone or joiner sequences counting as one) is accepted, otherwise emoji_invalid; an unknown message gives message_not_found and a deleted one 409 message_deleted. To take a reaction back use chat_unreact; to write a message use chat_send.',
    method: 'POST',
    input: z.strictObject({
      id: uuid.describe('Id of the message to react to, from chat_messages.'),
      emoji: z
        .string()
        .trim()
        .min(1)
        .max(16)
        .describe(
          'The reaction: one emoji, sent as the emoji character itself, not a name or shortcode like :thumbsup:. Pass the same string to chat_unreact to remove it.',
        ),
    }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    body: (input) => ({ emoji: input.emoji }),
  }),
  defineTool({
    name: 'chat_unreact',
    title: 'Remove a chat reaction',
    description:
      "Removes your own emoji reaction from a message; other members' reactions stay. Removing a reaction you never set changes nothing, so repeating the call is safe. An unknown message gives message_not_found and a deleted one 409 message_deleted. To add a reaction use chat_react.",
    method: 'DELETE',
    input: z.strictObject({
      id: uuid.describe('Id of the message the reaction is on, from chat_messages.'),
      emoji: z
        .string()
        .trim()
        .min(1)
        .max(16)
        .describe('The emoji of your reaction to remove, exactly as it was added with chat_react.'),
    }),
    path: (input) => ['chat', 'messages', input.id, 'reactions'],
    query: (input) => ({ emoji: input.emoji }),
  }),
  defineTool({
    name: 'chat_mark_read',
    title: 'Mark the chat as read',
    description:
      'Records that the signed-in member has read the chat up to a message, which lowers the chat_unread count and updates the read position other members see in chat_messages. The marker only moves forward: an older message id is ignored, and the response says whether the marker moved. An id that is not in this flat gives message_not_found. Use this after reading with chat_messages; it does not read or send anything.',
    method: 'POST',
    input: z.strictObject({
      lastReadMessageId: uuid
        .nullable()
        .optional()
        .describe(
          'Id of the newest message the member has read, from chat_messages. Send null or omit it to reset the marker.',
        ),
    }),
    path: () => ['chat', 'read'],
    body: (input) => ({ lastReadMessageId: input.lastReadMessageId ?? null }),
  }),
  defineTool({
    name: 'chat_unread',
    title: 'Count unread messages',
    description:
      'Counts the chat messages the signed-in member has not read yet, without returning them or changing anything. Returns count (capped at 99), exactCount and overflow (true from 100 unread). Use it for a cheap check before chat_messages; clear the count with chat_mark_read.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['chat', 'unread-count'],
  }),
  defineTool({
    name: 'chat_delete',
    title: 'Delete a chat message',
    description:
      'Permanently deletes a chat message for everyone: its text is erased and cannot be restored. Only the author or a flat admin may delete, anyone else gets 403 not_owner; an unknown id gives message_not_found. Returns deleted: true; the deletion is recorded in the audit log, and an attached image is queued for removal unless the flat still uses it elsewhere. To correct a typo use chat_edit instead. Only available when destructive tools are enabled on the server.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe(
        'Id of the message to delete, from chat_messages. Must be your own unless you are an admin.',
      ),
    }),
    path: (input) => ['chat', 'messages', input.id],
  }),
];
