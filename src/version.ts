import { createRequire } from 'node:module';

/** The package version, so the advertised server version never drifts from `package.json`. */
export function serverVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
