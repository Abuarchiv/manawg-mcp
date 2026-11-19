import { z } from 'zod';
import type { ToolsetName } from './toolsets.js';

type PromptArgs = Record<string, string | undefined>;

export type PromptDef = {
  name: string;
  title: string;
  description: string;
  args: z.ZodType<PromptArgs>;
  /** Tool groups the prompt calls; it is only offered when all of them are registered. */
  toolsets: readonly ToolsetName[];
  render: (args: PromptArgs) => string;
};

const noArgs = z.strictObject({});

export const PROMPT_DEFS: PromptDef[] = [
  {
    name: 'daily_brief',
    title: 'Daily flat brief',
    description:
      'Reads the dashboard, activity, shopping, chores and calendar and gives a compact status.',
    args: z.strictObject({ focus: z.string().max(200).optional() }),
    toolsets: ['shopping', 'chores', 'calendar'],
    render: (args) => `Write a compact daily brief for the flat.

Steps:
1. dashboard_get for balances, spending, open shopping, due chores and flat health.
2. activity_get for changes since the last brief.
3. shopping_list and chores_list for open items.
4. events_list and absences_list for the next events and absences.

Answer in the language of the conversation, at most 10 bullets, no tables:
- balances and notable expenses
- open shopping and who bought what
- due and overdue chores
- upcoming events and absences
- posts with status open
${args.focus ? `\nThe user also wants to focus on: ${args.focus}` : ''}
Invent nothing: every bullet must come from a tool answer; mark missing data briefly as "no data".`,
  },
  {
    name: 'shopping_run',
    title: 'Plan a shopping run',
    description:
      'Combines the shopping list with the supplies and gives a grouped list for the run.',
    args: noArgs,
    toolsets: ['shopping', 'supplies'],
    render: () => `Plan a shopping run for the flat.

Steps:
1. shopping_list for all open and bought items.
2. inventory_list to check what is already in stock.

Answer in the language of the conversation:
- a checklist by category or shop, open items first
- per item: quantity, who added it, and "already in stock" where that applies
- at the end: bought items that should be marked done with shopping_set_bought

Change nothing: only plan, do not call any shopping tools.`,
  },
  {
    name: 'payment_reminder',
    title: 'Draft a payment reminder',
    description: 'Writes a friendly reminder about open balances. Draft only, nothing is sent.',
    args: z.strictObject({ tone: z.string().max(200).optional() }),
    toolsets: ['money'],
    render: (args) => `Write a friendly payment reminder for the flat.

Steps:
1. balances_get for open balances.
2. reminders_list to avoid repeating reminders already sent.

Answer in the language of the conversation:
- greeting and subject
- amount, what it was for (expense or reference) and how long it has been open
- factual, friendly wording without blame
${args.tone ? `\nRequested tone: ${args.tone}` : ''}
IMPORTANT: return only the draft. Do not call reminder_send before the user explicitly agrees.`,
  },
  {
    name: 'settlement_plan',
    title: 'Suggest a settlement',
    description: 'Works out the fewest transfers between the members, without carrying them out.',
    args: noArgs,
    toolsets: ['money'],
    render: () => `Suggest the smallest set of payments that settles the flat.

Steps:
1. dashboard_get (balances) for the balances of the whole flat; balances_get only shows what others owe the caller.
2. settlement_preview per direction (fromMemberId → toMemberId) for the settlement the server computes.

Answer in the language of the conversation:
- a table: from → amount → to
- the number of transfers and whether any falls below the minimum amount
- explain any difference between dashboard_get and settlement_preview

IMPORTANT: do not call settlement_commit. The plan is only a suggestion; carrying it out needs explicit approval.`,
  },
];
