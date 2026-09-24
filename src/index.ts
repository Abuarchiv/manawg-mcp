import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSessionController } from './auth.js';
import { loadConfig } from './config.js';
import { type RunningHttpServer, startHttpServer } from './http.js';
import { createManaWgClient } from './manawg-client.js';
import { buildServer } from './server.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export function start() {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`config_error: ${errorMessage(error)}`);
    process.exit(1);
  }
  const auth = createSessionController(config.auth);
  const client = createManaWgClient(config, fetch, auth);
  const createServer = () => buildServer(client, { allowDestructive: config.allowDestructive });

  if (config.transport === 'http') {
    return startHttpServer({
      ...config.http,
      createServer,
      onServerError: (error) => console.error(`mcp_http_error: ${errorMessage(error)}`),
    }).then((running: RunningHttpServer) => {
      const health = running.url.replace(config.http.path, '/health');
      console.error(`ManaWG MCP server ready transport=http mcp=${running.url} health=${health}`);
      return running;
    });
  }

  const handle = serveStdio(createServer);
  console.error('ManaWG MCP server ready transport=stdio');
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = start();
  if (started instanceof Promise) {
    void started.catch((error: unknown) => {
      console.error(`startup_error: ${errorMessage(error)}`);
      process.exit(1);
    });
  }
}
