import { httpHandlerOptions } from './app.js';
import { loadConfig } from './config.js';
import { errorMessage } from './errors.js';
import { createHttpHandler, type HttpHandler } from './http.js';

type Built = { handler?: HttpHandler };

let built: Built | undefined;

function build(): Built {
  try {
    const config = loadConfig({ ...process.env, MANAWG_TRANSPORT: 'http' });
    if (config.auth.mode !== 'oauth') {
      // Functions share no disk: a rotating refresh token would be lost between instances.
      throw new Error('the Vercel entry needs MANAWG_AUTH=oauth');
    }
    return { handler: createHttpHandler(httpHandlerOptions(config)) };
  } catch (error) {
    console.error(`config_error: ${errorMessage(error)}`);
    return {};
  }
}

/**
 * Vercel Function entry (see `api/mcp.js` and `vercel.json`). Configuration is read on the
 * first request so a bad deployment answers `500 config_error` and logs why, instead of
 * crashing on import. Only the OAuth mode runs here.
 */
export async function handleRequest(request: Request): Promise<Response> {
  built ??= build();
  if (!built.handler) {
    return Response.json({ error: 'config_error' }, { status: 500 });
  }
  return built.handler.fetch(request);
}
