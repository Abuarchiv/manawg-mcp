import { expect, it } from 'vitest';
import { SAFE_UPSTREAM_CODES } from '../src/errors.js';
import { RESOURCE_DEFS, RESOURCE_TEMPLATE_DEFS } from '../src/resources.js';
import { TOOL_DEFS } from '../src/tools/registry.js';
import snapshot from './fixtures/app-routes.json' with { type: 'json' };

// Every tool and resource must call a route the app serves. test/fixtures/app-routes.json is a
// snapshot of apps/web/src/app/api/wg/**/route.ts.

const routes = new Set(snapshot.routes.map((route) => route.replace(/\{\w+\}/g, '{}')));

const PLACEHOLDER = '<id>';

/** Builds `METHOD /api/wg/{}/...` with every dynamic segment replaced by `{}`. */
function toEndpoint(method: string, scope: 'wg' | 'account' | undefined, path: string[]): string {
  const segments = path.map((segment) => (segment === PLACEHOLDER ? '{}' : segment));
  const base = scope === 'account' ? [] : ['{}'];
  return `${method} ${['/api/wg', ...base, ...segments].filter(Boolean).join('/')}`;
}

const placeholder = new Proxy({}, { get: () => PLACEHOLDER });

// App routes no tool or resource calls, each with the reason. A new app route must either get a
// tool or an entry here, and an entry for a route that is now exposed or gone fails the test.
const INTENTIONALLY_UNEXPOSED: Record<string, string> = {
  'DELETE /api/wg/{}': 'deleting a flat is irreversible and stays in the app',
  'DELETE /api/wg/{}/recurring-expenses/{}':
    'duplicate of the collection route recurring_delete uses',
  'GET /api/wg/invites/{}': 'join flow for the invited person, not for a member managing the flat',
  'GET /api/wg/invites/{}/preview':
    'join flow for the invited person, not for a member managing the flat',
  'POST /api/wg/{}/members': 'joining a flat with an invite token happens in the app',
  'POST /api/wg/{}/members/{}/admin': 'handing over the admin role stays in the app',
  'POST /api/wg/{}/notifications': 'push subscriptions belong to a browser, plus test_notification',
};

const toolEndpoints = TOOL_DEFS.map((tool) => ({
  name: tool.name,
  endpoint: toEndpoint(tool.method, tool.scope, tool.path(placeholder)),
}));
const resourceEndpoints = [
  ...RESOURCE_DEFS.map((def) => toEndpoint('GET', def.scope, def.path)),
  ...RESOURCE_TEMPLATE_DEFS.map((def) => toEndpoint('GET', undefined, def.path(PLACEHOLDER))),
];

it('maps every tool to a route the app serves', () => {
  expect(toolEndpoints.filter(({ endpoint }) => !routes.has(endpoint))).toEqual([]);
});

it('maps every resource and resource template to a GET route the app serves', () => {
  expect(resourceEndpoints.filter((endpoint) => !routes.has(endpoint))).toEqual([]);
});

it('keeps tool names unique', () => {
  const names = TOOL_DEFS.map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);
});

// snake_case words in descriptions that are response fields or values, not error codes.
const NOT_ERROR_CODES = new Set([
  'amount_cents',
  'chore_swap',
  'debtor_id',
  'debtor_name',
  'member_id',
  'oldest_age_days',
  'payer_unmapped',
  'retry_after_s',
]);

it('only promises error codes on the allowlist', () => {
  // Any snake_case word in a description is an error code, a tool name or listed above, so a
  // misspelled or removed code is caught whether or not an HTTP status precedes it.
  const toolNames = new Set(TOOL_DEFS.map((tool) => tool.name));
  const unknownCodes = TOOL_DEFS.flatMap((tool) =>
    [...tool.description.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)]
      .map((match) => match[0])
      .filter(
        (word) =>
          !SAFE_UPSTREAM_CODES.has(word) && !toolNames.has(word) && !NOT_ERROR_CODES.has(word),
      )
      .map((word) => `${tool.name}:${word}`),
  );
  expect(unknownCodes).toEqual([]);
});

it('accounts for every app route: exposed by a tool or resource, or listed with a reason', () => {
  const used = new Set([...toolEndpoints.map(({ endpoint }) => endpoint), ...resourceEndpoints]);
  const unaccounted = [...routes].filter(
    (route) => !used.has(route) && !(route in INTENTIONALLY_UNEXPOSED),
  );
  const stale = Object.keys(INTENTIONALLY_UNEXPOSED).filter(
    (route) => used.has(route) || !routes.has(route),
  );

  expect({ unaccounted, stale }).toEqual({ unaccounted: [], stale: [] });
});
