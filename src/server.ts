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
import { type ToolsetName, toolsetEnabled } from './toolsets.js';
import { serverVersion } from './version.js';

type ServerOptions = {
  allowDestructive?: boolean;
  /** MANAWG_TOOLSETS: register only these tool groups (plus `overview`); all when unset. */
  toolsets?: readonly ToolsetName[];
};

/**
 * Sent once at initialize: what an agent needs before its first call. Names only the tools
 * `registered` holds, so MANAWG_TOOLSETS and the destructive gate never point at a missing one.
 */
function serverInstructions(registered: ReadonlySet<string>): string {
  const has = (name: string) => registered.has(name);
  const notifiers = ['chat_send', 'reminder_send', 'invite_email'].filter(has);
  const recorders = ['settlement_commit', 'cash_payment_record'].filter(has);
  const lines = [
    '- Start with wg_overview: it names the flat, its members and you (currentMember). Use member ids from there; never guess them.',
    '- If the account belongs to several flats, call wg_list and pass the code as wgCode to every call. With one flat, leave wgCode out.',
    '- Money is in integer cents (amountCents). Expense splits must add up to amountCents exactly.',
    '- Writes that take expected* fields guard against concurrent edits: read first, pass the values unchanged, and on a *_changed error read again and ask before retrying.',
  ];
  if (recorders.length > 0) {
    const preview = has('settlement_commit') ? '; preview with settlement_preview first' : '';
    lines.push(
      `- ManaWG never moves money. ${recorders.join(' and ')} only record what already happened${preview}.`,
    );
  }
  const examples = notifiers.length > 0 ? ` (${notifiers.join(', ')})` : '';
  lines.push(
    `- Confirm with the user before anything that notifies other people${examples} or deletes data.`,
    '- Errors read "ManaWG request failed: <code>"; the code says what went wrong, some add what to do next.',
  );
  return `ManaWG is a shared-flat household app: expenses and balances, cleaning rota, shopping list, pantry, notes, chat and calendar. You act as the signed-in member.\n\n${lines.join('\n')}`;
}

export const SERVER_DESCRIPTION =
  'Shared-flat app ManaWG: expenses, cleaning rota, shopping list, calendar and chat for agents.';

export const SERVER_ICONS = [
  { src: 'https://manawg.com/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] },
  { src: 'https://manawg.com/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
];

/**
 * Tool, prompt and template lists are fixed for the life of the process, so clients may cache
 * them for an hour. Resource listing and reads differ per user and stay uncached.
 */
const STATIC_LIST = { ttlMs: 3_600_000, cacheScope: 'public' } as const;
const STATIC_LIST_CACHE = {
  'tools/list': STATIC_LIST,
  'prompts/list': STATIC_LIST,
  'resources/templates/list': STATIC_LIST,
  'server/discover': STATIC_LIST,
};

export function buildServer(client: ManaWgClient, options: ServerOptions = {}): McpServer {
  const tools = selectTools(TOOL_DEFS, options.allowDestructive ?? false, options.toolsets);
  const server = new McpServer(
    {
      name: 'manawg-mcp',
      title: 'ManaWG',
      version: serverVersion(),
      description: SERVER_DESCRIPTION,
      websiteUrl: 'https://manawg.com',
      icons: SERVER_ICONS,
    },
    {
      instructions: serverInstructions(new Set(tools.map((tool) => tool.name))),
      cacheHints: STATIC_LIST_CACHE,
    },
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
  for (const def of tools) {
    registerTool(server, client, def);
  }

  return server;
}
