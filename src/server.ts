import { McpServer } from '@modelcontextprotocol/server';
import type { ManaWgClient, WgRequest } from './manawg-client.js';
import { ManaWgError } from './manawg-client.js';
import { RESOURCE_DEFS, type ResourceDef } from './resources.js';
import { TOOL_DEFS, type ToolDef, selectTools } from './tools/registry.js';

const SAFE_ERROR_MESSAGE = 'ManaWG request failed';

export type ServerOptions = {
  allowDestructive?: boolean;
};

export function buildServer(client: ManaWgClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'manawg-mcp', version: '0.1.0' });

  for (const def of RESOURCE_DEFS) {
    registerResource(server, client, def);
  }

  for (const def of selectTools(TOOL_DEFS, options.allowDestructive ?? false)) {
    registerTool(server, client, def);
  }

  return server;
}

function registerResource(server: McpServer, client: ManaWgClient, def: ResourceDef): void {
  server.registerResource(
    def.name,
    def.uri,
    { title: def.title, description: def.description, mimeType: 'application/json' },
    async (uri) => {
      const request: WgRequest = { method: 'GET', path: def.path };
      if (def.query) {
        request.query = def.query;
      }
      try {
        const payload = await client.call(request);
        return {
          contents: [
            { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload) },
          ],
        };
      } catch {
        throw new Error(SAFE_ERROR_MESSAGE);
      }
    },
  );
}

function registerTool(server: McpServer, client: ManaWgClient, def: ToolDef): void {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: {
        readOnlyHint: def.method === 'GET',
        destructiveHint: def.gate === 'destructive',
        idempotentHint: def.method === 'GET',
      },
    },
    async (args) => {
      const parsed = def.input.safeParse(args);
      if (!parsed.success) {
        return errorResult(`invalid_input: ${issueSummary(parsed.error.issues)}`);
      }

      const request: WgRequest = { method: def.method, path: def.path(parsed.data) };
      if (def.query) {
        request.query = def.query(parsed.data);
      }
      if (def.body) {
        request.body = def.body(parsed.data);
      }

      try {
        const payload = await client.call(request);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          ...(isRecord(payload) ? { structuredContent: payload } : {}),
        };
      } catch (error) {
        return errorResult(describeError(error));
      }
    },
  );
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

function describeError(error: unknown): string {
  if (error instanceof ManaWgError) {
    let message = `${SAFE_ERROR_MESSAGE}: ${error.code}`;
    if (error.details) {
      message = `${message} (${error.details})`;
    }
    if (error.retryAfterSeconds !== undefined) {
      message = `${message} retry_after_s=${error.retryAfterSeconds}`;
    }
    return message;
  }
  return SAFE_ERROR_MESSAGE;
}

function issueSummary(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`)
    .join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
