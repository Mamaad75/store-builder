import { describe, expect, it } from "vitest";
import { makeStorefront, PRODUCT_A } from "@/test/storefront-fixtures";
import { listRegisteredTemplates, resolveTemplate } from "../registry";
import { buildView } from "./view";
import { resolveStorefrontRoute } from "./route";

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
    expect(listRegisteredTemplates().map((t) => `${t.key}@${t.version}`)).toEqual(["general@1", "coffee@1", "fashion@1", "appliances@1"]);
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
