import { afterEach, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/app.js';

const open: Harness[] = [];

afterEach(async () => {
  while (open.length > 0) {
    await open.pop()?.close();
  }
});

// Clients (VS Code, Claude Desktop) fill `{id}` in a resource template from resources/list and
// completion. A template without both is a dead end, and a failing enumeration must not take the
// other resources down.
it('lists and completes the entities behind a resource template, failing soft', async () => {
  const h = await startHarness();
  open.push(h);
  const chore = await h.call('chore_create', {
    title: 'Bathroom',
    nextDueAt: '2026-12-01T09:00:00Z',
  });
  const id = (chore.chore as { id: string }).id;

  // The stub app has no events route: that template lists nothing, the chore one still works.
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
