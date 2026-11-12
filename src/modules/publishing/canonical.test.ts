import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize, findUnstorableText, serializeSnapshot } from "./canonical";

describe("canonical snapshot text", () => {
  it("sorts keys at every level and has no whitespace; array order is preserved", () => {
    expect(canonicalize({ b: 1, a: { d: [3, 1, 2], c: null } })).toBe('{"a":{"c":null,"d":[3,1,2]},"b":1}');
  });
  it("is independent of key insertion order (same hash)", () => {
    expect(serializeSnapshot({ a: 1, b: { x: 1, y: 2 } }).hash).toBe(serializeSnapshot({ b: { y: 2, x: 1 }, a: 1 }).hash);
  });
  it("hash and byte size describe exactly the same UTF-8 text (multi-byte characters counted in bytes)", () => {
    const s = serializeSnapshot({ name: "فروشگاه ☕ 😀" });
    expect(s.bytes).toBe(Buffer.byteLength(s.text, "utf8"));
    expect(s.bytes).toBeGreaterThan(s.text.length);
    expect(s.hash).toBe(createHash("sha256").update(s.text, "utf8").digest("hex"));
  });
  it("different content gives a different hash", () => {
    expect(serializeSnapshot({ a: 1 }).hash).not.toBe(serializeSnapshot({ a: 2 }).hash);
  });
});

describe("findUnstorableText (what PostgreSQL JSONB rejects)", () => {
  it("accepts ordinary and Persian/emoji text", () => {
    expect(findUnstorableText({ a: ["x", "فروشگاه", "😀"], b: { c: "ok" } })).toBeNull();
  });
  it("reports the path of a NUL character, in a value or a key", () => {
    expect(findUnstorableText({ a: ["x", "bad\u0000"] })).toBe("$.a[1]");
    expect(findUnstorableText({ ["k\u0000"]: 1 })).toBe("$.k\u0000");
  });
  it("reports a lone surrogate", () => {
    expect(findUnstorableText({ a: { b: "x\ud800y" } })).toBe("$.a.b");
  });
});
