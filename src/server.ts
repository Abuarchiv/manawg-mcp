import { McpServer } from '@modelcontextprotocol/server';
import type { ManaWgClient } from './manawg-client.js';
import { PROMPT_DEFS } from './prompts.js';
import {
  registerEntityResource,
  registerPrompt,
  registerResource,
  registerTool,
} from './register.js';
import { RESOURCE_DEFS, RESOURCE_TEMPLATE_DEFS } from './resources.js';
import { selectTools, TOOL_DEFS } from './tools/registry.js';
import { toolsetEnabled } from './toolsets.js';
import { serverVersion } from './version.js';

export type ServerOptions = {
  allowDestructive?: boolean;
  /** MANAWG_TOOLSETS: register only these tool groups (plus `overview`); all when unset. */
  toolsets?: readonly string[];
};

/** Sent once at initialize: what an agent needs before its first call. */
export const SERVER_INSTRUCTIONS = `ManaWG is a shared-flat household app: expenses and balances, cleaning rota, shopping list, pantry, notes, chat and calendar. You act as the signed-in member.

- Start with wg_overview: it names the flat, its members and you (currentMember). Use member ids from there; never guess them.
- If the account belongs to several flats, call wg_list and pass the code as wgCode to every call. With one flat, leave wgCode out.
- Money is in integer cents (amountCents). Expense splits must add up to amountCents exactly.
- Writes that take expected* fields guard against concurrent edits: read first, pass the values unchanged, and on a *_changed error read again and ask before retrying.
- ManaWG never moves money. settlement_commit and cash_payment_record only record what already happened; preview with settlement_preview first.
- Confirm with the user before anything that notifies other people (chat_send, reminder_send) or deletes data.
- Errors read "ManaWG request failed: <code>"; the code says what went wrong, some add what to do next.`;

const SERVER_ICONS = [
  { src: 'https://manawg.com/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] },
  { src: 'https://manawg.com/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
];

/**
 * Clients speaking the 2026-07-28 revision may cache these lists. They only change with a
 * release, so an hour is safe and spares a ~127 KB `tools/list` on every connection. The
 * per-user resource listing and `resources/read` stay uncached.
 */
const STATIC_LIST = { ttlMs: 3_600_000, cacheScope: 'public' } as const;
const STATIC_LIST_CACHE = {
  'tools/list': STATIC_LIST,
  'prompts/list': STATIC_LIST,
  'resources/templates/list': STATIC_LIST,
  'server/discover': STATIC_LIST,
};

export function buildServer(client: ManaWgClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: 'manawg-mcp',
      title: 'ManaWG',
      version: serverVersion(),
      description: 'Shared-flat app: expenses, cleaning rota, shopping, calendar, chat',
      websiteUrl: 'https://manawg.com',
      icons: SERVER_ICONS,
    },
    { instructions: SERVER_INSTRUCTIONS, cacheHints: STATIC_LIST_CACHE },
  );

  for (const def of RESOURCE_DEFS) {
    registerResource(server, client, def);
  }
  for (const def of RESOURCE_TEMPLATE_DEFS) {
    registerEntityResource(server, client, def);
  }
  for (const def of PROMPT_DEFS) {
    // A prompt that walks the agent through unregistered tools would only lead it astray.
    if (def.toolsets.every((toolset) => toolsetEnabled(toolset, options.toolsets))) {
      registerPrompt(server, def);
    }
  }
  for (const def of selectTools(TOOL_DEFS, options.allowDestructive ?? false, options.toolsets)) {
    registerTool(server, client, def);
  }

  return server;
}
