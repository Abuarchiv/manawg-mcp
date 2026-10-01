import type { z } from 'zod';
import type { HttpMethod } from '../manawg-client.js';

type QueryParams = Record<string, string | number | boolean | undefined>;

type ToolGate = 'destructive';

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  method: HttpMethod;
  input: z.ZodType;
  path: (input: unknown) => string[];
  query?: (input: unknown) => QueryParams;
  body?: (input: unknown) => unknown;
  gate?: ToolGate;
  scope?: 'wg' | 'account';
  readOnly?: boolean;
  transform?: (input: unknown, payload: unknown) => unknown;
};

type ToolSpec<TInput extends z.ZodType> = {
  name: string;
  title: string;
  description: string;
  method: HttpMethod;
  input: TInput;
  path: (input: z.output<TInput>) => string[];
  query?: (input: z.output<TInput>) => QueryParams;
  body?: (input: z.output<TInput>) => unknown;
  gate?: ToolGate;
  scope?: 'wg' | 'account';
  readOnly?: boolean;
  transform?: (input: z.output<TInput>, payload: unknown) => unknown;
};

export function defineTool<TInput extends z.ZodType>(spec: ToolSpec<TInput>): ToolDef {
  // Handlers are typed against the parsed input here; the registry validates before calling them.
  return spec as unknown as ToolDef;
}

export function selectTools(tools: ToolDef[], allowDestructive: boolean): ToolDef[] {
  return allowDestructive ? tools : tools.filter((tool) => tool.gate !== 'destructive');
}
