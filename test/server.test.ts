import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';

const SECRET = 's'.repeat(64);

type TestManaWgClient = {
  getDashboard: ReturnType<typeof vi.fn>;
  getShopping: ReturnType<typeof vi.fn>;
  addShoppingItem: ReturnType<typeof vi.fn>;
  completeChore: ReturnType<typeof vi.fn>;
};

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()!();
  }
});

function fakeManaWgClient(): TestManaWgClient {
  return {
    getDashboard: vi.fn().mockResolvedValue({ today: [] }),
    getShopping: vi.fn().mockResolvedValue({ items: [] }),
    addShoppingItem: vi.fn().mockResolvedValue({ item: { name: 'Milch', quantity: '2' } }),
    completeChore: vi.fn().mockResolvedValue({ chore: { id: 'chore-1', completed: true } }),
  };
}

async function connectTestServer(server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'manawg-mcp-test', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  cleanup.push(() => client.close());
  cleanup.push(() => server.close());

  return client;
}

it('exposes exactly the v1 resources and tools', async () => {
  const client = await connectTestServer(buildServer(fakeManaWgClient()));

  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
    'shopping_add',
    'chore_complete',
  ]);
  expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual([
    'manawg://current/dashboard',
    'manawg://current/shopping',
  ]);
});

it('calls shopping_add with validated input', async () => {
  const fake = fakeManaWgClient();
  const client = await connectTestServer(buildServer(fake));

  await client.callTool({ name: 'shopping_add', arguments: { name: 'Milch', quantity: '2' } });

  expect(fake.addShoppingItem).toHaveBeenCalledWith({ name: 'Milch', quantity: '2' });
});

it('reads the current dashboard resource as JSON', async () => {
  const fake = fakeManaWgClient();
  const client = await connectTestServer(buildServer(fake));

  const result = await client.readResource({ uri: 'manawg://current/dashboard' });

  expect(result.contents).toEqual([
    {
      uri: 'manawg://current/dashboard',
      mimeType: 'application/json',
      text: JSON.stringify({ today: [] }),
    },
  ]);
  expect(fake.getDashboard).toHaveBeenCalledOnce();
});

it('reads the current shopping resource as JSON', async () => {
  const fake = fakeManaWgClient();
  const client = await connectTestServer(buildServer(fake));

  const result = await client.readResource({ uri: 'manawg://current/shopping' });

  expect(result.contents).toEqual([
    {
      uri: 'manawg://current/shopping',
      mimeType: 'application/json',
      text: JSON.stringify({ items: [] }),
    },
  ]);
  expect(fake.getShopping).toHaveBeenCalledOnce();
});

it('calls chore_complete with validated input', async () => {
  const fake = fakeManaWgClient();
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name: 'chore_complete', arguments: { choreId: 'chore-1' } });

  expect(fake.completeChore).toHaveBeenCalledWith('chore-1');
  expect(result.structuredContent).toEqual({ chore: { id: 'chore-1', completed: true } });
});

it.each([
  ['shopping_add invalid name', 'shopping_add', { name: '', quantity: '2' }, 'addShoppingItem'],
  ['shopping_add invalid quantity', 'shopping_add', { name: 'Milch', quantity: '' }, 'addShoppingItem'],
  ['chore_complete invalid choreId', 'chore_complete', { choreId: '' }, 'completeChore'],
] as const)('rejects %s at the MCP boundary', async (_label, name, input, method) => {
  const fake = fakeManaWgClient();
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name, arguments: input });

  expect(result.isError).toBe(true);
  expect(fake[method]).not.toHaveBeenCalled();
});

it.each([
  ['shopping_add', { name: 'Milch' }, 'addShoppingItem'],
  ['chore_complete', { choreId: 'chore-1' }, 'completeChore'],
] as const)('returns a safe tool error for %s client failures', async (name, input, method) => {
  const fake = fakeManaWgClient();
  fake[method].mockRejectedValue(new Error(`leaked ${SECRET} https://example.test/api/wg/WG123`));
  const client = await connectTestServer(buildServer(fake));

  const result = await client.callTool({ name, arguments: input });

  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: 'ManaWG request failed' }]);
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(JSON.stringify(result)).not.toContain('https://example.test');
});
