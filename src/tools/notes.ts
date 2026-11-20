import { z } from 'zod';
import { imageUrl, isoDateTime, uuid, withoutId } from './shared.js';
import { defineTool } from './types.js';

const noteContent = z.string().trim().min(1).max(2000);
const commentContent = z.string().trim().min(1).max(600);
const noteKind = z.enum(['info', 'question', 'problem', 'request', 'decision']);
const reaction = z.enum(['seen', 'take', 'ok']);

export const noteTools = [
  defineTool({
    name: 'notes_list',
    title: 'Read the noticeboard',
    description:
      'Lists the flat noticeboard: member-written posts, pinned first, then newest first (max 300). Each post carries kind, status, updatedAt, reactionCounts, myReactions, takers (members who reacted with take) and its comments. Finished posts (resolved, or info/decision) drop off the board 30 days after their last activity unless pinned; open questions, problems and requests stay. A post with source chore_swap is a swap request for a chore; chore_update with a new assignee or chore_complete closes it. Use this to find post ids and updatedAt for note_update; use note_comments to read the comments of one post by id.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['announcements'],
  }),
  defineTool({
    name: 'note_comments',
    title: 'Read the comments on a post',
    description:
      'Reads the comments of one noticeboard post, oldest first (max 500), each with id, memberId, content, createdAt, authorName and authorColor. Use it when you only need one post; notes_list already embeds comments for all posts. To add a comment instead of reading them, use note_comment. Returns 404 announcement_not_found for an unknown post id.',
    method: 'GET',
    input: z.strictObject({ id: uuid.describe('Id of the post, from notes_list.') }),
    path: (input) => ['announcements', input.id, 'comments'],
  }),
  defineTool({
    name: 'note_create',
    title: 'Write a post',
    description:
      'Posts a new message to the flat noticeboard as the signed-in member and sends a push notification to the other members. Use it for announcements, questions or requests to the whole flat; to ask for a chore to be taken over use chore_swap_request, to reply on an existing post use note_comment, and for the live conversation use chat_send. The answer holds the created announcement and a warning when the push delivery could not be confirmed. An imageUrl that is not an app-issued upload of this flat fails with image_invalid; an upload that was deleted fails with image_removed.',
    method: 'POST',
    input: z.strictObject({
      content: noteContent.describe('Text of the post, shown as written on the noticeboard.'),
      kind: noteKind
        .default('info')
        .describe(
          'Type of the post. info and decision are finished posts that fade from the board; question, problem and request stay on the board until resolved. Defaults to info.',
        ),
      imageUrl: imageUrl.describe(
        'Optional image attached to the post. Must be the URL of an image already uploaded to this flat through the ManaWG app; arbitrary URLs are rejected. Omit for a text-only post.',
      ),
    }),
    path: () => ['announcements'],
    body: (input) => input,
  }),
  defineTool({
    name: 'chore_swap_request',
    title: 'Ask the flat to take over a chore',
    description:
      'Posts a swap request for one chore to the flat noticeboard as the signed-in member and sends a push notification to the other members; it differs from note_create in that the post is tied to the chore. Use it when you cannot do a chore and want someone else to take it; for a general message use note_create. Only one open swap request exists per chore: if one is already open, nothing new is posted and the existing post is returned with duplicate true. The request closes automatically when the chore is reassigned with chore_update or completed with chore_complete, or by hand with note_update. An unknown choreId is not rejected: the post is then stored as an ordinary manual post. The answer holds the announcement and a warning when the push delivery could not be confirmed.',
    method: 'POST',
    input: z.strictObject({
      choreId: uuid.describe('Id of the chore to swap, from chores_list.'),
      content: noteContent.describe(
        'Text of the request, for example why you cannot do the chore. Shown as written on the noticeboard.',
      ),
      kind: noteKind
        .default('request')
        .describe(
          'Type of the post. Defaults to request, which stays on the board until resolved; info and decision fade from the board after 30 days.',
        ),
    }),
    path: () => ['announcements'],
    body: (input) => ({ source: 'chore_swap', ...input }),
  }),
  defineTool({
    name: 'note_update',
    title: 'Edit a post',
    description:
      'Edits an existing noticeboard post: resolve or reopen it, pin or unpin it, change its kind, or rewrite its text. Send only the fields you want to change. content, pinned and kind may only be changed by the post author or an admin (otherwise 403 not_owner); content only on manually written posts (otherwise 403 content_locked). status may only be changed by the author, an admin, or a member who has set a take reaction on the post (otherwise 403 status_change_not_allowed). Resolving a post pushes a notification to the author and the takers. Pass expectedUpdatedAt to guard against concurrent edits: if the post changed meanwhile the call fails with 409 announcement_changed, so read notes_list again before retrying. To remove a post use note_delete; to take it on use note_react.',
    method: 'PATCH',
    input: z
      .strictObject({
        id: uuid.describe('Id of the post to change, from notes_list.'),
        status: z
          .enum(['open', 'resolved'])
          .optional()
          .describe(
            'Set resolved to close the post or open to reopen it. Omit to leave unchanged.',
          ),
        pinned: z
          .boolean()
          .optional()
          .describe(
            'true pins the post to the top of the board, false unpins it. Omit to leave unchanged.',
          ),
        kind: noteKind.optional().describe('New type of the post. Omit to leave unchanged.'),
        content: noteContent
          .optional()
          .describe('New text, replacing the old text completely. Omit to leave unchanged.'),
        expectedUpdatedAt: isoDateTime
          .optional()
          .describe(
            'The updatedAt of this post as last read from notes_list (ISO 8601 with offset). If the post changed since, the update is rejected with announcement_changed. Omit to skip the check.',
          ),
      })
      .refine(
        (input) =>
          [input.status, input.pinned, input.kind, input.content].some(
            (field) => field !== undefined,
          ),
        {
          message: 'Send at least one of status, pinned, kind and content',
          path: ['status'],
        },
      ),
    path: (input) => ['announcements', input.id],
    body: withoutId,
  }),
  defineTool({
    name: 'note_delete',
    title: 'Delete a post',
    description:
      'Permanently deletes a noticeboard post together with its comments and reactions; this cannot be undone. Only the post author or an admin may do it (otherwise 403 not_owner), and nobody is notified. To close a post but keep it visible use note_update with status resolved instead; to remove only one comment use note_comment_delete.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({ id: uuid.describe('Id of the post to delete, from notes_list.') }),
    path: (input) => ['announcements', input.id],
  }),
  defineTool({
    name: 'note_comment',
    title: 'Add a comment to a post',
    description:
      'Adds a comment to an existing noticeboard post as the signed-in member and pushes a notification to the post author and the takers (not to you). Use it to reply on a post; to start a new topic use note_create, and for the live conversation use chat_send. The answer holds the created comment (with its id, authorName and authorColor) and a warning when the push delivery could not be confirmed. Returns 404 announcement_not_found for an unknown post.',
    method: 'POST',
    input: z.strictObject({
      id: uuid.describe('Id of the post to comment on, from notes_list.'),
      content: commentContent.describe('Text of the comment.'),
    }),
    path: (input) => ['announcements', input.id, 'comments'],
    body: (input) => ({ content: input.content }),
  }),
  defineTool({
    name: 'note_comment_update',
    title: 'Edit your own comment',
    description:
      'Replaces the text of one of your own comments on a noticeboard post; nobody is notified. Only the comment author may edit it, not even an admin (403 not_owner); an unknown comment returns 404 comment_not_found. To remove a comment use note_comment_delete; to add a new one use note_comment.',
    method: 'PATCH',
    input: z.strictObject({
      id: uuid.describe('Id of the post the comment belongs to, from notes_list.'),
      commentId: uuid.describe('Id of the comment to edit, from note_comments or notes_list.'),
      content: commentContent.describe('New text, replacing the old text completely.'),
    }),
    path: (input) => ['announcements', input.id, 'comments', input.commentId],
    body: (input) => ({ content: input.content }),
  }),
  defineTool({
    name: 'note_comment_delete',
    title: 'Delete a comment',
    description:
      'Permanently deletes one comment from a noticeboard post; this cannot be undone. The comment author may delete it, and so may an admin as moderation (otherwise 403 not_owner); nobody is notified. An unknown comment returns 404 comment_not_found. To delete the whole post use note_delete; to change the text instead use note_comment_update.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('Id of the post the comment belongs to, from notes_list.'),
      commentId: uuid.describe('Id of the comment to delete, from note_comments or notes_list.'),
    }),
    path: (input) => ['announcements', input.id, 'comments', input.commentId],
  }),
  defineTool({
    name: 'note_react',
    title: 'Set a reaction',
    description:
      'Sets or removes your own seen, ok or take reaction on one noticeboard post. seen means you read it, ok means you agree, take means you will handle it: it lets you resolve the post via note_update and makes you a taker, who is notified about new comments and when the post is resolved. Reaction kinds are independent, so you can hold several on one post. Use it to react, not to write text; use note_comment to reply. The call states the desired end state, so repeating it is safe and changes nothing. Reactions notify nobody. Any flat member may call it. Returns the reaction and active as stored. Setting take on an already resolved post fails with 409 announcement_resolved; reopen it first with note_update. Returns 404 announcement_not_found for an unknown post id.',
    method: 'POST',
    idempotent: true,
    input: z.strictObject({
      id: uuid.describe('Id of the post to react to, from notes_list.'),
      reaction: reaction.describe(
        'Which reaction kind to set or remove. Kinds are independent: setting one does not clear another.',
      ),
      active: z
        .boolean()
        .describe(
          'true sets your reaction, false removes it. Removing one you never set is a no-op.',
        ),
    }),
    path: (input) => ['announcements', input.id, 'reactions'],
    body: (input) => ({ reaction: input.reaction, active: input.active }),
  }),
];
