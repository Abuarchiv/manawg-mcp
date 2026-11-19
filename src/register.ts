import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { SHARE_CODE_PATTERN } from './config.js';
import { describeError, describeFailure } from './errors.js';
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

/** Resources listed per template: enough to pick from, cheap to fetch on every resources/list. */
const ENTITY_LIST_LIMIT = 50;

type EntityRef = { id: string; label: string };

/**
 * Enumerates the entities behind a template for resources/list and id completion. Failures give
 * an empty list: an account without a unique flat, a rate limit or an outage must not break
 * listing the other resources.
 */
async function listEntities(client: ManaWgClient, def: ResourceTemplateDef): Promise<EntityRef[]> {
  try {
    const payload = await client.call({
      method: 'GET',
      path: def.list.path,
      ...(def.list.query ? { query: def.list.query } : {}),
    });
    const items = isRecord(payload) ? payload[def.list.key] : undefined;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (!isRecord(item) || !isUuid(item.id)) return [];
      const label = item[def.list.label];
      return [{ id: item.id, label: typeof label === 'string' && label ? label : item.id }];
    });
  } catch {
    return [];
  }
}

export function registerEntityResource(
  server: McpServer,
  client: ManaWgClient,
  def: ResourceTemplateDef,
): void {
  server.registerResource(
    def.name,
    new ResourceTemplate(def.uriTemplate, {
      list: async () => ({
        resources: (await listEntities(client, def)).slice(0, ENTITY_LIST_LIMIT).map((entity) => ({
          uri: def.uriTemplate.replace('{id}', entity.id),
          name: entity.label,
          mimeType: JSON_MIME,
        })),
      }),
      complete: {
        id: async (value) =>
          (await listEntities(client, def))
            .map((entity) => entity.id)
            .filter((id) => id.startsWith(value.toLowerCase())),
      },
    }),
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

const wgCodeInput = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SHARE_CODE_PATTERN)
  .optional()
  .describe(
    'Share code of the flat (code from wg_list). Leave it out when the account belongs to one flat.',
  );

/** WG-scoped tools take an optional `wgCode`, so one connection can serve several flats. */
function inputSchema(def: ToolDef): z.ZodType {
  if (def.scope === 'account') {
    return def.input;
  }
  if (!(def.input instanceof z.ZodObject)) {
    throw new Error(`${def.name}: tool input must be an object schema`);
  }
  // `safeExtend` keeps strictness and refinements (`extend` refuses refined objects).
  return def.input.safeExtend({ wgCode: wgCodeInput });
}

export function registerTool(server: McpServer, client: ManaWgClient, def: ToolDef): void {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: inputSchema(def),
      annotations: {
        readOnlyHint: def.readOnly ?? def.method === 'GET',
        destructiveHint: def.gate === 'destructive',
        idempotentHint: def.idempotent ?? def.method === 'GET',
      },
    },
    // The SDK has already validated `args` against `def.input` at this point.
    async (input, ctx) => {
      const { wgCode, ...args } = input as { wgCode?: string } & Record<string, unknown>;
      const request: WgRequest = {
        // A client that cancels or disconnects stops the upstream call and its retries.
        signal: ctx.mcpReq.signal,
        ...(wgCode ? { wgCode } : {}),
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
        console.error(describeFailure(def.name, error));
        return {
          isError: true,
          content: [{ type: 'text' as const, text: describeError(error) }],
        };
      }
    },
  );
}
