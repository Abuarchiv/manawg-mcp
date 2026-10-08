export type PayloadLimits = {
  /** Longest array kept per top-level field. */
  maxItems?: number;
  /** Serialized ceiling; arrays shrink from the largest one until it fits. */
  maxBytes?: number;
};

export type CapResult = { payload: unknown; truncated: boolean };

const META_KEY = '_mcp';
export const DEFAULT_MAX_BYTES = 100_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function largestArrayField(record: Record<string, unknown>): string | undefined {
  let name: string | undefined;
  let size = 0;
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value) && value.length > size) {
      name = key;
      size = value.length;
    }
  }
  return name;
}

function largestStringField(record: Record<string, unknown>): string | undefined {
  let name: string | undefined;
  let size = 1;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > size) {
      name = key;
      size = value.length;
    }
  }
  return name;
}

/**
 * Bounds a route payload before it reaches the model: per-field item caps first,
 * then a byte cap that halves the largest array (or, failing that, the largest
 * string such as a CSV export) until the JSON fits. Truncation
 * is always announced through the `_mcp` marker — data is never silently cut.
 */
export function capPayload(payload: unknown, limits: PayloadLimits): CapResult {
  const { maxItems, maxBytes } = limits;
  if (!isRecord(payload)) {
    return { payload, truncated: false };
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

  if (maxBytes !== undefined) {
    let json = JSON.stringify(out);
    while (json.length > maxBytes) {
      const biggest = largestArrayField(out);
      if (!biggest) {
        const text = largestStringField(out);
        if (text) {
          const value = out[text] as string;
          out[text] = value.slice(0, Math.max(1, Math.floor(value.length / 2)));
          fields.add(text);
          json = JSON.stringify(out);
          continue;
        }
        return {
          payload: {
            [META_KEY]: { truncated: true, oversized: true, originalBytes: json.length },
          },
          truncated: true,
        };
      }
      const array = out[biggest] as unknown[];
      out[biggest] = array.slice(0, Math.max(1, Math.floor(array.length / 2)));
      fields.add(biggest);
      json = JSON.stringify(out);
    }
  }

  if (fields.size > 0) {
    out[META_KEY] = { truncated: true, fields: [...fields] };
  }
  return { payload: out, truncated: fields.size > 0 };
}
