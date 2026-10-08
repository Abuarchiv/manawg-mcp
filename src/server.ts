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
import { TOOL_DEFS, selectTools } from './tools/registry.js';
import { serverVersion } from './version.js';

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
