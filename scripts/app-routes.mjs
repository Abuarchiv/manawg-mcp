#!/usr/bin/env node
// Regenerates test/fixtures/app-routes.json from a ManaWG app checkout:
//   node scripts/app-routes.mjs ../manawg-app
// Reads every apps/web/src/app/api/wg/**/route.ts and records its exported HTTP methods.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = process.argv[2];
if (!appDir) {
  console.error('usage: node scripts/app-routes.mjs <path-to-manawg-app>');
  process.exit(1);
}
const apiRoot = join(appDir, 'apps/web/src/app/api');
const wgRoot = join(apiRoot, 'wg');
const methodPattern = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

function* routeFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* routeFiles(path);
    else if (entry.name === 'route.ts') yield path;
  }
}

const routes = [];
for (const file of routeFiles(wgRoot)) {
  const segments = relative(apiRoot, dirname(file))
    .split(sep)
    .map((segment) => segment.replace(/^\[(\w+)\]$/, '{$1}'));
  const path = `/api/${segments.join('/')}`;
  for (const [, method] of readFileSync(file, 'utf8').matchAll(methodPattern)) {
    routes.push(`${method} ${path}`);
  }
}
routes.sort();

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'test/fixtures/app-routes.json');
const note =
  'Snapshot of the ManaWG app API surface under /api/wg (apps/web/src/app/api/wg/**/route.ts). Refresh with `node scripts/app-routes.mjs <path-to-manawg-app>`.';
writeFileSync(out, `${JSON.stringify({ _note: note, routes }, null, 2)}\n`);
process.stdout.write(`${routes.length} routes written to ${relative(process.cwd(), out)}\n`);
