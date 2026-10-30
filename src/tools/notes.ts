import { z } from 'zod';
import { imageUrl, isoDateTime, uuid } from './shared.js';
import { defineTool } from './types.js';

const content = z.string().trim().min(1).max(2000);
const commentContent = z.string().trim().min(1).max(600);
const noteKind = z.enum(['info', 'question', 'problem', 'request', 'decision']);
const reaction = z.enum(['seen', 'take', 'ok']);

export const noteTools = [
  defineTool({
    name: 'notes_list',
    title: 'Read the noticeboard',
    description:
      'Posts with reactionCounts, myReactions, takers and comments (pinned first). status open|resolved, kind info|question|problem|request|decision.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['announcements'],
  }),
  defineTool({
    name: 'note_comments',
    title: 'Read the comments on a post',
    description:
      'All comments on a post (max 500), oldest first, with authorName, authorColor and createdAt. 404 announcement_not_found for an unknown id.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['announcements', input.id, 'comments'],
  }),
  defineTool({
    name: 'note_create',
    title: 'Write a post',
    description:
      'content 1..2000, kind default info. imageUrl must be an upload URL issued by the app (otherwise image_invalid; deleted uploads give image_removed). The answer carries warning when the push notification could not be confirmed.',
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
    title: 'Change a post',
    description:
      'content (1..2000, manual posts only, otherwise content_locked), pinned or kind only by the author or an admin (not_owner). status open|resolved only by the author or members with their own take reaction; an admin without take also gets status_change_not_allowed. expectedUpdatedAt (updatedAt from notes_list) guards against concurrent edits: 409 announcement_changed means read again and decide.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid,
      status: z.enum(['open', 'resolved']).optional(),
      pinned: z.boolean().optional(),
      kind: noteKind.optional(),
      content: content.optional(),
      expectedUpdatedAt: isoDateTime.optional(),
    }),
    path: (input) => ['announcements', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'note_delete',
    title: 'Delete a post',
    description: 'Deletes the post with its comments. Allowed for the author or an admin.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['announcements', input.id],
  }),
  defineTool({
    name: 'note_comment',
    title: 'Write a comment',
    description:
      'Comment on a post, content 1..600. Answer: comment (with authorName, authorColor) and warning.',
    method: 'POST',
    input: z.strictObject({ id: uuid, content: commentContent }),
    path: (input) => ['announcements', input.id, 'comments'],
    body: (input) => ({ content: input.content }),
  }),
  defineTool({
    name: 'note_comment_update',
    title: 'Edit your own comment',
    description: 'Only the author of the comment (not_owner), content still 1..600.',
    method: 'PATCH',
    input: z.strictObject({ id: uuid, commentId: uuid, content: commentContent }),
    path: (input) => ['announcements', input.id, 'comments', input.commentId],
    body: (input) => ({ content: input.content }),
  }),
  defineTool({
    name: 'note_comment_delete',
    title: 'Delete your own comment',
    description: 'Removes the comment for good; only its author may do this.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid, commentId: uuid }),
    path: (input) => ['announcements', input.id, 'comments', input.commentId],
  }),
  defineTool({
    name: 'note_react',
    title: 'Set a reaction',
    description:
      'Reaction seen|take|ok on a post. active true sets it, false removes it; repeating it changes nothing. take on a resolved post is not allowed (reaction_invalid).',
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
