import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import StorefrontRenderer from "../engine/StorefrontRenderer";
import { buildView } from "../engine/view";
import { resolveTemplate } from "../registry";

const demo = loadThemeDemo("bazaar")!;

function render(version: number, segments: string[]) {
  const view = buildView({ ...demo.data, template: { key: "bazaar", version } }, { basePath: "/demo", segments, mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") throw new Error(view.status);
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
}

// Keep only structural tags. Text, classes, assets and CSS cannot affect this signature.
const structure = (html: string) => html.match(/<\/?(?:header|nav|main|aside|section|article|footer|form|ul|ol|h1|h2)(?=[\s>])/g);

describe("Bazaar marketplace layout", () => {
  it.each([{ segments: [] }, { segments: ["products"] }, { segments: ["products", "product-1"] }])("uses independent DOM at $segments", ({ segments }) => {
    const market = render(3, segments);
    for (const previous of [1, 2]) {
      expect(structure(market)).not.toEqual(structure(render(previous, segments)));
      expect(resolveTemplate("bazaar", previous)?.Layout).not.toBe(resolveTemplate("bazaar", 3)?.Layout);
      expect(render(previous, segments)).not.toContain("data-bazaar-layout");
    }
    expect(market).toMatch(/<header>.*role="search".*<\/header>|<header class="[^"]+">.*role="search".*<\/header>/);
    expect(market).toContain('data-bazaar-region="category-navigation"');
    expect(market).toContain('data-bazaar-region="department-footer"');
    expect(market.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("exposes a compact banner, circular categories, home rails and a separate product grid", () => {
    const home = render(3, []);
    expect(home).toContain('data-bazaar-region="compact-promotion"');
    expect(home).toContain('data-bazaar-region="category-circles"');
    expect(home).toContain('data-bazaar-catalog="rail"');
    expect(home).not.toContain('data-bazaar-catalog="grid"');
    const listing = render(3, ["products"]);
    expect(listing).toContain('data-bazaar-catalog="grid"');
    expect(listing).toContain('aria-label="فیلتر دسته‌بندی"');
    expect(listing).not.toContain('data-bazaar-region="compact-promotion"');
  });

  it("has three categories, three distinct local product images and separate banner artwork", () => {
    expect(demo.data.categories).toHaveLength(3);
    expect(demo.data.products).toHaveLength(3);
    const images = demo.data.products.map((product) => demo.mediaUrl(product.image!.key));
    expect(new Set(images).size).toBe(3);
    expect(images.every((url) => url?.startsWith("/theme-demos/bazaar-product-"))).toBe(true);
    expect(demo.mediaUrl(demo.data.images["hero-art"]!.key)).toBe("/theme-demos/bazaar.webp");
  });
});
