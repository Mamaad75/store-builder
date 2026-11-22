import { describe, expect, it } from "vitest";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import { listRegisteredTemplates, resolveTemplate } from "../registry";
import { buildView } from "./view";
import { resolveStorefrontRoute } from "@store-builder/shared/templates/engine/route";
import { formTarget, listProducts, listUrl, relatedProducts } from "@store-builder/shared/templates/engine/listing";
import { makeHref } from "@store-builder/shared/templates/engine/links";
import type { RenderContext } from "../types";

const req = (segments: string[] = [], searchParams?: Record<string, string | string[]>) => ({ basePath: "/preview/s1", segments, searchParams });

describe("template registry / version resolution", () => {
  it("resolves a registered (key, version) and nothing else", () => {
    expect(resolveTemplate("general", 1)?.key).toBe("general");
    expect(resolveTemplate("general", 2)).toBeNull();
    expect(resolveTemplate("general", 0)).toBeNull();
    expect(resolveTemplate("legacy-demo", 1)).toBeNull(); // a theme no code registers
    expect(resolveTemplate("__proto__", 1)).toBeNull();
    expect(resolveTemplate("constructor", 1)).toBeNull();
  });
  it("lists registered templates", () => {
    expect(listRegisteredTemplates().map((t) => `${t.key}@${t.version}`)).toEqual([
      "bazaar@1", "circuit@1", "sormeh@1", "dookht@1", "arcade@1", "sofreh@1", "golkhaneh@1", "khaneh@1",
      "bazaar@2", "circuit@2", "sormeh@2", "dookht@2", "arcade@2", "sofreh@2", "golkhaneh@2", "khaneh@2",
      "bazaar@3", "circuit@3", "sormeh@3", "dookht@3", "arcade@3", "sofreh@3", "golkhaneh@3", "khaneh@3",
      "general@1", "coffee@1", "fashion@1", "appliances@1",
    ]);
  });
});

describe("buildView", () => {
  it("chooses the template from the data's own key/version", () => {
    const v = buildView(makeStorefront(), req());
    expect(v.status).toBe("ok");
    if (v.status === "ok") expect(v.template.key).toBe("general");
  });
  it("unsupported template key or version is an explicit outcome, not a fallback", () => {
    expect(buildView(makeStorefront({ template: { key: "legacy-demo", version: 1 } }), req())).toEqual({ status: "unsupported_template", key: "legacy-demo", version: 1 });
    expect(buildView(makeStorefront({ template: { key: "general", version: 9 } }), req())).toEqual({ status: "unsupported_template", key: "general", version: 9 });
  });
  it.each([null, undefined, 5, "x", {}, [], { ...makeStorefront(), pages: "nope" }])("malformed data is invalid_data and never throws (%#)", (raw) => {
    expect(buildView(raw, req())).toEqual({ status: "invalid_data" });
  });
  it("unknown paths are not_found", () => {
    for (const s of [["nope"], ["products", "a", "b"], ["products", "ghost"], ["about", "x"]]) expect(buildView(makeStorefront(), req(s)).status).toBe("not_found");
  });
  it("a hidden/missing page is not_found", () => {
    const d = makeStorefront();
    d.pages = d.pages.filter((p) => p.type !== "ABOUT");
    expect(buildView(d, req(["about"])).status).toBe("not_found");
    expect(buildView(d, req([])).status).toBe("ok");
  });
  it("builds hrefs against the base path", () => {
    const v = buildView(makeStorefront(), req());
    if (v.status !== "ok") throw new Error();
    expect(v.ctx.href("/products")).toBe("/preview/s1/products");
  });
});

describe("resolveStorefrontRoute", () => {
  const d = makeStorefront();
  it("maps fixed public paths to page types", () => {
    const type = (s: string[]) => {
      const r = resolveStorefrontRoute(d, s);
      return r.kind === "page" ? r.page.type : "not_found";
    };
    expect(type([])).toBe("HOME");
    expect(type(["products"])).toBe("PRODUCTS");
    expect(type(["about"])).toBe("ABOUT");
    expect(type(["contact"])).toBe("CONTACT");
    expect(type(["products", PRODUCT_A.slug])).toBe("PRODUCT_DETAIL");
  });
  it("accepts percent-encoded segments (how Next delivers Persian slugs) and rejects malformed escapes", () => {
    const enc = encodeURIComponent(PRODUCT_A.slug);
    expect(enc).toContain("%");
    const r = resolveStorefrontRoute(d, ["products", enc]);
    expect(r.kind === "page" && r.product?.id).toBe(PRODUCT_A.id);
    expect(resolveStorefrontRoute(d, ["products", "%E0%A4%A"]).kind).toBe("not_found");
    expect(resolveStorefrontRoute(d, ["%70roducts"]).kind).toBe("page"); // %70 = "p"
  });
  it("product detail carries the product", () => {
    const r = resolveStorefrontRoute(d, ["products", PRODUCT_A.slug]);
    expect(r.kind === "page" && r.product?.id).toBe(PRODUCT_A.id);
  });
  it("parses the listing query defensively", () => {
    const q = (sp: Record<string, string | string[]>) => {
      const r = resolveStorefrontRoute(d, ["products"], sp);
      return r.kind === "page" ? r.query : null;
    };
    expect(q({})).toEqual({ page: 1 });
    expect(q({ page: "3", category: "چای" })).toEqual({ page: 3, category: "چای" });
    expect(q({ page: "-1" })).toEqual({ page: 1 });
    expect(q({ page: "abc" })).toEqual({ page: 1 });
    expect(q({ page: "99999999" })).toEqual({ page: 1 });
    expect(q({ category: "unknown" })).toEqual({ page: 1 });
    expect(q({ category: ["چای", "قهوه"] })).toEqual({ page: 1, category: "چای" });
  });
});

