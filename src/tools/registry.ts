import { calendarTools } from './calendar.js';
import { chatTools } from './chat.js';
import { choreTools } from './chores.js';
import { financeTools } from './finance.js';
import { inventoryTools } from './inventory.js';
import { memberTools } from './members.js';
import { noteTools } from './notes.js';
import { overviewTools } from './overview.js';
import { recurringTools } from './recurring.js';
import { shoppingTools } from './shopping.js';
import type { ToolDef } from './types.js';

export { selectTools, type ToolDef, type ToolGate } from './types.js';

export const TOOL_DEFS: ToolDef[] = [
  ...overviewTools,
  ...financeTools,
  ...recurringTools,
  ...shoppingTools,
  ...inventoryTools,
  ...choreTools,
  ...noteTools,
  ...chatTools,
  ...calendarTools,
  ...memberTools,
];
