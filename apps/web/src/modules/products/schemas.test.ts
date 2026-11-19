import { describe, expect, it } from "vitest";
import { createCategorySchema, deleteCategoryOptionsSchema, updateCategorySchema } from "@/modules/categories/schemas";
import { activationSchema, createProductSchema, parseProductListParams, updateProductSchema } from "./schemas";

describe("createProductSchema", () => {
  it("normalises and applies defaults (blank slug => undefined, blank category => null)", () => {
    const r = createProductSchema.parse({ name: " چاي  سبز ", price: "۱٬۲۰۰", slug: "  ", categoryId: "" });
    expect(r).toEqual({ name: "چای سبز", description: "", price: 1200, stockQuantity: 0, categoryId: null, slug: undefined, specs: [] });
  });
  it("accepts the numeric boundaries exactly", () => {
    expect(createProductSchema.safeParse({ name: "a", price: 0, stockQuantity: 0 }).success).toBe(true);
    expect(createProductSchema.safeParse({ name: "a", price: 1_000_000_000, stockQuantity: 1_000_000 }).success).toBe(true);
  });
  it.each([
    { price: 1_000_000_001 }, { price: -1 }, { price: 1.5 }, { price: "1.5" }, { price: "" }, { price: "abc" }, { price: "۱۲ تومان" },
    { stockQuantity: 1_000_001 }, { stockQuantity: -1 }, { stockQuantity: "x" },
    { name: "" }, { name: "x".repeat(121) }, { name: 5 }, { description: "x".repeat(5001) }, { slug: "x".repeat(300) },
  ])("rejects %j", (bad) => {
    expect(createProductSchema.safeParse({ name: "a", price: 1, ...bad }).success).toBe(false);
  });
  it.each(["status", "ownerId", "storeId", "id", "searchKey", "confirmSlugChange", "createdAt"])("rejects unknown key %s", (k) => {
    expect(createProductSchema.safeParse({ name: "a", price: 1, [k]: "x" }).success).toBe(false);
  });
});

describe("updateProductSchema", () => {
  it("accepts partial updates and the explicit confirmation flag", () => {
    expect(updateProductSchema.parse({ price: "5" })).toEqual({ price: 5 });
    expect(updateProductSchema.parse({ slug: "My Slug", confirmSlugChange: true })).toEqual({ slug: "my-slug", confirmSlugChange: true });
    expect(updateProductSchema.parse({ categoryId: null })).toEqual({ categoryId: null });
  });
  it("can never carry a status or identity", () => {
    for (const k of ["status", "ownerId", "userId", "storeId", "id", "searchKey"]) {
      expect(updateProductSchema.safeParse({ [k]: "x" }).success).toBe(false);
    }
    expect(updateProductSchema.safeParse({ confirmSlugChange: "yes" }).success).toBe(false);
  });
});

describe("activationSchema", () => {
  it("requires a name, a slug and a price in range", () => {
    expect(activationSchema.safeParse({ name: "a", slug: "a", price: 0 }).success).toBe(true);
    expect(activationSchema.safeParse({ name: "", slug: "a", price: 0 }).success).toBe(false);
    expect(activationSchema.safeParse({ name: "a", slug: "", price: 0 }).success).toBe(false);
    expect(activationSchema.safeParse({ name: "a", slug: "a", price: 2_000_000_000 }).success).toBe(false);
  });
});

describe("parseProductListParams (lenient: bad values fall back to defaults)", () => {
  it("parses valid parameters", () => {
    expect(parseProductListParams({ q: " چای ", category: "none", status: "ACTIVE", page: "3", pageSize: "10" })).toEqual({
      q: "چای", category: "none", status: "ACTIVE", page: 3, pageSize: 10,
    });
  });
  it("uses defaults for missing, malformed or out-of-range values and takes the first of repeated parameters", () => {
    expect(parseProductListParams({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseProductListParams({ status: "PUBLISHED", page: "-2", pageSize: "9999" })).toEqual({ page: 1, pageSize: 20 });
    expect(parseProductListParams({ page: "abc", pageSize: "0", q: "x".repeat(101) })).toEqual({ page: 1, pageSize: 20 });
    expect(parseProductListParams({ q: ["a", "b"], page: ["2", "9"] })).toEqual({ q: "a", page: 2, pageSize: 20 });
  });
});

describe("category schemas", () => {
  it("normalises names and rejects extra keys (slugs are never client-supplied)", () => {
    expect(createCategorySchema.parse({ name: " علي " })).toEqual({ name: "علی" });
    for (const bad of [{ name: "" }, { name: "x".repeat(61) }, { name: "a", slug: "x" }, {}]) {
      expect(createCategorySchema.safeParse(bad).success).toBe(false);
      expect(updateCategorySchema.safeParse(bad).success).toBe(false);
    }
  });
  it("delete options require an explicit boolean", () => {
    expect(deleteCategoryOptionsSchema.safeParse({ moveProducts: true }).success).toBe(true);
    expect(deleteCategoryOptionsSchema.safeParse({ moveProducts: "on" }).success).toBe(false);
    expect(deleteCategoryOptionsSchema.safeParse({}).success).toBe(false);
  });
});