describe("listing search, sort and related products (theme kit v2)", () => {
  const P = (id: string, name: string, price: number, stock: number, cat: string | null, specs: { label: string; value: string }[] = []) => ({ ...PRODUCT_A, id, name, slug: id, price, stockQuantity: stock, categoryId: cat, specs });
  const data = makeStorefront({
    products: [
      P("a", "چای سبز", 300, 0, "cat-tea"),
      P("b", "قهوه اسپرسو", 100, 5, "cat-coffee", [{ label: "وزن", value: "۲۵۰ گرم" }]),
      P("c", "چاي سياه", 200, 3, "cat-tea"), // Arabic yeh: still found by a Persian query
      P("d", "ماگ‌سرامیکی", 50, 1, null),
    ],
  });
  const ctx = (sp: Record<string, string | string[]> = {}, carry = ""): RenderContext => {
    const r = resolveStorefrontRoute(data, ["products"], sp);
    if (r.kind !== "page") throw new Error("route");
    return { data, page: r.page, query: r.query, product: r.product, basePath: "/preview/s1", href: makeHref("/preview/s1", carry), mediaUrl: () => null };
  };
  const ids = (sp: Record<string, string>) => listProducts(ctx(sp)).items.map((p) => p.id);

  it("parses q and sort defensively: trimmed, cut to 60 characters, blank and unknown values dropped", () => {
    expect(ctx({ q: "  چای  ", sort: "cheap" }).query).toEqual({ page: 1, q: "چای", sort: "cheap" });
    expect(ctx({ q: "   ", sort: "price" }).query).toEqual({ page: 1 });
    expect(ctx({ q: "‌‌" }).query).toEqual({ page: 1 });
    expect(ctx({ q: ["الف", "ب"], sort: ["expensive", "cheap"] }).query).toEqual({ page: 1, q: "الف", sort: "expensive" });
    expect(ctx({ q: "x".repeat(500) }).query.q).toHaveLength(60);
  });
  it("search matches every word in the name, category name and spec values; Arabic letters, digits and ZWNJ are normalised", () => {
    expect(ids({ q: "چای" })).toEqual(["a", "c"]);
    expect(ids({ q: "چاى سياه" })).toEqual(["c"]);
    expect(ids({ q: "قهوه" })).toEqual(["b"]); // category name and product name
    expect(ids({ q: "250" })).toEqual(["b"]); // spec value, Persian digits
    expect(ids({ q: "ماگ سرامیکی" })).toEqual(["d"]); // ZWNJ in the name
    expect(ids({ q: "چای", category: "قهوه" })).toEqual([]);
    expect(ids({ q: "<script>" })).toEqual([]);
  });
  it("sorts are stable and keep the store order on ties; sorting combines with search and category", () => {
    expect(ids({ sort: "cheap" })).toEqual(["d", "b", "c", "a"]);
    expect(ids({ sort: "expensive" })).toEqual(["a", "c", "b", "d"]);
    expect(ids({ sort: "available" })).toEqual(["b", "c", "d", "a"]);
    expect(ids({ sort: "cheap", q: "چای" })).toEqual(["c", "a"]);
  });
  it("listUrl keeps q, category and sort (page last) and appends to a carried query", () => {
    expect(listUrl(ctx(), { q: "چای", category: "چای", sort: "cheap", page: 2 })).toBe(`/preview/s1/products?q=${encodeURIComponent("چای")}&category=${encodeURIComponent("چای")}&sort=cheap&page=2`);
    expect(listUrl(ctx({}, "theme=bazaar"), { sort: "cheap" })).toBe("/preview/s1/products?theme=bazaar&sort=cheap");
  });
  it("a GET form carries the engine query as hidden fields (browsers drop the action query)", () => {
    expect(formTarget(ctx({}, "theme=bazaar"), "/products")).toEqual({ action: "/preview/s1/products", hidden: [["theme", "bazaar"]] });
    expect(formTarget(ctx(), "/products")).toEqual({ action: "/preview/s1/products", hidden: [] });
  });
  it("related products: same category first, then the rest, never the product itself, bounded", () => {
    const c = ctx();
    expect(relatedProducts(c, data.products[0]!, 8).map((p) => p.id)).toEqual(["c", "b", "d"]);
    expect(relatedProducts(c, data.products[3]!, 2).map((p) => p.id)).toEqual(["a", "b"]);
  });
});
