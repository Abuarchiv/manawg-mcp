import type { McpServerFactory } from '@modelcontextprotocol/server';
import { createSessionController } from './auth.js';
import type { AppConfig } from './config.js';
import type { HttpAuth, HttpHandlerOptions } from './http.js';
import {
  bearerCredentials,
  createManaWgClient,
  type ManaWgClient,
  sessionCredentials,
} from './manawg-client.js';
import { supabaseTokenVerifier } from './oauth.js';
import { buildServer } from './server.js';

/**
 * One MCP server per serving unit. In session mode every instance shares the server's own
 * signed-in account; in OAuth mode each request acts for the user whose token it carries.
 */
export function serverFactory(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): McpServerFactory {
  const options = { allowDestructive: config.allowDestructive };
  if (config.auth.mode === 'session') {
    const client = createManaWgClient(
      config,
      fetchImpl,
      sessionCredentials(createSessionController(config.auth, fetchImpl, config.timeoutMs)),
    );
    return () => buildServer(client, options);
  }
  return ({ authInfo }) => {
    if (!authInfo) {
      // The bearer gate runs before any server is built; reaching this is a wiring bug.
      throw new Error('oauth request without verified token');
    }
    const client: ManaWgClient = createManaWgClient(
      config,
      fetchImpl,
      bearerCredentials(authInfo.token),
    );
    return buildServer(client, options);
  };
}

export function httpAuth(config: AppConfig): HttpAuth {
  if (config.auth.mode === 'oauth') {
    return { kind: 'oauth', oauth: config.auth, verifier: supabaseTokenVerifier(config.auth) };
  }
  return config.http.apiKey ? { kind: 'api-key', apiKey: config.http.apiKey } : { kind: 'open' };
}

export function httpHandlerOptions(
  config: AppConfig,
  onServerError: (error: Error) => void,
): HttpHandlerOptions {
  return {
    path: config.http.path,
    auth: httpAuth(config),
    cors: config.http.cors,
    createServer: serverFactory(config),
    onServerError,
  };
}
