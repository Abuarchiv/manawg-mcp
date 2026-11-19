import { z } from 'zod';
import { defineTool } from './types.js';

const importSource = z.enum(['splitwise_csv', 'splid_csv', 'ocr_text']);

export const householdTools = [
  defineTool({
    name: 'calendar_subscription_get',
    title: 'Read the calendar subscription',
    description:
      "Read the caller's own calendar feed subscription for the flat. Returns subscription { feedUrl, createdAt, updatedAt }, or subscription null when no feed is active. Use it to give the user a URL to add to a calendar app; to list the events themselves use events_list. This tool only reads: creating, rotating or revoking the feed is done in the ManaWG app. feedUrl contains a secret token that grants read access to the flat's events, so show it only to the user and never paste it into shared chats or logs.",
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'import_preview',
    title: 'Preview an import',
    description:
      'Dry-run parse of expense data exported from another app (Splitwise or Splid CSV) or pasted receipt text, without writing anything. Call this first, then import_commit with the same source and payload. Returns parsed (expense rows), payloadHash, memberMapping (file name to member id or null), conflicts (names still unmapped), members (active members of the flat), rejected (rows that could not be parsed) and fuzzyNames (names matched only approximately; check them). Names are matched to members automatically, and any entry you pass in memberMapping overrides that match. Rate limit: 10 previews per hour per member.',
    method: 'POST',
    input: z.strictObject({
      source: importSource.describe(
        'Format of payload: splitwise_csv (Splitwise export), splid_csv (Splid export) or ocr_text (text read from a receipt or screenshot).',
      ),
      payload: z
        .string()
        .min(1)
        .describe(
          'The complete file or text content as one string, unmodified (max 5 MiB for CSV, 1 MiB for ocr_text, 2000 rows). Pass the identical string to import_commit.',
        ),
      memberMapping: z
        .record(z.string(), z.string().nullable())
        .optional()
        .describe(
          'Optional overrides that map a name exactly as written in the file to a member id from members_list, or null for no member. Omit it to rely on automatic name matching, then repeat the call with corrections for entries in conflicts or fuzzyNames.',
        ),
    }),
    path: () => ['imports', 'preview'],
    body: (input) => input,
    readOnly: true,
  }),
  defineTool({
    name: 'import_commit',
    title: 'Commit an import',
    description:
      'Create the expenses from an import for real, after the user has reviewed import_preview. Use import_preview first and pass the same source, payload and the final memberMapping; do not use this to add a single expense (use expense_create). This tool has no bulk undo: created expenses can be removed one by one with expense_delete. Other members get one notification when at least one expense was created. Returns importId, inserted, skipped, errors ({ index, reason } per row that was not created, such as payer_unmapped or paid_by_must_include_caller) and warning (null or a notification delivery problem). Non-admins can only import rows they paid or share in. Fails with mapping_incomplete (plus conflicts) if a name is unmapped, payload_changed if previewPayloadHash does not match payload, preview_hash_required if skipIndexes is set without previewPayloadHash. Rate limit: 3 commits per hour per member.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({
      source: importSource.describe('Same value as in the import_preview call.'),
      payload: z
        .string()
        .min(1)
        .describe('Same unmodified string as in the import_preview call; it is parsed again.'),
      memberMapping: z
        .record(z.string(), z.uuid().nullable())
        .describe(
          'Complete mapping from every name in the file to a member id from members_list or import_preview members, or null for rows to leave out. Start from the memberMapping returned by import_preview; unmapped names fail with mapping_incomplete.',
        ),
      previewPayloadHash: z
        .string()
        .optional()
        .describe(
          'payloadHash returned by import_preview. Guards against committing different data than was previewed (payload_changed); required when skipIndexes is non-empty.',
        ),
      skipDuplicates: z
        .boolean()
        .default(true)
        .describe(
          'Skip rows that match an expense already in the flat (same payer, amount, description and date), so re-importing a file is safe. Set false only to deliberately create duplicates. Defaults to true.',
        ),
      skipIndexes: z
        .array(z.number().int().min(0))
        .default([])
        .describe(
          'Zero-based indexes into the parsed array from import_preview for rows the user does not want imported. Defaults to none.',
        ),
    }),
    path: () => ['imports', 'commit'],
    body: (input) => input,
  }),
  defineTool({
    name: 'wg_create',
    title: 'Create a new flat',
    description:
      'Create a new, separate flat with the caller as its first member and admin. Use it only when the user wants a new flat; to change an existing flat use wg_update, to see the flats the account already belongs to use wg_list. Works on the account level, so wgCode is not needed. Returns wg { id, shareCode, name } and creator { id, name }; pass shareCode as wgCode to other tools to work in the new flat. Other people join with that share code via the ManaWG app. Fails with account_deletion_pending if the account is being deleted and with wg_create_rate_limited after 10 creations per hour from one IP address.',
    method: 'POST',
    scope: 'account',
    input: z.strictObject({
      name: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe('Display name of the flat, for example "Elm Street 4".'),
      creatorName: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe(
          "Name the caller goes by inside this flat; other members see it on expenses, chores and chat. Does not change the account's name in other flats.",
        ),
    }),
    path: () => [],
    body: (input) => input,
  }),
];
