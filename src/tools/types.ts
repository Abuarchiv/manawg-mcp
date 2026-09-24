import type { z } from 'zod';
import type { HttpMethod } from '../manawg-client.js';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type ToolGate = 'destructive';

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
  const def: ToolDef = {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    method: spec.method,
    input: spec.input,
    path: spec.path as (input: unknown) => string[],
  };
  if (spec.query) {
    def.query = spec.query as (input: unknown) => QueryParams;
  }
  if (spec.body) {
    def.body = spec.body as (input: unknown) => unknown;
  }
  if (spec.gate) {
    def.gate = spec.gate;
  }
  if (spec.scope) {
    def.scope = spec.scope;
  }
  if (spec.readOnly) {
    def.readOnly = spec.readOnly;
  }
  if (spec.transform) {
    def.transform = spec.transform as (input: unknown, payload: unknown) => unknown;
  }
  return def;
}

export function selectTools(tools: ToolDef[], allowDestructive: boolean): ToolDef[] {
  return allowDestructive ? tools : tools.filter((tool) => tool.gate !== 'destructive');
}
