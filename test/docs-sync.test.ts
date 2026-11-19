import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { buildServer, SERVER_DESCRIPTION, SERVER_ICONS } from '../src/server.js';
import { TOOL_DEFS } from '../src/tools/registry.js';
import { TOOLSET_NAMES } from '../src/toolsets.js';
import { connectClient, useCleanup } from './helpers/app.js';

const later = useCleanup();

// The MCP Registry entry is published from server.json; a release that bumps only package.json
// would leave the registry on the old version, and the listing must match what `initialize` sends.
it('server.json carries the package version and what the server advertises', () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  const entry = read('server.json');
  expect(entry.version).toBe(read('package.json').version);
  expect(entry.description).toBe(SERVER_DESCRIPTION);
  expect(entry.icons).toEqual(SERVER_ICONS);
});

// Tool counts, titles and the Kind column in the docs are written by hand; a new, renamed or
// re-gated tool must show up there.
it('docs list every tool with its kind and quote the right counts', async () => {
  const text = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const tools = text('docs/tools.md');
  const server = buildServer({ call: vi.fn() }, { allowDestructive: true });
  const client = await connectClient(server, 'docs');
  later(() => client.close());
  later(() => server.close());
  const listed = (await client.listTools()).tools;
  const kindOf = (annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } = {}) =>
    annotations.destructiveHint ? 'destructive' : annotations.readOnlyHint ? 'read' : 'write';
  const documented = new Map(
    [...tools.matchAll(/^\| `(\w+)` \|.*\| (read|write|destructive)(?: †)? \|$/gm)].map((row) => [
      row[1],
      row[2],
    ]),
  );
  const destructive = TOOL_DEFS.filter((tool) => tool.gate).length;

  expect(Object.fromEntries(documented)).toEqual(
    Object.fromEntries(listed.map((tool) => [tool.name, kindOf(tool.annotations)])),
  );
  const titles = new Map(
    [...tools.matchAll(/^\| `(\w+)` \| (.+?) \| (?:read|write|destructive)/gm)].map((row) => [
      row[1],
      row[2],
    ]),
  );
  expect(Object.fromEntries(titles)).toEqual(
    Object.fromEntries(TOOL_DEFS.map((tool) => [tool.name, tool.title])),
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
