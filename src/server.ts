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
import { serverVersion } from './version.js';

export type ServerOptions = {
  allowDestructive?: boolean;
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

export function buildServer(client: ManaWgClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'manawg-mcp', title: 'ManaWG', version: serverVersion() },
    { instructions: SERVER_INSTRUCTIONS },
  );

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
