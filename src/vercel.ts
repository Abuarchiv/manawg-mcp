import { httpHandlerOptions } from './app.js';
import { loadConfig } from './config.js';
import { createHttpHandler, type HttpHandler } from './http.js';

/**
 * Vercel Function entry (see `api/mcp.js` and `vercel.json`). Configuration is read on the
 * first request so a bad deployment answers `500 config_error` and logs why, instead of
 * crashing on import. Only the OAuth mode runs here.
 */
let handler: HttpHandler | undefined;
let configError: string | undefined;

function load(): HttpHandler | undefined {
  if (handler || configError) {
    return handler;
  }
  try {
    const config = loadConfig({
      ...process.env,
      MANAWG_TRANSPORT: 'http',
      MANAWG_HTTP_HOST: '0.0.0.0',
    });
    if (config.auth.mode !== 'oauth') {
      // Functions share no disk: a rotating refresh token would be lost between instances.
      throw new Error('the Vercel entry needs MANAWG_AUTH=oauth');
    }
    handler = createHttpHandler(
      httpHandlerOptions(config, (error) => console.error(`mcp_http_error: ${error.message}`)),
    );
  } catch (error) {
    configError = error instanceof Error ? error.message : 'unknown error';
    console.error(`config_error: ${configError}`);
  }
  return handler;
}

export async function handleRequest(request: Request): Promise<Response> {
  const loaded = load();
  if (!loaded) {
    return Response.json({ error: 'config_error' }, { status: 500 });
  }
  return loaded.fetch(request);
}
