import { expect, it } from 'vitest';
import { capPayload } from '../src/payload.js';

it('shrinks the largest array until the byte cap holds', () => {
  const result = capPayload(
    { expenses: Array.from({ length: 500 }, (_, i) => ({ id: `e${i}`, pad: 'x'.repeat(50) })) },
    { maxBytes: 5000 },
  );
  expect(result.truncated).toBe(true);
  const json = JSON.stringify(result.payload);
  expect(json.length).toBeLessThanOrEqual(5000);
  const payload = result.payload as Record<string, unknown>;
  expect((payload.expenses as unknown[]).length).toBeLessThan(500);
  expect((payload._mcp as { truncated: boolean }).truncated).toBe(true);
});

it('shortens an oversized string field such as a CSV export and announces it', () => {
  const result = capPayload(
    { content: 'row\n'.repeat(5000), contentType: 'text/csv' },
    { maxBytes: 1000 },
  );
  expect(result.truncated).toBe(true);
  const payload = result.payload as Record<string, unknown>;
  expect(JSON.stringify(payload).length).toBeLessThanOrEqual(1000);
  expect(payload.contentType).toBe('text/csv');
  expect(payload._mcp).toMatchObject({ truncated: true, fields: ['content'] });
});

it('falls back to an oversized envelope when nothing can be shortened', () => {
  const nested = { a: { b: 'x'.repeat(2000) } };
  const result = capPayload(nested, { maxBytes: 100 });
  expect(result.truncated).toBe(true);
  const payload = result.payload as Record<string, unknown>;
  expect(payload.a).toBeUndefined();
  expect(payload._mcp).toMatchObject({ truncated: true, oversized: true });
});
