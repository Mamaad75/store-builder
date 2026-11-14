import { describe, expect, it } from "vitest";
import { makeStorefront, PRODUCT_A, PRODUCT_B } from "@/test/storefront-fixtures";
import { buildView } from "@/templates/engine/view";
import { storefrontDataSchema, type StorefrontData } from "@/templates/storefront-data";
import { buildJsonLd, serializeJsonLd, socialProfileUrls } from "./jsonld";
import { buildMetadata, canonicalPath, pageDescription, pageTitle, type SeoContext } from "./metadata";
import { buildSitemapXml, buildStoreRobotsTxt, sitemapPaths, xmlEscape } from "./sitemap";
import { clip, cleanText } from "./text";

const BASE = "https://shop.example.com";
const media = (key: string) => `https://cdn.example.com/${key}`;
const KEY = `stores/s1/${"a".repeat(32)}.webp`;
const KEY2 = `stores/s1/${"b".repeat(32)}.webp`;

function ctxFor(data: StorefrontData, segments: string[] = [], searchParams: Record<string, string | string[] | undefined> = {}): SeoContext {
  const view = buildView(data, { basePath: "", segments, searchParams, mediaUrl: media });
  if (view.status !== "ok") throw new Error(`view ${view.status}`);
  return { data: view.ctx.data, page: view.ctx.page, query: view.ctx.query, product: view.ctx.product, mediaUrl: media };
}
const withStore = (over: Partial<StorefrontData["store"]>, base: Partial<StorefrontData> = {}) => {
  const d = makeStorefront(base);
  return { ...d, store: { ...d.store, ...over } };
};
const manyProducts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...PRODUCT_A, id: `p${i}`, name: `کالا ${i + 1}`, slug: `kala-${i + 1}`, categoryId: i % 2 === 0 ? "cat-tea" : "cat-coffee" }));

const cat_tea = () => `/products?category=${encodeURIComponent("چای")}`;

describe("text helpers", () => {
  it("cleanText collapses whitespace and strips control characters", () => {
    expect(cleanText("  a\n\n b\t\u0000c  ")).toBe("a b c");
  });
  it("clip never exceeds the limit (counted in characters, Persian included), cuts on a word when it can, and marks the cut", () => {
    expect(clip("کوتاه")).toBe("کوتاه");
    const long = "کلمه ".repeat(80);
    const c = clip(long, 160);
    expect(Array.from(c).length).toBeLessThanOrEqual(160);
    expect(c.endsWith("…")).toBe(true);
    expect(c.endsWith(" …")).toBe(false);
    expect(Array.from(clip("x".repeat(200), 160)).length).toBe(160); // no space to cut on: hard cut
    expect(clip("😀".repeat(200), 10)).toBe(`${"😀".repeat(9)}…`); // never splits a surrogate pair
  });
});

