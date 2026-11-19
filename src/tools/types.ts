import type { z } from 'zod';
import type { HttpMethod, QueryParams, RequestScope } from '../manawg-client.js';
import { toolsetEnabled } from '../toolsets.js';

type ToolGate = 'destructive';

type ToolSpec<TInput extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  method: HttpMethod;
  input: TInput;
  path: (input: z.output<TInput>) => string[];
  query?: (input: z.output<TInput>) => QueryParams;
  body?: (input: z.output<TInput>) => unknown;
  /** `destructive` tools are only registered when `MANAWG_ALLOW_DESTRUCTIVE` is set. */
  gate?: ToolGate;
  scope?: RequestScope;
  /** Overrides the `readOnlyHint` derived from the method (e.g. a side-effect-free POST). */
  readOnly?: boolean;
  /** Set by the registry: the MANAWG_TOOLSETS group this tool belongs to. */
  toolset?: string;
  /** Marks a non-GET tool as idempotent: repeating the call with the same input changes nothing more. */
  idempotent?: boolean;
  /** Reshapes the route payload before it is returned to the model. */
  transform?: (input: z.output<TInput>, payload: unknown) => unknown;
};

/** A tool as the registry sees it: handlers take the already-validated input. */
export type ToolDef = ToolSpec<z.ZodType>;

export function defineTool<TInput extends z.ZodType>(spec: ToolSpec<TInput>): ToolDef {
  // Handlers are typed against the parsed input here; the SDK validates before calling them.
  return spec as unknown as ToolDef;
}

/**
 * Drops destructive tools unless allowed, and tools outside the chosen toolsets when a list is
 * given (`undefined` keeps every toolset). The `overview` toolset is always kept.
 */
export function selectTools(
  tools: ToolDef[],
  allowDestructive: boolean,
  toolsets?: readonly string[],
): ToolDef[] {
  return tools.filter(
    (tool) =>
      (allowDestructive || tool.gate !== 'destructive') &&
      toolsetEnabled(tool.toolset ?? 'overview', toolsets),
  );
}
