import { describe, expect, it } from "vitest";
import { makeStorefront, PRODUCT_A } from "../../testing/storefront-fixtures.js";
import type { RenderContext } from "../context-types.js";
import type { StorefrontData, StorefrontProduct } from "../storefront-data.js";
import { listProducts, listUrl, priceMatches } from "./listing.js";
import { parseQuery, resolveStorefrontRoute } from "./route.js";

/** The price range and in-stock filters of the product listing: parsing, matching, and staying on every link of the listing. */
const P = (n: number, price: number, stock = 5, variants: StorefrontProduct["variants"] = []): StorefrontProduct => ({ ...PRODUCT_A, id: `p${n}`, slug: `p-${n}`, name: `کالا ${n}`, price, stockQuantity: stock, variants, categoryId: null });
const data = (products: StorefrontProduct[]): StorefrontData => makeStorefront({ products, categories: [] });

function ctxFor(d: StorefrontData, sp: Record<string, string | string[] | undefined>): RenderContext {
  const r = resolveStorefrontRoute(d, ["products"], sp);
  if (r.kind !== "page") throw new Error("not found");
  return { data: d, page: r.page, query: r.query, product: null, basePath: "", href: (p) => p, mediaUrl: () => null };
}

describe("parsing the filters", () => {
  const d = data([P(1, 100)]);
  it("reads whole-number prices, Persian digits and separators included; ignores anything else", () => {
    expect(parseQuery({ min: "۱۲۰٬۰۰۰", max: "500,000" }, d)).toMatchObject({ min: 120_000, max: 500_000 });
    expect(parseQuery({ min: "0" }, d).min).toBe(0);
    for (const bad of ["abc", "-5", "1.5e3", "12 34 56 78 90 12", "99999999999", "2000000000", "<script>"]) expect(parseQuery({ min: bad }, d), bad).not.toHaveProperty("min");
    expect(parseQuery({ min: ["100", "200"] }, d).min).toBe(100); // the first one, like every other parameter
  });
  it("available is on only for exactly 1", () => {
    expect(parseQuery({ available: "1" }, d).available).toBe(true);
    for (const v of ["0", "true", "yes", ""]) expect(parseQuery({ available: v }, d)).not.toHaveProperty("available");
  });
});

describe("matching", () => {
  const variants = (...prices: number[]) => prices.map((price, i) => ({ id: `v${i}`, options: [{ name: "سایز", value: String(i) }], price, stockQuantity: 1 }));
  it("a plain product by its price, bounds included", () => {
    expect(priceMatches(P(1, 100), 100, 100)).toBe(true);
    expect(priceMatches(P(1, 100), 101, undefined)).toBe(false);
    expect(priceMatches(P(1, 100), undefined, 99)).toBe(false);
    expect(priceMatches(P(1, 0), 0, 0)).toBe(true);
  });
  it("a product with variants when any variant is inside", () => {
    const shirt = P(1, 100, 5, variants(100, 500));
    expect(priceMatches(shirt, undefined, 200)).toBe(true); // the cheap one
    expect(priceMatches(shirt, 400, undefined)).toBe(true); // the dear one
    expect(priceMatches(shirt, 200, 300)).toBe(false); // none between
  });
});

describe("the listing", () => {
  const all = data([P(1, 100, 5), P(2, 250, 0), P(3, 400, 3), P(4, 900, 0)]);
  const names = (sp: Record<string, string>) => listProducts(ctxFor(all, sp)).items.map((p) => p.name);
  it("filters by range and by stock, together, and counts what is left", () => {
    expect(names({})).toHaveLength(4);
    expect(names({ min: "200", max: "500" })).toEqual(["کالا 2", "کالا 3"]);
    expect(names({ available: "1" })).toEqual(["کالا 1", "کالا 3"]);
    expect(names({ min: "200", max: "500", available: "1" })).toEqual(["کالا 3"]);
    expect(listProducts(ctxFor(all, { min: "200", max: "500" })).total).toBe(2);
    expect(names({ min: "500", max: "200" })).toEqual([]); // an impossible range is simply empty
  });
  it("combines with the sort and keeps the filters in the result", () => {
    const r = listProducts(ctxFor(all, { min: "200", sort: "cheap", available: "1" }));
    expect(r.items.map((p) => p.name)).toEqual(["کالا 3"]);
    expect(r).toMatchObject({ min: 200, available: true, sort: "cheap" });
  });
});

describe("links", () => {
  const d = data([P(1, 100), P(2, 200)]);
  it("keep the range and the stock filter, unless a caller names them", () => {
    const ctx = ctxFor(d, { min: "100", max: "300", available: "1" });
    expect(listUrl(ctx, { sort: "cheap" })).toBe("/products?sort=cheap&min=100&max=300&available=1");
    expect(listUrl(ctx, { page: 2 })).toBe("/products?min=100&max=300&available=1&page=2");
    expect(listUrl(ctx, { min: undefined, max: undefined, available: undefined })).toBe("/products");
    expect(listUrl(ctxFor(d, {}), { sort: "cheap" })).toBe("/products?sort=cheap");
  });
});
