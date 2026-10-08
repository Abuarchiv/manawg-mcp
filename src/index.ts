import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSessionController } from './auth.js';
import { type AppConfig, loadConfig } from './config.js';
import { startHttpServer } from './http.js';
import { createManaWgClient } from './manawg-client.js';
import { buildServer } from './server.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function readConfig(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    console.error(`config_error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

async function runHttp(
  config: AppConfig,
  createServer: Parameters<typeof startHttpServer>[0]['createServer'],
) {
  const running = await startHttpServer({
    ...config.http,
    createServer,
    onServerError: (error) => console.error(`mcp_http_error: ${errorMessage(error)}`),
  });
  const base = running.url.slice(0, running.url.length - config.http.path.length);
  console.error(
    `ManaWG MCP server ready transport=http mcp=${running.url} health=${base}/health ready=${base}/ready`,
  );

  const shutdown = (signal: string) => {
    console.error(`shutdown: ${signal} received, draining ${config.http.drainMs}ms`);
    running.beginShutdown().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(`shutdown_error: ${errorMessage(error)}`);
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return running;
}

export function start() {
  const config = readConfig();
  const auth = createSessionController(config.auth);
  const client = createManaWgClient(config, fetch, auth);
  const createServer = () => buildServer(client, { allowDestructive: config.allowDestructive });

  if (config.transport === 'http') {
    return runHttp(config, createServer);
  }
  const handle = serveStdio(createServer);
  console.error('ManaWG MCP server ready transport=stdio');
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(start()).catch((error: unknown) => {
    console.error(`startup_error: ${errorMessage(error)}`);
    process.exit(1);
  });
}
