import { describe, expect, it } from "vitest";
import { makeStorefront, PRODUCT_A } from "@/test/storefront-fixtures";
import { storefrontDataSchema } from "./storefront-data";

const ok = (d: unknown) => storefrontDataSchema.safeParse(d).success;

describe("storefront data contract", () => {
  it("accepts a complete valid storefront (real general seed pages)", () => {
    expect(ok(makeStorefront())).toBe(true);
  });
  it("accepts an empty storefront (no products, no categories)", () => {
    expect(ok(makeStorefront({ products: [], categories: [] }))).toBe(true);
  });
  it.each([
    ["not an object", null],
    ["wrong schema version", { ...makeStorefront(), schemaVersion: 2 }],
    ["unknown top-level key", { ...makeStorefront(), ownerId: "u1" }],
    ["unknown store key", { ...makeStorefront(), store: { ...makeStorefront().store, secret: 1 } }],
    ["bad color", { ...makeStorefront(), store: { ...makeStorefront().store, primaryColor: "red" } }],
    ["fractional price", makeStorefront({ products: [{ ...PRODUCT_A, price: 10.5 }] })],
    ["negative price", makeStorefront({ products: [{ ...PRODUCT_A, price: -1 }] })],
    ["price above business maximum", makeStorefront({ products: [{ ...PRODUCT_A, price: 1_000_000_001 }] })],
    ["product with unknown category", makeStorefront({ products: [{ ...PRODUCT_A, categoryId: "ghost" }] })],
    ["extra product key (e.g. status)", makeStorefront({ products: [{ ...PRODUCT_A, status: "DRAFT" } as never] })],
    ["duplicate product slug", makeStorefront({ products: [PRODUCT_A, { ...PRODUCT_A, id: "other" }] })],
    ["non-canonical slug", makeStorefront({ products: [{ ...PRODUCT_A, slug: "Bad Slug" }] })],
    ["invalid template key", { ...makeStorefront(), template: { key: "Bad Key", version: 1 } }],
    ["template version 0", { ...makeStorefront(), template: { key: "general", version: 0 } }],
  ])("rejects: %s", (_n, d) => {
    expect(ok(d)).toBe(false);
  });
  describe("media references", () => {
    const key = `stores/s1/${"a".repeat(32)}.webp`;
    it("accepts a relative key with real dimensions on products and the logo", () => {
      const d = makeStorefront({ products: [{ ...PRODUCT_A, image: { key, width: 800, height: 600 } }] });
      d.store.logo = { key, width: 200, height: 200 };
      expect(ok(d)).toBe(true);
    });
    it("data written before media existed (no image/logo fields) is still valid and defaults to null", () => {
      const legacy = JSON.parse(JSON.stringify(makeStorefront()));
      delete legacy.store.logo;
      for (const p of legacy.products) delete p.image;
      const r = storefrontDataSchema.safeParse(legacy);
      expect(r.success && r.data.store.logo).toBeNull();
      expect(r.success && r.data.products.every((p) => p.image === null)).toBe(true);
    });
    it.each([
      ["absolute URL", "https://evil.example/a.webp"],
      ["protocol-relative", "//evil.example/a.webp"],
      ["path traversal", "stores/s1/../../etc/passwd"],
      ["wrong extension", `stores/s1/${"a".repeat(32)}.svg`],
      ["predictable name", "stores/s1/logo.webp"],
      ["javascript:", "javascript:alert(1)"],
    ])("rejects an image key that is a %s", (_n, bad) => {
      expect(ok(makeStorefront({ products: [{ ...PRODUCT_A, image: { key: bad, width: 1, height: 1 } }] }))).toBe(false);
    });
    it("rejects out-of-range dimensions and extra keys (no hidden URL field)", () => {
      expect(ok(makeStorefront({ products: [{ ...PRODUCT_A, image: { key, width: 4096, height: 1 } }] }))).toBe(false);
      expect(ok(makeStorefront({ products: [{ ...PRODUCT_A, image: { key, width: 1, height: 1, url: "https://x" } as never }] }))).toBe(false);
    });
  });
  it("rejects a page with an invalid section (never partially accepted)", () => {
    const d = makeStorefront();
    (d.pages[0]!.sections as unknown[]).push({ id: "x", type: "hero", props: {} });
    expect(ok(d)).toBe(false);
  });
});
