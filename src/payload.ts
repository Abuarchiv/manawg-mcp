export type PayloadLimits = {
  /** Longest array kept per top-level field. */
  maxItems?: number;
  /** Ceiling for the serialized payload in UTF-8 bytes, `_mcp` marker included. */
  maxBytes?: number;
};

const META_KEY = '_mcp';
export const DEFAULT_MAX_BYTES = 100_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const arrayLength = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const stringLength = (value: unknown) => (typeof value === 'string' ? value.length : 0);

/** Only fields that can still lose something count: a one-item array cannot shrink further. */
function largestField(
  record: Record<string, unknown>,
  measure: (value: unknown) => number,
): string | undefined {
  let name: string | undefined;
  let size = 1;
  for (const [key, value] of Object.entries(record)) {
    if (measure(value) > size) {
      name = key;
      size = measure(value);
    }
  }
  return name;
}

function halve<T extends unknown[] | string>(value: T): T {
  return value.slice(0, Math.max(1, Math.floor(value.length / 2))) as T;
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/**
 * Bounds a route payload before it reaches the model: per-field item caps first,
 * then a byte cap that halves the largest array (or, failing that, the largest
 * string such as a CSV export) until the JSON fits. Truncation is always
 * announced through the `_mcp` marker, so data is never silently cut.
 */
export function capPayload(payload: unknown, limits: PayloadLimits): unknown {
  const { maxItems, maxBytes } = limits;
  if (!isRecord(payload)) {
    return payload;
  }

  const out: Record<string, unknown> = { ...payload };
  const fields = new Set<string>();

  if (maxItems !== undefined) {
    for (const [key, value] of Object.entries(out)) {
      if (Array.isArray(value) && value.length > maxItems) {
        out[key] = value.slice(0, maxItems);
        fields.add(key);
      }
    }
  }

  const marked = () =>
    fields.size > 0 ? { ...out, [META_KEY]: { truncated: true, fields: [...fields] } } : out;

  if (maxBytes !== undefined) {
    while (byteSize(marked()) > maxBytes) {
      const target = largestField(out, arrayLength) ?? largestField(out, stringLength);
      if (!target) {
        const meta = { truncated: true, oversized: true, originalBytes: byteSize(payload) };
        return { [META_KEY]: meta };
      }
      out[target] = halve(out[target] as unknown[] | string);
      fields.add(target);
    }
  }

  return marked();
}
