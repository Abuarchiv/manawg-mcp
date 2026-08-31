import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

type ManaWgClient = {
  getDashboard(): Promise<unknown>;
  getShopping(): Promise<unknown>;
  addShoppingItem(input: { name: string; quantity?: string }): Promise<unknown>;
  completeChore(choreId: string): Promise<unknown>;
};

const SAFE_ERROR_MESSAGE = 'ManaWG request failed';

const shoppingAddSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.string().trim().min(1).max(40).optional(),
});

const choreCompleteSchema = z.object({
  choreId: z.string().trim().uuid(),
});

export function buildServer(client: ManaWgClient): McpServer {
  const server = new McpServer({ name: 'manawg-mcp', version: '0.1.0' });

  server.registerResource(
    'current_dashboard',
    'manawg://current/dashboard',
    { title: 'Current ManaWG dashboard', mimeType: 'application/json' },
    async (uri) => safeJsonResource(uri, () => client.getDashboard()),
  );

  server.registerResource(
    'current_shopping',
    'manawg://current/shopping',
    { title: 'Current ManaWG shopping list', mimeType: 'application/json' },
    async (uri) => safeJsonResource(uri, () => client.getShopping()),
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

async function safeJsonResource(uri: URL, read: () => Promise<unknown>) {
  try {
    return jsonResource(uri, await read());
  } catch {
    throw new Error(SAFE_ERROR_MESSAGE);
  }
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
      content: [{ type: 'text' as const, text: SAFE_ERROR_MESSAGE }],
    };
  }
}
