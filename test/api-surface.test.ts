import { expect, it } from 'vitest';
import { SAFE_UPSTREAM_CODES } from '../src/errors.js';
import { RESOURCE_DEFS, RESOURCE_TEMPLATE_DEFS } from '../src/resources.js';
import { TOOL_DEFS } from '../src/tools/registry.js';
import snapshot from './fixtures/app-routes.json' with { type: 'json' };

// Every tool and resource must hit a route the ManaWG app really serves. The fixture is a
// snapshot of apps/web/src/app/api/wg/**/route.ts; a tool for a missing route (the removed
// `search`) or a wrong path (`wg_create` on /api/wg/wg) fails here.

const routes = new Set(snapshot.routes.map((route) => route.replace(/\{\w+\}/g, '{}')));

/** Builds `METHOD /api/wg/{}/...` with every dynamic segment replaced by `{}`. */
function toEndpoint(method: string, scope: 'wg' | 'account' | undefined, path: string[]): string {
  const segments = path.map((segment) => (segment.startsWith('<') ? '{}' : segment));
  const base = scope === 'account' ? [] : ['{}'];
  return `${method} ${['/api/wg', ...base, ...segments].filter(Boolean).join('/')}`;
}

const placeholder = new Proxy({}, { get: () => '<id>' });

it('maps every tool to a route the app serves', () => {
  const missing = TOOL_DEFS.map((tool) => ({
    name: tool.name,
    endpoint: toEndpoint(tool.method, tool.scope, tool.path(placeholder)),
  })).filter(({ endpoint: route }) => !routes.has(route));

  expect(missing).toEqual([]);
});

it('maps every resource and resource template to a GET route the app serves', () => {
  const requested = [
    ...RESOURCE_DEFS.map((def) => toEndpoint('GET', def.scope, def.path)),
    ...RESOURCE_TEMPLATE_DEFS.map((def) => toEndpoint('GET', 'wg', def.path('<id>'))),
  ];

  expect(requested.filter((route) => !routes.has(route))).toEqual([]);
});

it('keeps tool names unique and every promised error code on the allowlist', () => {
  const names = TOOL_DEFS.map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);

  const unknownCodes = TOOL_DEFS.flatMap((tool) =>
    (tool.description.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])
      .filter((word) => /_(invalid|changed|pending|conflict|exists|found)$/.test(word))
      .filter((code) => !SAFE_UPSTREAM_CODES.has(code))
      .map((code) => `${tool.name}:${code}`),
  );
  expect(unknownCodes).toEqual([]);
});
