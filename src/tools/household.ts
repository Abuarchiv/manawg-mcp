import { z } from 'zod';
import { defineTool } from './types.js';

const importSource = z.enum(['splitwise_csv', 'splid_csv', 'ocr_text']);

export const householdTools = [
  defineTool({
    name: 'calendar_subscription_get',
    title: 'Read the calendar subscription',
    description:
      'Your own calendar subscription for the flat: subscription { feedUrl, createdAt, updatedAt }, or subscription null when none is active. Subscribe to feedUrl in a calendar app; it contains a secret token, so never share it in chats.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'import_preview',
    title: 'Preview an import',
    description:
      'Parses splitwise_csv, splid_csv or ocr_text (payload as a string) without writing anything: parsed, payloadHash, memberMapping, conflicts and members. memberMapping (name → memberId or null) sets the matching, otherwise names are matched automatically. Then call import_commit with the same payload and payloadHash.',
    method: 'POST',
    input: z.strictObject({
      source: importSource,
      payload: z.string().min(1),
      memberMapping: z.record(z.string(), z.string().nullable()).optional(),
    }),
    path: () => ['imports', 'preview'],
    body: (input) => input,
    readOnly: true,
  }),
  defineTool({
    name: 'import_commit',
    title: 'Commit an import',
    description:
      'Writes the parsed expenses (skipDuplicates default true). memberMapping is complete and maps to uuids; previewPayloadHash from import_preview guards against a changed payload (payload_changed), skipIndexes without the hash gives preview_hash_required. import_preview and import_commit must get the same payload.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({
      source: importSource,
      payload: z.string().min(1),
      memberMapping: z.record(z.string(), z.uuid().nullable()),
      previewPayloadHash: z.string().optional(),
      skipDuplicates: z.boolean().default(true),
      skipIndexes: z.array(z.number().int().min(0)).default([]),
    }),
    path: () => ['imports', 'commit'],
    body: (input) => input,
  }),
  defineTool({
    name: 'wg_create',
    title: 'Create a new flat',
    description:
      'Creates a new flat (name 1..100, creatorName 1..80) and returns wg { id, shareCode, name } and creator { id, name }. Account-scoped and not tied to the current flat; reconnect with MANAWG_WG_CODE to use it. 3 requests per hour (wg_create_rate_limited).',
    method: 'POST',
    gate: 'destructive',
    scope: 'account',
    input: z.strictObject({
      name: z.string().trim().min(1).max(100),
      creatorName: z.string().trim().min(1).max(80),
    }),
    path: () => [],
    body: (input) => input,
  }),
];
