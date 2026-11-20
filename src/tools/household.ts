import { z } from 'zod';
import { uuid } from './shared.js';
import { defineTool } from './types.js';

const importSource = z.enum([
  'splitwise_csv',
  'splid_csv',
  'tricount_csv',
  'settleup_csv',
  'ocr_text',
]);

export const householdTools = [
  defineTool({
    name: 'calendar_subscription_get',
    title: 'Read the calendar subscription',
    description:
      "Read the caller's own calendar feed subscription for the flat. Returns subscription { feedUrl, createdAt, updatedAt }, or subscription null when no feed is active; then call calendar_subscription_create. Use it to give the user a URL to add to a calendar app; to list the events themselves use events_list. Read-only; any member may call it, and each member has their own feed. feedUrl contains a secret token that grants read access to the flat's events, so show it only to the user and never post it in chat, notes or logs.",
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'calendar_subscription_create',
    title: 'Create the calendar subscription',
    description:
      "Create the caller's own calendar feed for the flat, so a calendar app can subscribe to the flat's events. Use it when calendar_subscription_get returns subscription null; to read an existing feed use calendar_subscription_get, to replace a leaked URL use calendar_subscription_rotate. Safe to repeat: if a feed is already active it is returned unchanged; after calendar_subscription_revoke it creates a fresh feed with a new URL. Any member may call it; it notifies nobody. Returns subscription { feedUrl, createdAt, updatedAt }. feedUrl contains a secret token that grants read access to the flat's events, so show it only to the user and never post it in chat, notes or logs.",
    method: 'POST',
    idempotent: true,
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'calendar_subscription_rotate',
    title: 'Rotate the calendar subscription URL',
    description:
      "Replace the secret token in the caller's active calendar feed URL. Use it when the URL may have leaked; the old URL stops working at once, so every calendar app subscribed to it must be re-subscribed with the new feedUrl and stops updating until then. To read the current URL use calendar_subscription_get, to switch the feed off for good use calendar_subscription_revoke. Fails with 404 calendar_subscription_not_found when no feed is active (call calendar_subscription_create first). Any member may rotate their own feed; it notifies nobody. Returns subscription { feedUrl, createdAt, updatedAt }. feedUrl is secret: show it only to the user and never post it in chat, notes or logs.",
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'calendar_subscription_revoke',
    title: 'Revoke the calendar subscription',
    description:
      "Switch off the caller's own calendar feed. The feed URL stops working at once and calendar apps subscribed to it stop updating; calendar_subscription_create later makes a new feed with a different URL, the old URL never comes back. Use it when the user no longer wants the calendar synced; to only replace a leaked URL use calendar_subscription_rotate. Fails with 404 calendar_subscription_not_found when no feed is active. Affects only the caller's feed, not other members or the events; it notifies nobody. Returns revoked true.",
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'import_preview',
    title: 'Preview an import',
    description:
      'Dry-run parse of expense data exported from another app (Splitwise, Splid, Tricount or Settle Up CSV) or pasted receipt text, without writing anything. Call this first, then import_commit with the same source and payload. Returns parsed (expense rows), payloadHash, memberMapping (file name to member id or null), conflicts (names still unmapped), members (active members of the flat), rejected (rows that could not be parsed) and fuzzyNames (names matched only approximately; check them). Names are matched to members automatically, and any entry you pass in memberMapping overrides that match. Rate limit: 10 previews per hour per member.',
    method: 'POST',
    input: z.strictObject({
      source: importSource.describe(
        'Format of payload: splitwise_csv (Splitwise export), splid_csv (Splid export), tricount_csv (older Tricount exports; Tricount dropped export in 2024), settleup_csv (Settle Up export) or ocr_text (text read from a receipt or screenshot).',
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
      'Create the expenses from an import for real, after the user has reviewed import_preview. Use import_preview first and pass the same source, payload and the final memberMapping; do not use this to add a single expense (use expense_create). To take back a whole import use import_undo with the returned importId (find earlier ones with imports_list); expense_delete removes single expenses only. Other members get one notification when at least one expense was created. Returns importId (pass it to import_undo), inserted, skipped, errors ({ index, reason } per row that was not created, such as payer_unmapped or paid_by_must_include_caller) and warning (null or a notification delivery problem). Non-admins can only import rows they paid or share in. Fails with mapping_incomplete (plus conflicts) if a name is unmapped, payload_changed if previewPayloadHash does not match payload, preview_hash_required if skipIndexes is set without previewPayloadHash. Rate limit: 3 commits per hour per member.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({
      source: importSource.describe('Same value as in the import_preview call.'),
      payload: z
        .string()
        .min(1)
        .describe('Same unmodified string as in the import_preview call; it is parsed again.'),
      memberMapping: z
        .record(z.string(), uuid.nullable())
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
    name: 'imports_list',
    title: 'List imports that can be undone',
    description:
      'List the latest imports (up to 10, newest first) that import_undo can still take back, each with id, source, startedAt, inserted (expenses created) and importedByMemberId. Use it to find the importId of an import_commit from an earlier session; imports with settled shares are left out. Admins see all imports of the flat, other members only their own. Read-only. For the preview of new data use import_preview.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['imports'],
  }),
  defineTool({
    name: 'import_undo',
    title: 'Undo an import',
    description:
      'Delete every expense that one import_commit created, in a single step. Use it when an import was wrong or went into the wrong flat; to remove a single expense use expense_delete. Allowed for the member who ran the import or an admin (otherwise 403 not_owner). Fails with 409 import_settled once a payment was completed since the import or a share of someone other than the payer is settled, and with 404 import_not_found for an unknown id. The expenses are deleted permanently and balances change immediately for all members; nobody is notified, but an audit entry is written. Returns removed (number of expenses deleted). Cannot be redone: committing the same file again creates the expenses as new ones.',
    method: 'DELETE',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid.describe('The importId returned by import_commit, or an id from imports_list.'),
    }),
    path: (input) => ['imports', input.id],
  }),
  defineTool({
    name: 'wg_create',
    title: 'Create a new flat',
    description:
      'Create a new, separate flat with the caller as its first member and admin. Use it only when the user wants a new flat; to change an existing flat use wg_update, to see the flats the account already belongs to use wg_list. Works on the account level, so wgCode is not needed. Returns wg { id, shareCode, name } and creator { id, name }; pass shareCode as wgCode to other tools to work in the new flat. The share code only addresses the flat in tools; people cannot join with it, so to add flatmates create an invite link with invite_create or send one with invite_email. Fails with account_deletion_pending if the account is being deleted and with wg_create_rate_limited after 10 creations per hour from one IP address.',
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
