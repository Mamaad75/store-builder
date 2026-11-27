import { describe, expect, it } from "vitest";
import { newMediaKey } from "./keys.js";
import { MEDIA_VARIANT_KEY_RE, isStorableMediaKey, isVariantMediaKey, mainKeyOf, srcSetFor, variantKey, variantKeysOf, variantWidthsFor } from "./variants.js";

const MAIN = `stores/s1/${"a".repeat(32)}.webp`;
const url = (k: string) => `https://cdn.example/${k}`;

describe("media variant keys", () => {
  it("derive from the main key, and map back", () => {
    expect(variantKey(MAIN, 640)).toBe(`stores/s1/${"a".repeat(32)}-w640.webp`);
    expect(variantKeysOf(MAIN)).toHaveLength(3);
    for (const k of variantKeysOf(MAIN)) {
      expect(isVariantMediaKey(k)).toBe(true);
      expect(mainKeyOf(k)).toBe(MAIN);
    }
    expect(mainKeyOf(MAIN)).toBe(MAIN);
    expect(mainKeyOf("stores/s1/other.webp")).toBeNull();
    expect(mainKeyOf("../etc/passwd")).toBeNull();
  });
  it("a copy's key is storable but is never a valid MAIN key (published data and rows only ever hold main keys)", () => {
    const v = variantKey(MAIN, 320);
    expect(isStorableMediaKey(v)).toBe(true);
    expect(isStorableMediaKey(MAIN)).toBe(true);
    expect(isStorableMediaKey(`stores/s1/${"a".repeat(32)}-w999.webp`)).toBe(false);
    expect(isStorableMediaKey(`stores/s1/${"a".repeat(32)}-w320.png`)).toBe(false);
    expect(MEDIA_VARIANT_KEY_RE.test(newMediaKey("abc"))).toBe(false);
  });
  it("only copies smaller than the picture are made", () => {
    expect(variantWidthsFor(2048)).toEqual([320, 640, 1024]);
    expect(variantWidthsFor(1024)).toEqual([320, 640]);
    expect(variantWidthsFor(800)).toEqual([320, 640]);
    expect(variantWidthsFor(320)).toEqual([]);
  });
});

describe("srcSetFor", () => {
  it("lists the copies (and no giant original) for a big picture", () => {
    expect(srcSetFor({ key: MAIN, width: 2048, variants: true }, url)).toBe(`${url(variantKey(MAIN, 320))} 320w, ${url(variantKey(MAIN, 640))} 640w, ${url(variantKey(MAIN, 1024))} 1024w`);
  });
  it("includes the picture itself when it is not wider than the largest copy", () => {
    expect(srcSetFor({ key: MAIN, width: 800, variants: true }, url)).toBe(`${url(variantKey(MAIN, 320))} 320w, ${url(variantKey(MAIN, 640))} 640w, ${url(MAIN)} 800w`);
  });
  it("is null without copies, for a small picture, or when an address cannot be built", () => {
    expect(srcSetFor({ key: MAIN, width: 2048 }, url)).toBeNull();
    expect(srcSetFor({ key: MAIN, width: 2048, variants: false }, url)).toBeNull();
    expect(srcSetFor({ key: MAIN, width: 300, variants: true }, url)).toBeNull();
    expect(srcSetFor({ key: MAIN, width: 2048, variants: true }, () => null)).toBeNull();
  });
});
