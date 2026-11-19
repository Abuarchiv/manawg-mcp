import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

/** The package version, so the advertised server version never drifts from `package.json`. */
export function serverVersion(): string {
  return version;
}
