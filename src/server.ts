import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

type ManaWgClient = {
  getDashboard(): Promise<unknown>;
  getShopping(): Promise<unknown>;
  addShoppingItem(input: { name: string; quantity?: string }): Promise<unknown>;
  completeChore(choreId: string): Promise<unknown>;
};

const shoppingAddSchema = z.object({
  name: z.string().min(1),
  quantity: z.string().min(1).optional(),
});

const choreCompleteSchema = z.object({
  choreId: z.string().min(1),
});

export function buildServer(client: ManaWgClient): McpServer {
  const server = new McpServer({ name: 'manawg-mcp', version: '0.1.0' });

  server.registerResource(
    'current_dashboard',
    'manawg://current/dashboard',
    { title: 'Current ManaWG dashboard', mimeType: 'application/json' },
    async (uri) => jsonResource(uri, await client.getDashboard()),
  );

  server.registerResource(
    'current_shopping',
    'manawg://current/shopping',
    { title: 'Current ManaWG shopping list', mimeType: 'application/json' },
    async (uri) => jsonResource(uri, await client.getShopping()),
  );

  server.registerTool(
    'shopping_add',
    {
      title: 'Add shopping item',
      inputSchema: shoppingAddSchema,
    },
    async (input) => toolResult('Shopping item added', client.addShoppingItem(input)),
  );

  server.registerTool(
    'chore_complete',
    {
      title: 'Complete chore',
      inputSchema: choreCompleteSchema,
    },
    async ({ choreId }) => toolResult('Chore completed', client.completeChore(choreId)),
  );

  return server;
}

function jsonResource(uri: URL, payload: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(payload),
      },
    ],
  };
}

async function toolResult(text: string, action: Promise<unknown>) {
  try {
    const payload = await action;
    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: payload,
    };
  } catch {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'ManaWG request failed' }],
    };
  }
}
