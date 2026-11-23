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

describe("kit v2: header, listing, home rails and product page", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...PRODUCT_A, id: `p${i}`, name: `کالا ${i + 1}`, slug: `kala-${i + 1}`, price: 1000 * (n - i), categoryId: i % 2 === 0 ? "cat-tea" : "cat-coffee" }));

  it.each(KEYS)("%s: the header search is a GET form to the product list that keeps the carried preview query as hidden fields", (key) => {
    const v = buildView(storefront(key), { basePath: "/p", segments: [], carryQuery: `theme=${key}` });
    if (v.status !== "ok") throw new Error(v.status);
    const html = renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
    expect(html).toMatch(/<form[^>]*role="search"[^>]*action="\/p\/products"[^>]*method="get"/);
    expect(html).toContain(`<input type="hidden" name="theme" value="${key}"/>`);
    expect(html).toMatch(/<label[^>]*for="site-search"[^>]*>جستجو در محصولات<\/label>/);
    const input = html.match(/<input[^>]*id="site-search"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('name="q"');
    expect(input).toMatch(/maxLength="60"/i);
  });

  it("a search query is shown escaped in the field and the heading, and the empty result says so", () => {
    const evil = "<b>x</b>";
    const html = (() => {
      const v = buildView(storefront("bazaar"), { basePath: "/p", segments: ["products"], searchParams: { q: evil } });
      if (v.status !== "ok") throw new Error(v.status);
      return renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
    })();
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain('value="&lt;b&gt;x&lt;/b&gt;"');
    expect(html).toContain("نتیجه‌ای برای «&lt;b&gt;x&lt;/b&gt;» پیدا نشد");
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });

  it("sort links keep the category and the search, mark the active order, and the numbered pager keeps all three", () => {
    const data = storefront("circuit", { products: many(40) });
    const v = buildView(data, { basePath: "/p", segments: ["products"], searchParams: { q: "کالا", category: "چای", sort: "cheap", page: "2" } });
    if (v.status !== "ok") throw new Error(v.status);
    const html = renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
    const enc = (s: string) => encodeURIComponent(s);
    expect(html).toContain(`href="/p/products?q=${enc("کالا")}&amp;category=${enc("چای")}&amp;sort=expensive"`);
    expect(html).toMatch(/aria-current="true"[^>]*>ارزان‌ترین</);
    expect(html).toContain(`href="/p/products?q=${enc("کالا")}&amp;category=${enc("چای")}&amp;sort=cheap"`); // page 1 has no page parameter
    expect(html).toMatch(/aria-current="page" aria-label="صفحه ۲"/);
    expect(html).toContain('rel="prev"');
  });

  it("promos link only to a store category or to the product list (owners never type a URL)", () => {
    const data = storefront("khaneh");
    const home = data.pages.find((p) => p.type === "HOME")!;
    const promos = home.sections.find((x) => x.type === "khaneh.promos")!;
    (promos.props as Record<string, unknown>).items = "چای خوب | تازه | چای\nجای دیگر | javascript:alert(1) | https://evil.example\nسوم | | ";
    const html = render(data);
    expect(html).toContain(`href="/p/products?category=${encodeURIComponent("چای")}" data-tone="0"`);
    expect(html).toContain('href="/p/products" data-tone="1"');
    expect(html).toContain('href="/p/products" data-tone="2"');
    expect(html).not.toContain('href="https://evil.example');
    expect(html).not.toContain('href="javascript:');
  });

  it("category rows: one rail per category that has products, each a focusable labelled region with a see-all link", () => {
    const html = render(storefront("bazaar", { products: many(6) }));
    expect(html).toMatch(/role="region" aria-label="چای" tabindex="0"/);
    expect(html).toMatch(/role="region" aria-label="قهوه" tabindex="0"/);
    expect(html).toContain(`aria-label="مشاهده همه محصولات چای"`);
    expect(render(storefront("bazaar", { products: [] }))).not.toContain('aria-label="چای"');
  });

  it("product page: breadcrumbs end at the product, the buy box lists the store's own points, related products exclude the product", () => {
    const data = storefront("sormeh", { products: many(5) });
    const html = render(data, ["products", "kala-1"]);
    expect(html).toMatch(/<li aria-current="page">کالا 1<\/li>/);
    expect(html).toContain("اصالت کالا: تضمین‌شده");
    const related = html.slice(html.indexOf("دیگر محصولات"));
    expect(related).toContain('href="/p/products/kala-3"');
    expect(related).not.toContain('href="/p/products/kala-1"');
  });

  it("the mobile dock lists the store's pages with the current one marked", () => {
    const html = render(storefront("golkhaneh"), ["contact"]);
    const dock = html.slice(html.indexOf('aria-label="پیمایش سریع"'));
    expect(dock).toMatch(/href="\/p\/contact" aria-current="page"/);
    expect(dock).toContain('href="/p/products"');
  });

  it("pageWindow keeps first, last and neighbours with gaps; highlightIcon maps owner points by keyword", async () => {
    const { pageWindow } = await import("./kit");
    const { highlightIcon } = await import("./icons");
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(5, 9)).toEqual([1, null, 4, 5, 6, null, 9]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
    expect(highlightIcon("ارسال سریع: به سراسر کشور")).toBe("truck");
    expect(highlightIcon("گارانتی معتبر")).toBe("shield");
    expect(highlightIcon("چیزی دیگر")).toBe("check");
  });
});

describe.each(KEYS)("kit theme %s: product variants (phase 3.2)", (key) => {
  const withVariants = {
    ...PRODUCT_A,
    price: 90000,
    stockQuantity: 3,
    variants: [
      { id: "v1", options: [{ name: "رنگ", value: "قرمز" }, { name: "سایز", value: "M" }], price: 90000, stockQuantity: 3 },
      { id: "v2", options: [{ name: "رنگ", value: "<b>آبی</b>" }, { name: "سایز", value: "L" }], price: 120000, stockQuantity: 0 },
    ],
  };
  it("the product page lists every variant with its price and stock in a captioned table; text is escaped", () => {
    const html = render(storefront(key, { products: [withVariants] }), ["products", PRODUCT_A.slug]);
    expect(html).toMatch(/<table[^>]*><caption[^>]*>تنوع‌ها<\/caption>/);
    expect(html).toContain("<th scope=\"col\">رنگ / سایز</th>");
    expect(html).toContain("<th scope=\"row\">قرمز / M</th>");
    expect(html).toContain("&lt;b&gt;آبی&lt;/b&gt; / L");
    expect(html).not.toContain("<b>آبی</b>");
    expect(html).toContain((120000).toLocaleString("fa-IR"));
    expect(html).toContain("از "); // the lowest price is a "from" price
  });
  it("cards show a from-price only when the variants differ in price; products without variants are unchanged", () => {
    expect(render(storefront(key, { products: [withVariants] }), ["products"])).toContain("از </span>");
    const same = { ...withVariants, variants: withVariants.variants.map((v) => ({ ...v, price: 90000 })) };
    expect(render(storefront(key, { products: [same] }), ["products"])).not.toContain("از </span>");
    const plain = render(storefront(key, { products: [PRODUCT_A] }), ["products", PRODUCT_A.slug]);
    expect(plain).not.toContain("تنوع‌ها");
  });
});
