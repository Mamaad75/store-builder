import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { analyzePage } from "@store-builder/shared/modules/pages/analyze";
import { TEMPLATE_DEFINITIONS, templateDefinitionSchema } from "@store-builder/shared/templates/definitions";
import { KIT_THEMES } from "@store-builder/shared/templates/kit/themes";
import type { StorefrontData } from "@store-builder/shared/templates/storefront-data";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import StorefrontRenderer from "../engine/StorefrontRenderer";
import { buildView } from "../engine/view";

const KEYS = KIT_THEMES.map((t) => t.key);
const seedOf = (key: string) => TEMPLATE_DEFINITIONS.find((d) => d.key === key)!;

/** A storefront of `key` with the theme's own seeded pages (so every kit section is on the page). */
function storefront(key: string, over: Partial<StorefrontData> = {}): StorefrontData {
  const pages = structuredClone(seedOf(key).pages.map((p, i) => ({ ...p, position: i }))) as StorefrontData["pages"];
  return makeStorefront({ template: { key, version: 1 }, pages, ...over });
}
function render(data: StorefrontData, segments: string[] = []) {
  const v = buildView(data, { basePath: "/p", segments, mediaUrl: (k) => `https://media.example/${k}` });
  if (v.status !== "ok") throw new Error(`view ${v.status}`);
  return renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
}

describe.each(KEYS)("kit theme %s: seed and rendering", (key) => {
  it("its seed is valid and every seeded section is ACTIVE under the theme's own editor rules", () => {
    const def = seedOf(key);
    expect(templateDefinitionSchema.safeParse({ settings: def.settings, pages: def.pages }).success).toBe(true);
    const theme = KIT_THEMES.find((t) => t.key === key)!;
    for (const page of def.pages) {
      const a = analyzePage(page.sections, theme.editor.pages[page.type]);
      expect(a.invalid, `${key} ${page.type}`).toEqual([]);
      expect(a.entries.every((e) => e.kind === "active"), `${key} ${page.type}`).toBe(true);
    }
  });

  it("the home page shows the store's categories as links to the filtered list, and the highlights as a list", () => {
    const html = render(storefront(key));
    expect(html).toContain('href="/p/products?category=%DA%86%D8%A7%DB%8C"'); // چای
    expect(html).toContain(`data-template="${key}"`);
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>.*<\/li>/);
  });

  it("without categories the tiles section renders nothing (no empty heading)", () => {
    const html = render(storefront(key, { categories: [], products: [{ ...PRODUCT_A, categoryId: null }] }));
    expect(html).not.toContain("category=");
  });

  it("every page type renders, with exactly one h1 per page", () => {
    const data = storefront(key);
    for (const segs of [[], ["products"], ["products", PRODUCT_A.slug], ["about"], ["contact"]]) {
      const html = render(data, segs);
      expect(html.match(/<h1[\s>]/g), `${key} /${segs.join("/")}`).toHaveLength(1);
    }
  });

  it("theme text and store data are escaped (nothing becomes markup)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const data = storefront(key, { categories: [{ id: "c1", name: evil, slug: "x" }], products: [{ ...PRODUCT_A, categoryId: "c1", name: evil }] });
    for (const segs of [[], ["products"]]) {
      const html = render(data, segs);
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x");
    }
  });

  it("a placeholder (no image yet) is hidden from assistive technology", () => {
    const html = render(storefront(key));
    for (const m of html.matchAll(/<span class="[^"]*_placeholder_[^"]*"([^>]*)>/g)) expect(m[1]).toContain('aria-hidden="true"');
  });
});

describe("kit: theme-specific sections", () => {
  it("sofreh: the menu and hours are definition lists that contain only dt/dd groups (valid HTML, no stray elements)", () => {
    const html = render(storefront("sofreh"));
    const lists = [...html.matchAll(/<dl[^>]*>(.*?)<\/dl>/g)].map((m) => m[1]!);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const inner of lists) expect(inner.replace(/<div[^>]*><dt[^>]*>.*?<\/dt><dd[^>]*>.*?<\/dd><\/div>/g, "")).toBe("");
    expect(html).toContain("اسپرسو دوبل");
    expect(html).toContain("شنبه تا چهارشنبه");
  });

  it("sofreh: the card's WhatsApp order exists only when the store has a valid WhatsApp number, with the product name encoded", () => {
    expect(render(storefront("sofreh"), ["products"])).not.toContain("wa.me");
    const data = storefront("sofreh");
    data.store.social.whatsapp = "+98 912 000 0000";
    const html = render(data, ["products"]);
    expect(html).toContain(`href="https://wa.me/989120000000?text=${encodeURIComponent(`سلام، برای سفارش «${PRODUCT_A.name}» پیام می‌دهم.`).replace(/&/g, "&amp;")}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(`aria-label="سفارش در واتساپ: ${PRODUCT_A.name}"`);
  });

  it("product detail (any kit theme): order buttons only for the contact routes the store really has", () => {
    const plain = render(storefront("bazaar"), ["products", PRODUCT_A.slug]);
    expect(plain).toContain('href="tel:02112345678"');
    expect(plain).not.toContain("wa.me");
    const data = storefront("bazaar");
    data.store.contact.phone = "";
    expect(render(data, ["products", PRODUCT_A.slug])).not.toContain("تماس برای سفارش");
  });

  it("arcade: activation steps are an ordered list (a real sequence)", () => {
    const html = render(storefront("arcade"));
    expect(html).toMatch(/<ol[^>]*>(<li[^>]*>.*?<\/li>){4}<\/ol>/);
  });

  it("golkhaneh: the delivery band has its own heading and badge", () => {
    const html = render(storefront("golkhaneh"));
    expect(html).toContain("ارسال همان روز");
    expect(html).toContain("تا ساعت ۱۸");
  });

  it("dookht: the size guide is a real table with column and row headers", () => {
    const html = render(storefront("dookht"), ["products"]);
    expect(html).toContain('<th scope="col">سایز</th>');
    expect(html).toContain('<th scope="row">M</th>');
  });
});
