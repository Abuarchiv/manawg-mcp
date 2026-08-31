import { Client, InMemoryTransport, type Transport } from '@modelcontextprotocol/client';
import { afterEach, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';

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

async function connectTestServer(server: unknown) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'manawg-mcp-test', version: '0.0.0' });

  await Promise.all([
    client.connect(clientTransport),
    (server as { connect: (transport: Transport) => Promise<void> }).connect(serverTransport),
  ]);

  cleanup.push(() => client.close());
  cleanup.push(() => (server as { close?: () => Promise<void> | void }).close?.());

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
