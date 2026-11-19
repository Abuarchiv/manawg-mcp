import { afterEach, expect, it, vi } from 'vitest';
import { useHarness } from './helpers/app.js';

const harness = useHarness();

afterEach(() => {
  vi.restoreAllMocks();
});

// Clients (VS Code, Claude Desktop) fill `{id}` in a resource template from resources/list and
// completion. A template without both is a dead end, and a failing enumeration must not take the
// other resources down.
it('lists and completes the entities behind a resource template, failing soft', async () => {
  const h = await harness();
  const chore = await h.call('chore_create', {
    title: 'Bathroom',
    nextDueAt: '2026-12-01T09:00:00Z',
  });
  const id = (chore.chore as { id: string }).id;

  // The stub app has no events: that template lists nothing, the chore one still works.
  const { resources } = await h.client.listResources();
  const entities = resources.filter((resource) =>
    resource.uri.startsWith('manawg://current/chore/'),
  );
  expect(entities).toEqual([
    expect.objectContaining({ uri: `manawg://current/chore/${id}`, name: 'Bathroom' }),
  ]);

  const completion = await h.client.complete({
    ref: { type: 'ref/resource', uri: 'manawg://current/chore/{id}' },
    argument: { name: 'id', value: id.slice(0, 12) },
  });
  expect(completion.completion.values).toEqual([id]);
  const none = await h.client.complete({
    ref: { type: 'ref/resource', uri: 'manawg://current/event/{id}' },
    argument: { name: 'id', value: '' },
  });
  expect(none.completion.values).toEqual([]);
});

it('logs why a resource listing or read failed while answering the client without the cause', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const h = await harness();

  const missing = '00000000-0000-4000-8000-0000000000ff';
  await expect(h.client.readResource({ uri: `manawg://current/chore/${missing}` })).rejects.toThrow(
    'ManaWG request failed: chore_not_found',
  );
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining(`failure source=resources/read manawg://current/chore/${missing}`),
  );

  await h.app.goOffline();
  await expect(h.client.listResources()).resolves.toBeDefined();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('failure source=resources/list event'));
});

it('names the reason when a resource id is not a UUID', async () => {
  const h = await harness();

  await expect(h.client.readResource({ uri: 'manawg://current/chore/not-a-uuid' })).rejects.toThrow(
    'ManaWG request failed: id_invalid',
  );
});
