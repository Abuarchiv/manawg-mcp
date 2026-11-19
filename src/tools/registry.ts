import { TOOLSET_NAMES, type ToolsetName } from '../toolsets.js';
import { calendarTools } from './calendar.js';
import { chatTools } from './chat.js';
import { choreTools } from './chores.js';
import { financeTools } from './finance.js';
import { householdTools } from './household.js';
import { inventoryTools } from './inventory.js';
import { memberTools } from './members.js';
import { noteTools } from './notes.js';
import { overviewTools } from './overview.js';
import { recurringTools } from './recurring.js';
import { shoppingTools } from './shopping.js';
import type { ToolDef } from './types.js';

export { selectTools, type ToolDef } from './types.js';

/** The tools of each MANAWG_TOOLSETS group (names in ../toolsets.ts). */
export const TOOLSETS = {
  overview: overviewTools,
  money: financeTools,
  recurring: recurringTools,
  shopping: shoppingTools,
  supplies: inventoryTools,
  chores: choreTools,
  notes: noteTools,
  chat: chatTools,
  calendar: calendarTools,
  members: memberTools,
  household: householdTools,
} as const satisfies Record<ToolsetName, ToolDef[]>;

export { TOOLSET_NAMES, type ToolsetName };

export const TOOL_DEFS: ToolDef[] = TOOLSET_NAMES.flatMap((name) =>
  TOOLSETS[name].map((tool) => ({ ...tool, toolset: name })),
);
