import { TOOLSET_NAMES, type ToolsetName, toolsetEnabled } from '../toolsets.js';
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

/** The tools of each MANAWG_TOOLSETS group (names in ../toolsets.ts). */
const TOOLSETS = {
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

/** A tool together with the MANAWG_TOOLSETS group it was registered under. */
type RegisteredTool = ToolDef & { toolset: ToolsetName };

export const TOOL_DEFS: RegisteredTool[] = TOOLSET_NAMES.flatMap((name) =>
  TOOLSETS[name].map((tool) => ({ ...tool, toolset: name })),
);

/**
 * Drops destructive tools unless allowed, and tools outside the chosen toolsets when a list is
 * given (`undefined` keeps every toolset). The `overview` toolset is always kept.
 */
export function selectTools(
  tools: RegisteredTool[],
  allowDestructive: boolean,
  toolsets?: readonly ToolsetName[],
): RegisteredTool[] {
  return tools.filter(
    (tool) =>
      (allowDestructive || tool.gate !== 'destructive') && toolsetEnabled(tool.toolset, toolsets),
  );
}
