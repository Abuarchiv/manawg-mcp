/** Tool groups a deployment can pick with MANAWG_TOOLSETS. `overview` is always registered. */
export const TOOLSET_NAMES = [
  'overview',
  'money',
  'recurring',
  'shopping',
  'supplies',
  'chores',
  'notes',
  'chat',
  'calendar',
  'members',
  'household',
] as const;

export type ToolsetName = (typeof TOOLSET_NAMES)[number];

/** True when `toolset` is registered under the chosen list (`undefined` means every toolset). */
export function toolsetEnabled(toolset: string, chosen: readonly string[] | undefined): boolean {
  return chosen === undefined || toolset === 'overview' || chosen.includes(toolset);
}
