import { describe, expect, it } from "vitest";
import { buildProductsUrl, categoriesUrl, productUrl, productsUrl } from "./list-url";
import { getNotice, NOTICES } from "./notices";

describe("buildProductsUrl", () => {
  it("omits defaults and keeps only the active search, filters, page and page size", () => {
    expect(buildProductsUrl("s1")).toBe("/dashboard/stores/s1/products");
    expect(buildProductsUrl("s1", { page: 1, pageSize: 20 })).toBe("/dashboard/stores/s1/products");
    const u = new URL(buildProductsUrl("s1", { q: "چای سبز", category: "c1", status: "ACTIVE", page: 3, pageSize: 10 }), "http://x");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "چای سبز", category: "c1", status: "ACTIVE", page: "3", pageSize: "10" });
  });
  it("adds extra parameters (e.g. a notice) after the preserved ones", () => {
    const u = new URL(buildProductsUrl("s1", { q: "a" }, { notice: "product-created" }), "http://x");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "a", notice: "product-created" });
  });
  it("encodes special characters so a query can never inject parameters or paths", () => {
    const url = buildProductsUrl("s1", { q: "a&status=ARCHIVED#x" });
    const u = new URL(url, "http://x");
    expect(u.searchParams.get("q")).toBe("a&status=ARCHIVED#x");
    expect(u.searchParams.get("status")).toBeNull();
    expect(u.hash).toBe("");
  });
  it("URL-encodes ids in paths", () => {
    expect(productUrl("a/b", "c d")).toBe("/dashboard/stores/a%2Fb/products/c%20d");
    expect(productsUrl("x?y")).toBe("/dashboard/stores/x%3Fy/products");
    expect(categoriesUrl("s")).toBe("/dashboard/stores/s/categories");
  });
});

describe("notice whitelist", () => {
  it("returns messages only for known codes", () => {
    expect(getNotice("product-created")?.severity).toBe("success");
    expect(getNotice(["status-invalid", "product-created"])?.severity).toBe("error");
    expect(Object.keys(NOTICES).length).toBeGreaterThan(10);
  });
  it.each(["", "unknown", "<script>alert(1)</script>", "__proto__", "constructor", "toString", "hasOwnProperty", undefined])(
    "ignores %j",
    (code) => {
      expect(getNotice(code as string | undefined)).toBeNull();
    },
  );
  it("every message is plain text (no markup)", () => {
    for (const n of Object.values(NOTICES)) expect(n.text).not.toMatch(/[<>]/);
  });
});
