import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption for store secrets (phase 2.4, ADR 0002, D24-1). Every record gets its own random 256-bit data key (DEK); the value
 * is encrypted with AES-256-GCM under the DEK, and the DEK is encrypted ("wrapped") with AES-256-GCM under a master key that exists only
 * in the environment. Both encryptions carry associated data that binds them to the record's context (store + name), so a ciphertext
 * copied into another record fails authentication instead of decrypting. Rotating the master key re-wraps DEKs only.
 *
 * Wire format of `sealed` and `wrappedKey`: 12-byte IV || ciphertext || 16-byte GCM tag. Nothing here logs or returns key material.
 * Every Buffer holding a data key or a plaintext value is zeroed after use. JavaScript strings cannot be wiped: a plaintext value passed in
 * or returned as a string lives until garbage collection, so callers keep such strings short-lived and never log them.
 */

export interface MasterKeys {
  /** Id of the key new records are wrapped with. */
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface Envelope {
  keyId: string;
  wrappedKey: Buffer;
  sealed: Buffer;
}

/** Decryption failed: wrong or unknown key, tampered data, or a record moved to another context. The reason is never more specific. */
export class EnvelopeError extends Error {
  constructor() {
    super("secret could not be decrypted");
    this.name = "EnvelopeError";
  }
}

const IV = 12;
const TAG = 16;
const KEY = 32;

function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}

function open(key: Buffer, data: Buffer, aad: string): Buffer {
  if (data.length < IV + TAG) throw new EnvelopeError();
  try {
    const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, IV));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(data.subarray(data.length - TAG));
    const head = d.update(data.subarray(IV, data.length - TAG));
    const tail = d.final();
    const out = Buffer.concat([head, tail]);
    head.fill(0); // plaintext fragments are wiped; only `out` remains, owned and wiped by the caller
    tail.fill(0);
    return out;
  } catch {
    throw new EnvelopeError();
  }
}

const dekContext = (context: string) => `dek|${context}`;
const valueContext = (context: string) => `value|${context}`;

/** Encrypts `value` for `context` (e.g. "store:<id>|name:<name>") under the active master key. */
export function encrypt(keys: MasterKeys, context: string, value: string): Envelope {
  const master = keys.keys.get(keys.activeId);
  if (!master) throw new Error("active master key missing"); // configuration is validated at startup; this is a programming error
  const dek = randomBytes(KEY);
  const plain = Buffer.from(value, "utf8");
  try {
    return { keyId: keys.activeId, wrappedKey: seal(master, dek, dekContext(context)), sealed: seal(dek, plain, valueContext(context)) };
  } finally {
    dek.fill(0);
    plain.fill(0);
  }
}

export function decrypt(keys: MasterKeys, context: string, e: Envelope): string {
  const master = keys.keys.get(e.keyId);
  if (!master) throw new EnvelopeError();
  const dek = open(master, e.wrappedKey, dekContext(context));
  let plain: Buffer | null = null;
  try {
    plain = open(dek, e.sealed, valueContext(context));
    return plain.toString("utf8");
  } finally {
    dek.fill(0);
    plain?.fill(0);
  }
}

/** Re-wraps the record's DEK under the active master key (rotation). The sealed value is untouched. */
export function rewrap(keys: MasterKeys, context: string, e: Envelope): Envelope {
  if (e.keyId === keys.activeId) return e;
  const old = keys.keys.get(e.keyId);
  const active = keys.keys.get(keys.activeId);
  if (!old || !active) throw new EnvelopeError();
  const dek = open(old, e.wrappedKey, dekContext(context));
  try {
    return { keyId: keys.activeId, wrappedKey: seal(active, dek, dekContext(context)), sealed: e.sealed };
  } finally {
    dek.fill(0);
  }
}

export const KEY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Parses "id1:<base64 32 bytes>,id2:<base64>" + the active id. Problems name the variables only, never values.
 * Returns null when both variables are empty (feature off).
 */
export function parseMasterKeys(list: string | undefined, activeId: string | undefined): MasterKeys | { error: string } | null {
  const raw = (list ?? "").trim();
  const active = (activeId ?? "").trim();
  if (!raw && !active) return null;
  const keys = new Map<string, Buffer>();
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(":");
    const id = i > 0 ? part.slice(0, i) : "";
    const key = i > 0 ? Buffer.from(part.slice(i + 1), "base64") : Buffer.alloc(0);
    if (!KEY_ID_RE.test(id) || key.length !== KEY || keys.has(id)) return { error: "SECRETS_MASTER_KEYS: each entry must be <id>:<base64 of exactly 32 random bytes>, ids unique" };
    keys.set(id, key);
  }
  if (keys.size === 0) return { error: "SECRETS_MASTER_KEYS: required when SECRETS_ACTIVE_KEY_ID is set" };
  if (!keys.has(active)) return { error: "SECRETS_ACTIVE_KEY_ID: must name one of the keys in SECRETS_MASTER_KEYS" };
  return { activeId: active, keys };
}
