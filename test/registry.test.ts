import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The MCP Registry entry is published from server.json; a release that bumps only package.json
// would leave the registry on the old version.
it('server.json carries the package version', () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  expect(read('server.json').version).toBe(read('package.json').version);
});