describe("page metadata", () => {
  it("home: absolute title is the store name, description is the owner's, canonical/OG/Twitter/robots are right", () => {
    const data = withStore({ description: "فروشگاه چای و قهوهٔ ایرانی با ارسال سریع" });
    const m = buildMetadata(ctxFor(data), BASE);
    expect(m.title).toEqual({ absolute: "فروشگاه نمونه" }); // never the platform suffix
    expect(m.description).toBe("فروشگاه چای و قهوهٔ ایرانی با ارسال سریع");
    expect(m.alternates?.canonical).toBe(`${BASE}/`);
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.openGraph).toMatchObject({ type: "website", url: `${BASE}/`, siteName: "فروشگاه نمونه", locale: "fa_IR", title: "فروشگاه نمونه" });
    expect(m.twitter).toMatchObject({ card: "summary" });
    expect((m.openGraph as { images?: unknown }).images).toBeUndefined();
  });

  it("home: without an owner description it falls back to the first meaningful home text, then to the store name", () => {
    const data = makeStorefront();
    const d = pageDescription(ctxFor(data));
    expect(d.length).toBeGreaterThan(5);
    expect(Array.from(d).length).toBeLessThanOrEqual(160);
    const bare = makeStorefront({ pages: makeStorefront().pages.map((p) => (p.type === "HOME" ? { ...p, sections: [] } : p)) });
    expect(pageDescription(ctxFor(bare))).toBe("فروشگاه نمونه");
  });

  it("the logo is the share image when there is no product photo; Twitter becomes summary_large_image", () => {
    const m = buildMetadata(ctxFor(withStore({ logo: { key: KEY, width: 200, height: 100 } })), BASE);
    expect((m.openGraph as { images: unknown[] }).images).toEqual([{ url: media(KEY), width: 200, height: 100, alt: "فروشگاه نمونه" }]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("product: title 'name | store', cleaned description, encoded canonical, the product photo beats the logo", () => {
    const withImage = { ...PRODUCT_A, image: { key: KEY2, width: 640, height: 480 } };
    const data = withStore({ logo: { key: KEY, width: 200, height: 100 } }, { products: [withImage, PRODUCT_B] });
    const ctx = ctxFor(data, ["products", encodeURIComponent(PRODUCT_A.slug)]);
    const m = buildMetadata(ctx, BASE);
    expect(pageTitle(ctx)).toBe("چای سبز | فروشگاه نمونه");
    expect(m.description).toBe("چای سبز ایرانی بسته‌بندی ۲۵۰ گرمی"); // the newline became a space
    expect(m.alternates?.canonical).toBe(`${BASE}/products/${encodeURIComponent("چای-سبز")}`);
    expect(canonicalPath(ctx)).toBe(`/products/${encodeURIComponent("چای-سبز")}`);
    expect((m.openGraph as { images: { url: string; alt: string }[] }).images[0]).toMatchObject({ url: media(KEY2), alt: "چای سبز" });
  });

  it("product without a description gets a safe generated one", () => {
    const ctx = ctxFor(makeStorefront(), ["products", encodeURIComponent(PRODUCT_B.slug)]);
    expect(pageDescription(ctx)).toBe("قهوه اسپرسو - فروشگاه نمونه");
  });

  it("listing: category title/description and canonical; pagination is self-canonical and the page number is CLAMPED", () => {
    const data = makeStorefront({ products: manyProducts(25) }); // 13 tea + 12 coffee -> 2 pages for tea
    const base = ctxFor(data, ["products"]);
    expect(canonicalPath(base)).toBe("/products");
    const tea = ctxFor(data, ["products"], { category: "چای" });
    expect(pageTitle(tea)).toBe("چای | فروشگاه نمونه");
    expect(canonicalPath(tea)).toBe(`/products?category=${encodeURIComponent("چای")}`);
    expect(pageDescription(tea)).toContain("۱۳ محصول");
    const p2 = ctxFor(data, ["products"], { page: "2" });
    expect(canonicalPath(p2)).toBe("/products?page=2");
    expect(pageTitle(p2)).toBe("محصولات - صفحه ۲ | فروشگاه نمونه");
    expect(canonicalPath(ctxFor(data, ["products"], { page: "999" }))).toBe("/products?page=3"); // 25 products = 3 pages
    expect(canonicalPath(ctxFor(data, ["products"], { category: "چای", page: "2" }))).toBe(`/products?category=${encodeURIComponent("چای")}&page=2`);
  });

  it("category pages are explicitly indexable with their own canonical; every page/category combination is self-canonical", () => {
    const data = makeStorefront({ products: manyProducts(25) }); // tea: 13 -> 2 pages, coffee: 12 -> 1 page
    const cat = (s: string) => `/products?category=${encodeURIComponent(s)}`;
    const cases: [Record<string, string>, string][] = [
      [{ category: "چای" }, cat("چای")],
      [{ category: "قهوه" }, cat("قهوه")],
      [{ category: "چای", page: "2" }, `${cat("چای")}&page=2`],
      [{ category: "چای", page: "1" }, cat("چای")], // page 1 is the category page itself
      [{ category: "چای", page: "99" }, `${cat("چای")}&page=2`], // clamped to the category's last page, not the global one
      [{ category: "قهوه", page: "2" }, cat("قهوه")], // coffee has one page
      [{ page: "3" }, "/products?page=3"],
    ];
    for (const [sp, path] of cases) {
      const ctx = ctxFor(data, ["products"], sp);
      const m = buildMetadata(ctx, BASE);
      expect(canonicalPath(ctx), JSON.stringify(sp)).toBe(path);
      expect(m.alternates?.canonical, JSON.stringify(sp)).toBe(`${BASE}${path}`);
      expect(m.robots, JSON.stringify(sp)).toEqual({ index: true, follow: true });
    }
  });

  it("invalid and irrelevant parameters are normalised safely (never echoed, never crash, never noindex)", () => {
    const data = makeStorefront({ products: manyProducts(25) });
    const tea = cat_tea();
    const bad: Record<string, string | string[] | undefined>[] = [
      { category: "no-such", page: "2" }, // unknown category is dropped, valid page kept
      { category: ["چای", "قهوه"] }, // repeated parameter
      { category: "", page: "" },
      { category: "چای", page: "0" },
      { category: "چای", page: "1.5" },
      { category: "چای", page: "2abc" },
      { category: "چای", page: "99999999999999999999" },
      { category: "<script>alert(1)</script>", page: "NaN" },
      { category: "چای", utm_source: "x", sort: "price", q: "tea" } as never,
    ];
    for (const sp of bad) {
      const ctx = ctxFor(data, ["products"], sp as Record<string, string>);
      const c = canonicalPath(ctx);
      expect(c, JSON.stringify(sp)).toMatch(/^\/products(\?[^#]*)?$/);
      for (const junk of ["utm", "sort", "q=", "script", "no-such", "NaN", "%5B"]) expect(c, JSON.stringify(sp)).not.toContain(junk);
      expect(c).not.toMatch(/page=(0|1)(&|$)/);
      expect(buildMetadata(ctx, BASE).robots).toEqual({ index: true, follow: true });
    }
    expect(canonicalPath(ctxFor(data, ["products"], { category: "چای", page: "0" }))).toBe(tea);
    expect(canonicalPath(ctxFor(data, ["products"], { category: "no-such", page: "2" }))).toBe("/products?page=2");
  });

  it("junk parameters never reach the canonical URL (utm, unknown category, garbage page)", () => {
    const data = makeStorefront({ products: manyProducts(25) });
    for (const sp of [{ utm_source: "x", fbclid: "y" }, { category: "no-such" }, { page: "abc" }, { page: "-1" }, { page: ["2", "3"], utm: "1" }]) {
      const c = canonicalPath(ctxFor(data, ["products"], sp));
      expect(c, JSON.stringify(sp)).toMatch(/^\/products(\?page=2)?$/);
      expect(c).not.toContain("utm");
    }
  });

  it("about and contact pages use their own titles", () => {
    const data = makeStorefront();
    expect(pageTitle(ctxFor(data, ["about"]))).toMatch(/\| فروشگاه نمونه$/);
    expect(canonicalPath(ctxFor(data, ["contact"]))).toBe("/contact");
  });

  it("the base URL is exactly what the caller passes (configuration), never something found in the data", () => {
    const m = buildMetadata(ctxFor(makeStorefront()), "http://label.localhost:3100");
    expect(m.alternates?.canonical).toBe("http://label.localhost:3100/");
  });
});

describe("JSON-LD", () => {
  it("home: Organization and WebSite, with contact details, logo and only well-formed social profiles", () => {
    const data = withStore({ description: "توضیح", logo: { key: KEY, width: 200, height: 100 }, social: { instagram: "@shop_sample", telegram: "bad handle!", whatsapp: "+98 912 000 0000" } });
    const [org, site] = buildJsonLd(ctxFor(data), BASE) as Record<string, unknown>[];
    expect(org).toMatchObject({
      "@type": "Organization",
      name: "فروشگاه نمونه",
      url: `${BASE}/`,
      description: "توضیح",
      logo: media(KEY),
      contactPoint: { "@type": "ContactPoint", telephone: "۰۲۱-۱۲۳۴۵۶۷۸", email: "shop@example.com" },
      address: { "@type": "PostalAddress", streetAddress: "تهران، خیابان آزادی" },
    });
    expect(org!.sameAs).toEqual(["https://www.instagram.com/shop_sample", "https://wa.me/989120000000"]);
    expect(site).toMatchObject({ "@type": "WebSite", name: "فروشگاه نمونه", url: `${BASE}/`, inLanguage: "fa" });
  });

  it("social handles are validated, never guessed", () => {
    expect(socialProfileUrls({ instagram: "a/b", telegram: "ab", whatsapp: "123" })).toEqual([]);
    expect(socialProfileUrls({ instagram: "", telegram: "my_shop", whatsapp: "" })).toEqual(["https://t.me/my_shop"]);
  });

  it("product: Product with an IRR offer (Toman x 10), availability from stock, specs, and a breadcrumb trail", () => {
    const withSpecs = { ...PRODUCT_A, specs: [{ label: "وزن", value: "۲۵۰ گرم" }] };
    const docs = buildJsonLd(ctxFor(makeStorefront({ products: [withSpecs, PRODUCT_B] }), ["products", encodeURIComponent(PRODUCT_A.slug)]), BASE) as Record<string, unknown>[];
    const [product, crumbs] = docs;
    expect(product).toMatchObject({
      "@type": "Product",
      name: "چای سبز",
      category: "چای",
      additionalProperty: [{ "@type": "PropertyValue", name: "وزن", value: "۲۵۰ گرم" }],
      offers: { "@type": "Offer", priceCurrency: "IRR", price: "1250000", availability: "https://schema.org/InStock" },
    });
    expect((crumbs as { itemListElement: { position: number; item: string }[] }).itemListElement.map((i) => [i.position, i.item])).toEqual([
      [1, `${BASE}/`],
      [2, `${BASE}/products`],
      [3, `${BASE}/products/${encodeURIComponent("چای-سبز")}`],
    ]);
  });

  it("out-of-stock and zero-price products: OutOfStock offer, and no Offer at all for a zero price", () => {
    const out = buildJsonLd(ctxFor(makeStorefront(), ["products", encodeURIComponent(PRODUCT_B.slug)]), BASE)[0] as { offers: { availability: string; price: string } };
    expect(out.offers).toMatchObject({ availability: "https://schema.org/OutOfStock", price: "9800000" });
    const free = makeStorefront({ products: [{ ...PRODUCT_A, price: 0 }] });
    expect((buildJsonLd(ctxFor(free, ["products", encodeURIComponent(PRODUCT_A.slug)]), BASE)[0] as Record<string, unknown>).offers).toBeUndefined();
  });

  it("listing, about and contact pages carry no structured data", () => {
    for (const seg of [["products"], ["about"], ["contact"]]) expect(buildJsonLd(ctxFor(makeStorefront(), seg), BASE)).toEqual([]);
  });

  it("serialisation cannot break out of the script tag, whatever the store data contains", () => {
    const hostile = '</script><script>alert(1)</script><!-- &amp; \u2028 \u2029';
    const data = withStore({ name: hostile.slice(0, 80), description: hostile.slice(0, 120) });
    for (const doc of buildJsonLd(ctxFor(data), BASE)) {
      const out = serializeJsonLd(doc);
      expect(out).not.toMatch(/[<>&\u2028\u2029]/);
      expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(doc))); // lossless: the escapes decode back to the same data
    }
  });
});

describe("sitemap.xml and robots.txt", () => {
  const data = makeStorefront();

  it("lists the visible pages, categories that have products, and every product, with encoded Persian paths", () => {
    const paths = sitemapPaths(data);
    expect(paths).toEqual([
      "/",
      "/products",
      `/products?category=${encodeURIComponent("چای")}`,
      `/products?category=${encodeURIComponent("قهوه")}`,
      "/about",
      "/contact",
      `/products/${encodeURIComponent("چای-سبز")}`,
      `/products/${encodeURIComponent("قهوه-اسپرسو")}`,
    ]);
  });

  it("a category without products and a page that is not part of the snapshot (hidden) are not listed", () => {
    const d = makeStorefront({ categories: [...data.categories, { id: "empty", name: "خالی", slug: "خالی" }], pages: data.pages.filter((p) => p.type !== "ABOUT") });
    const paths = sitemapPaths(d);
    expect(paths).not.toContain("/about");
    expect(paths.some((p) => p.includes(encodeURIComponent("خالی")))).toBe(false);
  });

  it("is well-formed XML with escaped URLs and an ISO lastmod", () => {
    const xml = buildSitemapXml(data, "https://a.example.com/?x=1&y=2", new Date("2026-11-14T10:20:30.000Z"));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<lastmod>2026-11-14T10:20:30.000Z</lastmod>");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/); // no raw ampersand anywhere
    expect((xml.match(/<url>/g) ?? []).length).toBe(sitemapPaths(data).length);
    expect(xmlEscape(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });

  it("robots.txt allows everything and points to the sitemap on the same host", () => {
    expect(buildStoreRobotsTxt(BASE)).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
  });
});

describe("snapshot contract: the optional description", () => {
  it("snapshots written before this field existed stay valid, and a set description round-trips", () => {
    const old = makeStorefront();
    expect("description" in old.store).toBe(false);
    expect(storefrontDataSchema.safeParse(old).success).toBe(true);
    expect(storefrontDataSchema.safeParse(withStore({ description: "ok" })).success).toBe(true);
    expect(storefrontDataSchema.safeParse(withStore({ description: "x".repeat(161) })).success).toBe(false);
    // parsing an old snapshot does not invent the field (no default), so content hashes of untouched stores never change
    const parsed = storefrontDataSchema.parse(old);
    expect("description" in parsed.store).toBe(false);
  });
});
