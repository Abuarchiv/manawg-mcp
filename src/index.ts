import { pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { httpHandlerOptions, serverFactory } from './app.js';
import { type AppConfig, loadConfig } from './config.js';
import { startHttpServer } from './http.js';

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

async function runHttp(config: AppConfig) {
  const running = await startHttpServer({
    host: config.http.host,
    port: config.http.port,
    drainMs: config.http.drainMs,
    ...httpHandlerOptions(config, (error) =>
      console.error(`mcp_http_error: ${errorMessage(error)}`),
    ),
  });
  const base = running.url.slice(0, running.url.length - config.http.path.length);
  console.error(
    `ManaWG MCP server ready transport=http auth=${config.auth.mode} mcp=${running.url} health=${base}/health ready=${base}/ready`,
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
  if (config.transport === 'http') {
    return runHttp(config);
  }
  const handle = serveStdio(serverFactory(config));
  console.error('ManaWG MCP server ready transport=stdio');
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(start()).catch((error: unknown) => {
    console.error(`startup_error: ${errorMessage(error)}`);
    process.exit(1);
  });
}
