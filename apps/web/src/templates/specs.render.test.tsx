import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeStorefront, PRODUCT_A, PRODUCT_B } from "@/test/storefront-fixtures";
import { MAX_SPEC_ROWS } from "@/lib/product-specs";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { THEME_CATALOG } from "./theme-catalog";
import type { StorefrontData } from "./storefront-data";

const THEMES = THEME_CATALOG.map((t) => t.key);
const XSS_LABEL = "<script>alert(1)</script>";
const XSS_VALUE = '"><img src=x onerror=alert(2)>';
const rows = (n: number, prefix = "ویژگی") => Array.from({ length: n }, (_, i) => ({ label: `${prefix} ${i + 1}`, value: `مقدار ${i + 1}` }));

function render(theme: string, data: StorefrontData, segments: string[] = []) {
  const d = { ...data, template: { key: theme, version: 1 } };
  const v = buildView(d, { basePath: "/preview/s1", segments, mediaUrl: () => null });
  if (v.status !== "ok") throw new Error(`view ${v.status} for ${theme}`);
  return renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
}

describe.each(THEMES)("product specifications in the %s theme", (theme) => {
  const withSpecs = { ...PRODUCT_A, specs: rows(5) };
  const data = makeStorefront({ products: [withSpecs, { ...PRODUCT_B, specs: [] }] });

  it("listing cards show at most the first two rows", () => {
    const html = render(theme, data, ["products"]);
    expect(html).toContain("ویژگی 1");
    expect(html).toContain("مقدار 2");
    expect(html).not.toContain("ویژگی 3");
    expect(html).not.toContain("مقدار 5");
    expect(html.match(/data-testid="card-specs"/g)).toHaveLength(1); // only the product that has specs
  });

  it("the home page's featured cards follow the same two-row rule", () => {
    const html = render(theme, data);
    expect(html).not.toContain("ویژگی 3");
    expect(html).toContain("ویژگی 2");
  });

  it("the detail page shows ALL rows (a definition list with escaped text)", () => {
    const html = render(theme, data, ["products", withSpecs.slug]);
    expect(html).toContain('data-testid="product-specs"');
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`ویژگی ${i}`);
      expect(html).toContain(`مقدار ${i}`);
    }
    expect(html).toContain("<dl");
    expect(html.match(/<dt/g)).toHaveLength(5);
    expect(html.match(/<dd/g)).toHaveLength(5);
  });

  it("the maximum number of rows renders in full on the detail page", () => {
    const d = makeStorefront({ products: [{ ...PRODUCT_A, specs: rows(MAX_SPEC_ROWS) }] });
    expect(render(theme, d, ["products", PRODUCT_A.slug]).match(/<dt/g)).toHaveLength(MAX_SPEC_ROWS);
  });

  it("empty specs produce no block at all (no empty heading, list or card list)", () => {
    const d = makeStorefront({ products: [{ ...PRODUCT_B, specs: [] }] });
    const detail = render(theme, d, ["products", PRODUCT_B.slug]);
    const list = render(theme, d, ["products"]);
    expect(detail).not.toContain("product-specs");
    expect(detail).not.toContain("مشخصات فنی");
    expect(detail).not.toContain("<dl");
    expect(list).not.toContain("card-specs");
    expect(list).not.toContain("<dl");
  });

  it("labels and values are escaped text: nothing is ever interpreted as markup", () => {
    const evil = { ...PRODUCT_A, specs: [{ label: XSS_LABEL, value: XSS_VALUE }, { label: "x", value: "y" }] };
    const d = makeStorefront({ products: [evil] });
    for (const html of [render(theme, d, ["products"]), render(theme, d, ["products", evil.slug]), render(theme, d)]) {
      expect(html).not.toContain("<script>alert(1)");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  it("data without a specs key (a schema-version-1 product written before specs existed) renders without any spec block", () => {
    const { specs: _drop, ...legacy } = PRODUCT_A as typeof PRODUCT_A & { specs?: unknown };
    void _drop;
    const raw = { ...makeStorefront(), products: [legacy] };
    const html = render(theme, raw as unknown as StorefrontData, ["products", PRODUCT_A.slug]);
    expect(html).toContain("چای سبز");
    expect(html).not.toContain("product-specs");
  });
});
