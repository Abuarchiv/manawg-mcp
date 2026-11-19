import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { TOOL_DEFS, TOOLSET_NAMES } from '../src/tools/registry.js';

// The MCP Registry entry is published from server.json; a release that bumps only package.json
// would leave the registry on the old version.
it('server.json carries the package version', () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  expect(read('server.json').version).toBe(read('package.json').version);
});

// Tool counts and the Kind column in the docs are written by hand; a new or re-gated tool must
// show up there.
it('docs list every tool with its kind and quote the right counts', () => {
  const text = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const tools = text('docs/tools.md');
  const kindOf = (tool: (typeof TOOL_DEFS)[number]) =>
    tool.gate ? 'destructive' : tool.method === 'GET' || tool.readOnly ? 'read' : 'write';
  const documented = new Map(
    [...tools.matchAll(/^\| `(\w+)` \|.*\| (read|write|destructive)(?: †)? \|$/gm)].map((row) => [
      row[1],
      row[2],
    ]),
  );
  const destructive = TOOL_DEFS.filter((tool) => tool.gate).length;

  expect(Object.fromEntries(documented)).toEqual(
    Object.fromEntries(TOOL_DEFS.map((tool) => [tool.name, kindOf(tool)])),
  );
  expect(tools).toContain(`exposes: ${TOOL_DEFS.length} tools`);
  expect(tools).toContain(`(${destructive} tools)`);
  expect(tools).toContain(`it exposes ${TOOL_DEFS.length - destructive} tools`);
  expect(text('README.md')).toContain(`The full list of ${TOOL_DEFS.length} tools`);
  expect(text('README.md')).toContain(`all ${destructive} destructive tools`);
});

it('docs name every MANAWG_TOOLSETS group', () => {
  const tools = readFileSync(new URL('../docs/tools.md', import.meta.url), 'utf8');
  const table = tools.slice(tools.indexOf('| Group | Sections above |'));
  const documented = [...table.matchAll(/^\| `(\w+)` \|/gm)].map((row) => row[1]);
  expect(documented.slice(0, TOOLSET_NAMES.length)).toEqual(TOOLSET_NAMES);
  expect(table.split('\n\n')[0].match(/^\| `/gm)).toHaveLength(TOOLSET_NAMES.length);
});
