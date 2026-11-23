import { describe, expect, it } from "vitest";
import { shippingMethodInputSchema, type ShippingMethod } from "@store-builder/shared/modules/checkout/checkout";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { mergeLines, priceLines, stockKey, summarize, weightOf, type StockFact } from "./quote.js";

const product = (over: Partial<StorefrontProduct>): StorefrontProduct => ({
  id: "p1", name: "چای", slug: "chai", description: "", price: 100_000, stockQuantity: 10, categoryId: null, image: null, specs: [], variants: [], weightGrams: 500,
  ...over,
});
const shirt = product({
  id: "p2", name: "پیراهن", slug: "shirt", price: 200_000, weightGrams: null,
  variants: [
    { id: "v1", options: [{ name: "سایز", value: "M" }], price: 200_000, stockQuantity: 3 },
    { id: "v2", options: [{ name: "سایز", value: "L" }], price: 250_000, stockQuantity: 0 },
  ],
});
const published = [product({}), shirt];
const stock = new Map<string, StockFact>([
  [stockKey("p1", null), { productActive: true, available: 10 }],
  [stockKey("p2", "v1"), { productActive: true, available: 3 }],
  [stockKey("p2", "v2"), { productActive: true, available: 0 }],
]);

describe("pricing cart lines", () => {
  it("prices from the published product or variant, never from the cart", () => {
    const [a, b] = priceLines([{ productId: "p1", variantId: null, quantity: 2 }, { productId: "p2", variantId: "v1", quantity: 1 }], published, stock);
    expect(a).toMatchObject({ unitPrice: 100_000, lineTotal: 200_000, problem: null, name: "چای", slug: "chai" });
    expect(b).toMatchObject({ unitPrice: 200_000, lineTotal: 200_000, problem: null, variantLabel: "سایز: M" });
  });

  it("keeps lines that cannot be bought, with the reason, out of every total", () => {
    const lines = priceLines(
      [
        { productId: "gone", variantId: null, quantity: 1 },
        { productId: "p2", variantId: null, quantity: 1 },
        { productId: "p2", variantId: "v-unpublished", quantity: 1 },
        { productId: "p2", variantId: "v2", quantity: 1 },
        { productId: "p2", variantId: "v1", quantity: 5 },
      ],
      published,
      stock,
    );
    expect(lines.map((l) => l.problem)).toEqual(["unavailable", "choose_variant", "unavailable", "out_of_stock", "not_enough_stock"]);
    expect(lines.every((l) => l.lineTotal === 0)).toBe(true);
    expect(lines[4]!.available).toBe(3);
  });

  it("a product whose stock row is gone or not active is unavailable even if still published", () => {
    const facts = new Map<string, StockFact>([[stockKey("p1", null), { productActive: false, available: 10 }]]);
    expect(priceLines([{ productId: "p1", variantId: null, quantity: 1 }], published, facts)[0]!.problem).toBe("unavailable");
    expect(priceLines([{ productId: "p1", variantId: null, quantity: 1 }], published, new Map())[0]!.problem).toBe("unavailable");
  });
});

describe("weight", () => {
  it("adds published weights per unit and counts units of unknown weight separately; problem lines do not count", () => {
    const lines = priceLines([{ productId: "p1", variantId: null, quantity: 3 }, { productId: "p2", variantId: "v1", quantity: 2 }, { productId: "p2", variantId: "v2", quantity: 9 }], published, stock);
    expect(weightOf(lines, published)).toEqual({ knownGrams: 1500, unknownWeightUnits: 2 });
  });
});

const method = (id: string, over: Partial<ShippingMethod> = {}): ShippingMethod => ({ ...shippingMethodInputSchema.parse({ name: id, kind: "FLAT", price: 30_000 }), id, ...over });

describe("checkout summary", () => {
  const lines = priceLines([{ productId: "p1", variantId: null, quantity: 2 }], published, stock);
  const methods = [method("post", { cashOnDelivery: { enabled: true, provinces: ["tehran"], fee: 10_000 } }), method("tehran-only", { provinces: ["tehran"], price: 20_000 })];

  it("without an address: subtotal only, not ready", () => {
    const s = summarize({ lines, published, methods, province: null, shippingMethodId: null, cashOnDelivery: false });
    expect(s).toMatchObject({ subtotal: 200_000, shippingOptions: [], total: 200_000, ready: false, blockers: ["no_address"] });
  });

  it("offers the methods of the province; with a choice and cash on delivery the total adds shipping and the fee", () => {
    const s = summarize({ lines, published, methods, province: "tehran", shippingMethodId: "post", cashOnDelivery: true });
    expect(s.shippingOptions.map((o) => o.methodId)).toEqual(["post", "tehran-only"]);
    expect(s).toMatchObject({ shippingCost: 30_000, cashOnDelivery: true, codFee: 10_000, total: 240_000, ready: true, blockers: [] });
  });

  it("names every blocker: no method chosen, a method not offered there, cash on delivery not offered there", () => {
    expect(summarize({ lines, published, methods, province: "tehran", shippingMethodId: null, cashOnDelivery: false }).blockers).toEqual(["choose_shipping"]);
    expect(summarize({ lines, published, methods, province: "fars", shippingMethodId: "tehran-only", cashOnDelivery: false }).blockers).toEqual(["shipping_unavailable"]);
    const cod = summarize({ lines, published, methods, province: "fars", shippingMethodId: "post", cashOnDelivery: true });
    expect(cod).toMatchObject({ blockers: ["cod_unavailable"], cashOnDelivery: false, codFee: 0, ready: false });
    expect(summarize({ lines, published, methods: [], province: "fars", shippingMethodId: null, cashOnDelivery: false }).blockers).toEqual(["no_shipping_for_province"]);
  });

  it("an empty cart or a line problem blocks the order", () => {
    expect(summarize({ lines: [], published, methods, province: "tehran", shippingMethodId: "post", cashOnDelivery: false }).blockers).toEqual(["empty_cart"]);
    const bad = priceLines([{ productId: "p2", variantId: "v2", quantity: 1 }], published, stock);
    expect(summarize({ lines: bad, published, methods, province: "tehran", shippingMethodId: "post", cashOnDelivery: false }).blockers).toEqual(["line_problems"]);
  });

  it("free shipping above an amount uses the subtotal of buyable lines only", () => {
    const free = [method("free", { freeAbove: 200_000 })];
    expect(summarize({ lines, published, methods: free, province: "tehran", shippingMethodId: "free", cashOnDelivery: false })).toMatchObject({ shippingCost: 0, total: 200_000 });
  });
});

describe("merging a guest cart into the customer's", () => {
  it("adds quantities of the same line (capped), appends new lines (capped), keeps the customer's order", () => {
    const into = [{ productId: "a", variantId: null, quantity: 999 }, { productId: "b", variantId: "x", quantity: 1 }];
    const from = [{ productId: "a", variantId: null, quantity: 5 }, { productId: "c", variantId: null, quantity: 2 }, { productId: "d", variantId: null, quantity: 1 }];
    expect(mergeLines(into, from, 3, 1000)).toEqual([
      { productId: "a", variantId: null, quantity: 1000 },
      { productId: "b", variantId: "x", quantity: 1 },
      { productId: "c", variantId: null, quantity: 2 },
    ]);
  });
});
