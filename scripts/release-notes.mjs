#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version, the text of its GitHub Release:
//   node scripts/release-notes.mjs 0.3.0
// Fails when the section is missing or empty.

import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split('\n');
const start = lines.findIndex(
  (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
);
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
const notes = lines
  .slice(start + 1, next === -1 ? undefined : next)
  .join('\n')
  .trim();
if (!notes) {
  console.error(`CHANGELOG.md section for ${version} is empty`);
  process.exit(1);
}
console.log(notes);
