import { expect, it } from 'vitest';
import { capPayload } from '../src/payload.js';

it('passes small payloads through untouched', () => {
  const payload = { expenses: [{ id: 'a' }], payments: [] };
  const result = capPayload(payload, { maxItems: 10, maxBytes: 1000 });
  expect(result).toEqual({ payload, truncated: false });
});

it('caps top-level arrays at maxItems and announces the fields', () => {
  const result = capPayload(
    { expenses: Array.from({ length: 30 }, (_, i) => i), payments: [1, 2] },
    { maxItems: 10 },
  );
  expect(result.truncated).toBe(true);
  const payload = result.payload as Record<string, unknown>;
  expect((payload.expenses as unknown[]).length).toBe(10);
  expect(payload.payments).toEqual([1, 2]);
  expect(payload._mcp).toEqual({ truncated: true, fields: ['expenses'] });
});

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

it('falls back to an oversized envelope when arrays cannot absorb the cap', () => {
  const result = capPayload({ blob: 'x'.repeat(2000) }, { maxBytes: 100 });
  expect(result.truncated).toBe(true);
  const payload = result.payload as Record<string, unknown>;
  expect(payload.blob).toBeUndefined();
  expect(payload._mcp).toMatchObject({ truncated: true, oversized: true });
});

it('ignores non-object payloads', () => {
  expect(capPayload('raw', { maxBytes: 1 })).toEqual({ payload: 'raw', truncated: false });
  expect(capPayload([1, 2, 3], { maxItems: 1 })).toEqual({
    payload: [1, 2, 3],
    truncated: false,
  });
});
