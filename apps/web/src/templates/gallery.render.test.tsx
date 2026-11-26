import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import { THEME_CATALOG } from "@store-builder/shared/templates/theme-catalog";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";

/** The extra product images on the product page of EVERY registered theme version; products without extras render exactly as before. */
function detail(key: string, version: number, extras: number) {
  const demo = loadThemeDemo(key, version);
  if (!demo) return null;
  const first = demo.data.products.find((p) => p.image);
  if (!first) return null;
  // the demo only resolves the media it ships with, so the extras reuse the other products' images
  const pool = demo.data.products.filter((p) => p.id !== first.id && p.image).map((p) => p.image!);
  const gallery = Array.from({ length: extras }, (_, i) => pool[i % Math.max(pool.length, 1)] ?? first.image!);
  const data = { ...demo.data, products: demo.data.products.map((p) => (p.id === first.id ? { ...p, ...(extras ? { gallery } : {}) } : p)) };
  const view = buildView(data, { basePath: "/p", segments: ["products", first.slug], mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") throw new Error(`${key}@${version}: ${view.status}`);
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
}

describe("product gallery in every theme's product page", () => {
  const themes = THEME_CATALOG.map((t) => [t.key, t.version] as const);

  it.each(themes)("%s@%i shows the extra images only when the product has them", (key, version) => {
    const withExtras = detail(key, version, 3);
    if (withExtras === null) return;
    const strip = withExtras.slice(withExtras.indexOf("data-gallery"));
    expect(strip, `${key}@${version} strip`).toContain("data-gallery");
    expect((strip.match(/<img /g) ?? []).length, `${key}@${version} thumbnails`).toBeGreaterThanOrEqual(3);
    expect(withExtras).toContain("تصویر ۲");
    const plain = detail(key, version, 0)!;
    expect(plain).not.toContain("data-gallery");
  });

  it("every theme was rendered (the loop is not vacuous)", () => {
    expect(themes.filter(([k, v]) => detail(k, v, 3) !== null).length).toBeGreaterThanOrEqual(20);
  });
});
