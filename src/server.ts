import { createRequire } from 'node:module';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { ManaWgClient, WgRequest } from './manawg-client.js';
import { ManaWgError } from './manawg-client.js';
import { DEFAULT_MAX_BYTES, capPayload } from './payload.js';
import { PROMPT_DEFS } from './prompts.js';
import {
  RESOURCE_DEFS,
  RESOURCE_TEMPLATE_DEFS,
  type ResourceDef,
  type ResourceTemplateDef,
} from './resources.js';
import { TOOL_DEFS, type ToolDef, selectTools } from './tools/registry.js';

const SAFE_ERROR_MESSAGE = 'ManaWG request failed';

export function serverVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export type ServerOptions = {
  allowDestructive?: boolean;
};

export function buildServer(client: ManaWgClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'manawg-mcp', version: serverVersion() });

  for (const def of RESOURCE_DEFS) {
    registerResource(server, client, def);
  }

  for (const def of RESOURCE_TEMPLATE_DEFS) {
    registerEntityResource(server, client, def);
  }

  for (const def of PROMPT_DEFS) {
    registerPrompt(server, def);
  }

  for (const def of selectTools(TOOL_DEFS, options.allowDestructive ?? false)) {
    registerTool(server, client, def);
  }

  return server;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerEntityResource(
  server: McpServer,
  client: ManaWgClient,
  def: ResourceTemplateDef,
): void {
  server.registerResource(
    def.name,
    new ResourceTemplate(def.uriTemplate, { list: undefined }),
    { title: def.title, description: def.description, mimeType: 'application/json' },
    async (uri, variables) => {
      const id = variables.id;
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
        throw new Error(SAFE_ERROR_MESSAGE);
      }
      try {
        const payload = await client.call({ method: 'GET', path: def.path(id) });
        const capped = capPayload(payload, { maxBytes: DEFAULT_MAX_BYTES });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(capped.payload),
            },
          ],
        };
      } catch (error) {
        throw new Error(describeError(error));
      }
    },
  );
}

function registerPrompt(server: McpServer, def: (typeof PROMPT_DEFS)[number]): void {
  server.registerPrompt(
    def.name,
    { title: def.title, description: def.description, argsSchema: def.args },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: def.render((args ?? {}) as Record<string, string | undefined>),
          },
        },
      ],
    }),
  );
}

function registerResource(server: McpServer, client: ManaWgClient, def: ResourceDef): void {
  server.registerResource(
    def.name,
    def.uri,
    { title: def.title, description: def.description, mimeType: 'application/json' },
    async (uri) => {
      const request: WgRequest = { method: 'GET', path: def.path };
      if (def.scope) {
        request.scope = def.scope;
      }
      if (def.query) {
        request.query = def.query;
      }
      try {
        const payload = await client.call(request);
        const capped = capPayload(payload, {
          maxBytes: DEFAULT_MAX_BYTES,
          ...def.limits,
        });
        return {
          contents: [
            { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(capped.payload) },
          ],
        };
      } catch (error) {
        throw new Error(describeError(error));
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
        readOnlyHint: def.readOnly ?? def.method === 'GET',
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
      if (def.scope) {
        request.scope = def.scope;
      }
      if (def.query) {
        request.query = def.query(parsed.data);
      }
      if (def.body) {
        request.body = def.body(parsed.data);
      }

      try {
        const upstream = await client.call(request);
        const transformed = def.transform ? def.transform(parsed.data, upstream) : upstream;
        const { payload } = capPayload(transformed, { maxBytes: DEFAULT_MAX_BYTES });
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
