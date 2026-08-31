import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { createManaWgClient } from './manawg-client.js';
import { buildServer } from './server.js';

export function start() {
  const handle = serveStdio(() => buildServer(createManaWgClient(loadConfig())));
  console.error('ManaWG MCP server ready');
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
