import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { describeError } from './errors.js';
import { isUuid } from './ids.js';
import type { ManaWgClient, WgRequest } from './manawg-client.js';
import { capPayload, DEFAULT_MAX_BYTES, isRecord, type PayloadLimits } from './payload.js';
import type { PromptDef } from './prompts.js';
import type { ResourceDef, ResourceTemplateDef } from './resources.js';
import type { ToolDef } from './tools/types.js';

const JSON_MIME = 'application/json';

/** Fetches a route and returns it as a bounded JSON resource body, with sanitized failures. */
async function readJsonResource(
  client: ManaWgClient,
  request: WgRequest,
  uri: URL,
  limits: PayloadLimits = {},
) {
  try {
    const payload = await client.call(request);
    const capped = capPayload(payload, { maxBytes: DEFAULT_MAX_BYTES, ...limits });
    return {
      contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(capped.payload) }],
    };
  } catch (error) {
    throw new Error(describeError(error));
  }
}

export function registerResource(server: McpServer, client: ManaWgClient, def: ResourceDef): void {
  server.registerResource(
    def.name,
    def.uri,
    { title: def.title, description: def.description, mimeType: JSON_MIME },
    (uri) =>
      readJsonResource(
        client,
        {
          method: 'GET',
          path: def.path,
          ...(def.scope ? { scope: def.scope } : {}),
          ...(def.query ? { query: def.query } : {}),
        },
        uri,
        def.limits,
      ),
  );
}

export function registerEntityResource(
  server: McpServer,
  client: ManaWgClient,
  def: ResourceTemplateDef,
): void {
  server.registerResource(
    def.name,
    new ResourceTemplate(def.uriTemplate, { list: undefined }),
    { title: def.title, description: def.description, mimeType: JSON_MIME },
    (uri, variables) => {
      const id = variables.id;
      if (!isUuid(id)) {
        throw new Error(describeError(undefined));
      }
      return readJsonResource(client, { method: 'GET', path: def.path(id) }, uri);
    },
  );
}

export function registerPrompt(server: McpServer, def: PromptDef): void {
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

export function registerTool(server: McpServer, client: ManaWgClient, def: ToolDef): void {
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
    // The SDK has already validated `args` against `def.input` at this point.
    async (args) => {
      const request: WgRequest = {
        method: def.method,
        path: def.path(args),
        ...(def.scope ? { scope: def.scope } : {}),
        ...(def.query ? { query: def.query(args) } : {}),
        ...(def.body ? { body: def.body(args) } : {}),
      };
      try {
        const upstream = await client.call(request);
        const shaped = def.transform ? def.transform(args, upstream) : upstream;
        const { payload } = capPayload(shaped, { maxBytes: DEFAULT_MAX_BYTES });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
          ...(isRecord(payload) ? { structuredContent: payload } : {}),
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: describeError(error) }],
        };
      }
    },
  );
}
