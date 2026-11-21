import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvelopeError, decrypt, encrypt, parseMasterKeys, rewrap, type MasterKeys } from "./envelope.js";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const KEYS: MasterKeys = { activeId: "k1", keys: new Map([["k1", k1]]) };
const CTX = "store:s1|name:payment.zarinpal.merchant_id";

describe("envelope encryption (D24-1)", () => {
  it("round-trips, and the stored bytes contain neither the value nor the data key in clear", () => {
    const e = encrypt(KEYS, CTX, "merchant-1234-ABCD");
    expect(decrypt(KEYS, CTX, e)).toBe("merchant-1234-ABCD");
    expect(e.keyId).toBe("k1");
    expect(e.sealed.includes(Buffer.from("merchant-1234-ABCD"))).toBe(false);
    expect(e.wrappedKey.length).toBe(12 + 32 + 16);
  });

  it("every encryption is unique (fresh data key and IVs), even for the same value", () => {
    const a = encrypt(KEYS, CTX, "same");
    const b = encrypt(KEYS, CTX, "same");
    expect(a.sealed.equals(b.sealed)).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
  });

  it("a ciphertext moved to another store or name does not decrypt (context binding)", () => {
    const e = encrypt(KEYS, CTX, "secret");
    expect(() => decrypt(KEYS, "store:s2|name:payment.zarinpal.merchant_id", e)).toThrow(EnvelopeError);
    expect(() => decrypt(KEYS, "store:s1|name:other.key", e)).toThrow(EnvelopeError);
  });

  it("any tampering is detected; a wrong or unknown master key fails the same way", () => {
    const e = encrypt(KEYS, CTX, "secret");
    for (const field of ["sealed", "wrappedKey"] as const) {
      const bad = Buffer.from(e[field]);
      bad[20]! ^= 1;
      expect(() => decrypt(KEYS, CTX, { ...e, [field]: bad }), field).toThrow(EnvelopeError);
    }
    expect(() => decrypt({ activeId: "k1", keys: new Map([["k1", k2]]) }, CTX, e)).toThrow(EnvelopeError);
    expect(() => decrypt(KEYS, CTX, { ...e, keyId: "nope" })).toThrow(EnvelopeError);
    expect(() => decrypt(KEYS, CTX, { ...e, sealed: Buffer.alloc(5) })).toThrow(EnvelopeError);
  });

  it("tampering with the IV, the tag or truncating the tag fails; swapping the two layers fails (domain separation)", () => {
    const e = encrypt(KEYS, CTX, "secret value");
    const flip = (b: Buffer, i: number) => {
      const c = Buffer.from(b);
      c[i]! ^= 1;
      return c;
    };
    for (const field of ["sealed", "wrappedKey"] as const) {
      expect(() => decrypt(KEYS, CTX, { ...e, [field]: flip(e[field], 0) }), `${field} IV`).toThrow(EnvelopeError);
      expect(() => decrypt(KEYS, CTX, { ...e, [field]: flip(e[field], e[field].length - 1) }), `${field} tag`).toThrow(EnvelopeError);
      expect(() => decrypt(KEYS, CTX, { ...e, [field]: e[field].subarray(0, e[field].length - 4) }), `${field} truncated tag`).toThrow(EnvelopeError);
    }
    expect(() => decrypt(KEYS, CTX, { ...e, wrappedKey: e.sealed, sealed: e.wrappedKey })).toThrow(EnvelopeError);
  });

  it("rotation refuses an unknown old key or a wrong context, and never produces an envelope", () => {
    const e = encrypt(KEYS, CTX, "x");
    const onlyNew: MasterKeys = { activeId: "k2", keys: new Map([["k2", k2]]) };
    expect(() => rewrap(onlyNew, CTX, e)).toThrow(EnvelopeError);
    const both: MasterKeys = { activeId: "k2", keys: new Map([["k1", k1], ["k2", k2]]) };
    expect(() => rewrap(both, "store:other|name:x.y", e)).toThrow(EnvelopeError);
  });

  it("rotation re-wraps the data key under the new active key without touching the sealed value", () => {
    const e = encrypt(KEYS, CTX, "rotate me");
    const both: MasterKeys = { activeId: "k2", keys: new Map([["k1", k1], ["k2", k2]]) };
    const r = rewrap(both, CTX, e);
    expect(r.keyId).toBe("k2");
    expect(r.sealed.equals(e.sealed)).toBe(true);
    expect(decrypt({ activeId: "k2", keys: new Map([["k2", k2]]) }, CTX, r)).toBe("rotate me"); // the old key can be retired
    expect(rewrap(both, CTX, r)).toBe(r); // already current: unchanged
  });

  it("parses the key list strictly and names only variables in errors", () => {
    const b64 = k1.toString("base64");
    expect(parseMasterKeys("", "")).toBeNull();
    expect(parseMasterKeys(`k1:${b64}`, "k1")).toMatchObject({ activeId: "k1" });
    const len = (n: number) => randomBytes(n).toString("base64");
    for (const [list, active] of [
      [`k1:${b64}`, "k2"], ["k1:short", "k1"], [`K!:${b64}`, "K!"], [`k1:${b64},k1:${b64}`, "k1"], ["", "k1"],
      [`k1:${b64}`, ""], [`k1:${len(31)}`, "k1"], [`k1:${len(33)}`, "k1"], [`${"k".repeat(33)}:${b64}`, "k".repeat(33)],
    ]) {
      const r = parseMasterKeys(list, active) as { error: string };
      expect(r.error, `${list} / ${active}`).toMatch(/^SECRETS_/);
      expect(r.error).not.toContain(b64);
    }
  });
});
