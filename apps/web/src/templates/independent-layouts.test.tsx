import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { resolveTemplate } from "./registry";

const layouts = [
  ["bazaar", "compact-promotion", "catalog"],
  ["circuit", "spec-hero", "technical-catalog"],
  ["sormeh", "beauty-arch", "beauty-catalog"],
  ["dookht", "fashion-cover", "fashion-editorial"],
  ["arcade", "platform-band", "platform-catalog"],
  ["sofreh", "short-cafe-strip", "menu-catalog"],
  ["golkhaneh", "occasion-carousel", "occasion-catalog"],
  ["khaneh", "homeware-dual-promotion", "homeware-sidebar"],
] as const;

function render(key: string, segments: string[], hideBanner = false) {
  const demo = loadThemeDemo(key, 3)!;
  const view = buildView(hideBanner ? { ...demo.data, images: {} } : demo.data, { basePath: "/p", segments, mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") throw new Error(view.status);
  return { demo, html: renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />) };
}

const structure = (html: string) => html.match(/<\/?(?:header|nav|main|aside|section|article|footer|form|ul|ol|figure|details|h1|h2)(?=[\s>])/g)?.join("");

describe("independent storefronts", () => {
  it.each(layouts)("%s retains old versions and renders all three demo products", (key, hero, catalog) => {
    const home = render(key, []);
    const listing = render(key, ["products"]);
    expect(home.demo.data.template.version).toBe(3);
    expect(home.html).toContain(`="${hero}"`);
    expect(listing.html).toContain(`="${catalog}"`);
    expect(home.demo.data.categories).toHaveLength(3);
    expect(home.demo.data.products.map((p) => home.demo.mediaUrl(p.image!.key))).toEqual(
      [1, 2, 3].map((i) => `/theme-demos/${key}-product-${i}.webp`),
    );
    for (const previous of [1, 2]) {
      expect(resolveTemplate(key, previous)?.Layout).toBeTypeOf("function");
      expect(resolveTemplate(key, 3)?.Layout).not.toBe(resolveTemplate(key, previous)?.Layout);
    }
  });

  it.each([{ segments: [] }, { segments: ["products"] }, { segments: ["products", "product-1"] }])(
    "gives every theme a different DOM at $segments",
    ({ segments }) => {
      const signatures = layouts.map(([key]) => structure(render(key, segments).html));
      expect(new Set(signatures).size).toBe(layouts.length);
    },
  );

  it.each(layouts.slice(1))("%s reuses the first product photo when the merchant has no banner", (key, hero) => {
    const { html } = render(key, [], true);
    const start = html.indexOf(`data-structure="${hero}"`);
    const banner = html.slice(start, html.indexOf("</section>", start));
    expect(banner).toContain(`src="/theme-demos/${key}-product-1.webp"`);
  });
});
