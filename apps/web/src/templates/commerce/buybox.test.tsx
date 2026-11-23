import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import StorefrontRenderer from "../engine/StorefrontRenderer";
import { buildView } from "../engine/view";

const THEMES = ["bazaar", "circuit", "sormeh", "dookht", "arcade", "sofreh", "golkhaneh", "khaneh"] as const;

function productPage(key: string, commerce: boolean) {
  const demo = loadThemeDemo(key, 3)!;
  const slug = demo.data.products[0]!.slug;
  const view = buildView(demo.data, { basePath: "", segments: ["products", slug], mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") throw new Error(view.status);
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={{ ...view.ctx, commerce }} />);
}

describe("add to cart (phases 3.3/3.4)", () => {
  it.each(THEMES)("%s: the live store's product page has the buy form; previews and demos never do", (key) => {
    expect(productPage(key, true)).toContain("افزودن به سبد خرید");
    expect(productPage(key, false)).not.toContain("افزودن به سبد خرید");
  });

  it("a sold-out product offers no buy form", () => {
    const demo = loadThemeDemo("bazaar", 3)!;
    const data = { ...demo.data, products: demo.data.products.map((p, i) => (i === 0 ? { ...p, stockQuantity: 0 } : p)) };
    const view = buildView(data, { basePath: "", segments: ["products", data.products[0]!.slug], mediaUrl: demo.mediaUrl });
    if (view.status !== "ok") throw new Error(view.status);
    expect(renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={{ ...view.ctx, commerce: true }} />)).not.toContain("افزودن به سبد خرید");
  });
});
