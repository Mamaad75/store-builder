import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING_KEYS } from "@store-builder/shared/templates/landing-content";
import { MAX_SECTIONS_PER_PAGE } from "@store-builder/shared/templates/editor";
import { getSectionDefinition } from "@store-builder/shared/templates/section-registry";
import { loadThemeDemo } from "@/app/themes/demo";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { resolveTemplate } from "./registry";

describe.each(LANDING_KEYS)("%s landing edition", (key) => {
  it("renders the merchant-editable blocks from the actual seed and demo assets", () => {
    const demo = loadThemeDemo(key)!;
    const view = buildView(demo.data, { basePath: "/theme", segments: [], mediaUrl: demo.mediaUrl });
    if (view.status !== "ok") throw new Error(view.status);
    const html = renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
    expect(demo.data.template.version).toBe(4);
    expect(demo.data.products).toHaveLength(6);
    expect(new Set(demo.data.products.map((p) => demo.mediaUrl(p.image!.key))).size).toBe(6);
    const home = demo.data.pages.find((page) => page.type === "HOME")!;
    expect(home.sections.length).toBeGreaterThanOrEqual(11);
    expect(home.sections.length).toBeLessThanOrEqual(MAX_SECTIONS_PER_PAGE);
    for (const block of ["discovery", "campaign", "spotlight", "shelf", "guide"]) {
      const type = `${key}.${block}`;
      expect(html).toContain(`data-landing-section="${block}"`);
      const definition = getSectionDefinition(type)!;
      expect(definition.fields.map((field) => field.name)).toContain("title");
      expect(definition.schema.safeParse({ ...definition.defaults, injected: true }).success).toBe(false);
      expect(view.template.editor.pages.HOME.allowed).toContain(type);
      expect(resolveTemplate(key, 3)?.editor.pages.HOME.allowed).not.toContain(type);
    }
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("renders the campaign and story photos even with an empty catalog", () => {
    const demo = loadThemeDemo(key)!;
    const view = buildView({ ...demo.data, products: [] }, { basePath: "/theme", segments: [], mediaUrl: demo.mediaUrl });
    if (view.status !== "ok") throw new Error(view.status);
    const html = renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
    const campaignStart = html.indexOf('data-landing-section="campaign"');
    expect(campaignStart).toBeGreaterThan(-1);
    const campaign = html.slice(campaignStart, html.indexOf("</section>", campaignStart));
    expect(campaign).toContain('src="/theme-demos/' + key + '-product-2.webp"');
    expect(html).toContain('src="/theme-demos/' + key + '-product-3.webp"');
  });
});

it("filters the in-stock shelf and preserves the editor order", () => {
  const demo = loadThemeDemo("bazaar")!;
  const view = buildView(demo.data, { basePath: "/theme", segments: [], mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") throw new Error(view.status);
  const html = renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
  const start = html.indexOf('aria-labelledby="home-available-heading"');
  const shelf = html.slice(start, html.indexOf("</section>", start));
  expect(shelf).not.toContain("product-3");
  expect(shelf).toContain("product-1");
  expect(html.indexOf('data-landing-section="campaign"')).toBeLessThan(start);
});
