import { createHash } from "node:crypto";

/**
 * Canonical JSON text of a snapshot: object keys sorted at every level, no whitespace. The SAME string is hashed, measured
 * and bound to the INSERT (as a `::jsonb` parameter), so `contentHash` and `snapshotBytes` describe exactly what was sent.
 * PostgreSQL JSONB stores a normalised binary form of it (key order, spacing, numeric forms); its physical size differs.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

export interface SerializedSnapshot {
  text: string;
  bytes: number;
  hash: string;
}

export function serializeSnapshot(value: unknown): SerializedSnapshot {
  const text = canonicalize(value);
  return { text, bytes: Buffer.byteLength(text, "utf8"), hash: createHash("sha256").update(text, "utf8").digest("hex") };
}

/** First path holding text JSONB cannot store (NUL or a lone surrogate), or null. */
export function findUnstorableText(value: unknown, path = "$"): string | null {
  if (typeof value === "string") return value.includes("\u0000") || !value.isWellFormed() ? path : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findUnstorableText(value[i], `${path}[${i}]`);
      if (r) return r;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.includes("\u0000") || !k.isWellFormed()) return `${path}.${k}`;
      const r = findUnstorableText(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}
