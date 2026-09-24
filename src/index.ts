import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSessionController } from './auth.js';
import { loadConfig } from './config.js';
import { createManaWgClient } from './manawg-client.js';
import { buildServer } from './server.js';

export function start() {
  const config = loadConfig();
  const auth = createSessionController(config.auth);
  const client = createManaWgClient(config, fetch, auth);
  const handle = serveStdio(() =>
    buildServer(client, { allowDestructive: config.allowDestructive }),
  );
  console.error('ManaWG MCP server ready');
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
