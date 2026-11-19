import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { httpHandlerOptions, serverFactory } from './app.js';
import { type AppConfig, loadConfig } from './config.js';
import { errorMessage } from './errors.js';
import { startHttpServer } from './http.js';

function readConfig(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    console.error(`config_error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

async function runHttp(config: AppConfig) {
  const handlerOptions = httpHandlerOptions(config);
  const running = await startHttpServer({
    host: config.http.host,
    port: config.http.port,
    drainMs: config.http.drainMs,
    ...handlerOptions,
  });
  console.error(
    `ManaWG MCP server ready transport=http auth=${handlerOptions.auth.kind} mcp=${running.url} health=${running.origin}/health ready=${running.origin}/ready`,
  );

  const shutdown = (signal: string) => {
    console.error(`shutdown: ${signal} received, draining ${config.http.drainMs}ms`);
    running.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(`shutdown_error: ${errorMessage(error)}`);
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

async function main() {
  const config = readConfig();
  if (config.transport === 'http') {
    await runHttp(config);
    return;
  }
  serveStdio(serverFactory(config));
  console.error('ManaWG MCP server ready transport=stdio');
}

main().catch((error: unknown) => {
  console.error(`startup_error: ${errorMessage(error)}`);
  process.exit(1);
});
