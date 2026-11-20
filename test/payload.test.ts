import { expect, it } from 'vitest';
import { capPayload } from '../src/payload.js';

it('shrinks the largest array until the byte cap holds', () => {
  const result = capPayload(
    { expenses: Array.from({ length: 500 }, (_, i) => ({ id: `e${i}`, pad: 'x'.repeat(50) })) },
    { maxBytes: 5000 },
  );
  const json = JSON.stringify(result);
  expect(json.length).toBeLessThanOrEqual(5000);
  const payload = result as Record<string, unknown>;
  expect((payload.expenses as unknown[]).length).toBeLessThan(500);
  expect((payload._mcp as { truncated: boolean }).truncated).toBe(true);
});

it('shortens an oversized string field such as a CSV export and announces it', () => {
  const result = capPayload(
    { content: 'row\n'.repeat(5000), contentType: 'text/csv' },
    { maxBytes: 1000 },
  );
  const payload = result as Record<string, unknown>;
  expect(JSON.stringify(payload).length).toBeLessThanOrEqual(1000);
  expect(payload.contentType).toBe('text/csv');
  expect(payload._mcp).toMatchObject({ truncated: true, fields: ['content'] });
});

it('falls back to an oversized envelope when nothing can be shortened', () => {
  const nested = { a: { b: 'x'.repeat(2000) } };
  const result = capPayload(nested, { maxBytes: 100 });
  const payload = result as Record<string, unknown>;
  expect(payload.a).toBeUndefined();
  expect(payload._mcp).toMatchObject({ truncated: true, oversized: true });
});

it('terminates when every array is down to one item and the payload is still too big', () => {
  const memberMapping = Object.fromEntries(
    Array.from({ length: 4000 }, (_, i) => [`Person Number ${i} Surname`, null]),
  );
  const result = capPayload(
    { parsed: [{ a: 1 }, { a: 2 }], memberMapping, payloadHash: 'h' },
    { maxBytes: 100_000 },
  );
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(100_000);
  expect(result).toMatchObject({ _mcp: { truncated: true, oversized: true } });
});

it('shortens a long string even while a one-item array sits next to it', () => {
  const result = capPayload({ rows: [{ a: 1 }], content: 'x'.repeat(5000) }, { maxBytes: 1000 });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
  expect(result).toMatchObject({ _mcp: { truncated: true, fields: ['content'] } });
});

it('measures the cap in UTF-8 bytes, not characters', () => {
  const messages = [{ text: '🏠'.repeat(300) }, { text: '🏠'.repeat(300) }];

  const payload = capPayload({ messages }, { maxBytes: 2000 });

  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(2000);
  expect(payload).toMatchObject({ _mcp: { truncated: true, fields: ['messages'] } });
});

it('counts the _mcp marker against the cap', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: i }));
  const fitsWithoutMarker = Buffer.byteLength(JSON.stringify({ rows: rows.slice(0, 10) }));
  const maxBytes = fitsWithoutMarker + 5;

  const payload = capPayload({ rows }, { maxItems: 10, maxBytes });

  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(maxBytes);
  expect(payload).toMatchObject({ _mcp: { truncated: true, fields: ['rows'] } });
});

it('reports the size of the original payload when nothing can be shortened', () => {
  const nested = { a: { b: 'ü'.repeat(2000) } };
  const payload = capPayload(nested, { maxBytes: 100 });
  expect(payload).toMatchObject({
    _mcp: { oversized: true, originalBytes: Buffer.byteLength(JSON.stringify(nested)) },
  });
});
