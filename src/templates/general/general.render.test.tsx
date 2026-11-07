import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeStorefront, CATEGORY_TEA, PRODUCT_A, PRODUCT_B } from "@/test/storefront-fixtures";
import StorefrontRenderer from "../engine/StorefrontRenderer";
import { buildView } from "../engine/view";
import type { StorefrontData } from "../storefront-data";
import type { TemplateModule } from "../types";
import { generalTemplate } from "./index";

const CDN = "https://cdn.example.test/bucket";
function render(data: StorefrontData, segments: string[] = [], sp?: Record<string, string>, mediaUrl: (k: string) => string | null = (k) => `${CDN}/${k}`) {
  const v = buildView(data, { basePath: "/preview/s1", segments, searchParams: sp, mediaUrl });
  if (v.status !== "ok") throw new Error(`view ${v.status}`);
  return renderToStaticMarkup(<StorefrontRenderer template={v.template} ctx={v.ctx} />);
}

describe("general template: layout", () => {
  const html = render(makeStorefront());
  it("is RTL Persian with a skip link, one main landmark, nav and footer", () => {
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="fa"');
    expect(html).toContain('href="#main"');
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('aria-label="منوی اصلی"');
    expect(html).toContain("<footer");
  });
  it("renders the store name and nav entries from the pages, marking the current one", () => {
    expect(html).toContain("فروشگاه نمونه");
    expect(html).toMatch(/aria-current="page"[^>]*>خانه/);
    expect(html).toContain('href="/preview/s1/products"');
  });
  it("has exactly one h1 on every page type", () => {
    const d = makeStorefront();
    for (const segs of [[], ["products"], ["about"], ["contact"], ["products", PRODUCT_A.slug]]) {
      expect(render(d, segs).match(/<h1[ >]/g), segs.join("/")).toHaveLength(1);
    }
  });
  it("supports ltr stores and applies the brand color with readable text", () => {
    const d = makeStorefront();
    d.store.direction = "ltr";
    d.store.primaryColor = "#facc15";
    const h = render(d);
    expect(h).toContain('dir="ltr"');
    expect(h).toContain("--primary:#facc15");
    expect(h).toContain("--on-primary:#111827");
  });
});

describe("general template: sections", () => {
  it("hero + featured products + imageText + call to action on the home page", () => {
    const h = render(makeStorefront());
    expect(h).toContain("محصولات ویژه");
    expect(h).toContain("چای سبز");
    expect(h).toContain("قهوه اسپرسو");
    expect(h).toContain("برای سفارش با ما در تماس باشید");
  });
  it("product listing shows name, price in Toman (Persian digits), stock and category", () => {
    const h = render(makeStorefront(), ["products"]);
    expect(h).toContain("۱۲۵٬۰۰۰ تومان");
    expect(h).toContain("۹۸۰٬۰۰۰ تومان");
    expect(h).toContain("موجود");
    expect(h).toContain("ناموجود");
  });
  it("zero stock is displayed as out of stock but the product is still listed (stock independent of visibility)", () => {
    const h = render(makeStorefront(), ["products"]);
    expect(h).toContain("قهوه اسپرسو");
    expect(h).toContain("ناموجود");
  });
  it("low stock is called out", () => {
    const d = makeStorefront({ products: [{ ...PRODUCT_A, stockQuantity: 3 }], categories: [CATEGORY_TEA] });
    expect(render(d, ["products"])).toContain("تنها ۳ عدد باقی مانده");
  });
  it("product links encode the slug so Persian slugs are valid URLs", () => {
    const h = render(makeStorefront(), ["products"]);
    expect(h).toContain(`href="/preview/s1/products/${encodeURIComponent(PRODUCT_A.slug)}"`);
  });
  it("category filter lists categories and filters the listing", () => {
    const all = render(makeStorefront(), ["products"]);
    expect(all).toContain("دسته‌بندی محصولات");
    const tea = render(makeStorefront(), ["products"], { category: CATEGORY_TEA.slug });
    expect(tea).toContain("چای سبز");
    expect(tea).not.toContain("قهوه اسپرسو</a>");
    expect(tea).toMatch(/aria-current="true"[^>]*>چای/);
  });
  it("empty category shows an empty state", () => {
    const d = makeStorefront({ products: [PRODUCT_A] });
    const h = render(d, ["products"], { category: "قهوه" });
    expect(h).toContain("در این دسته محصولی وجود ندارد");
  });
  it("empty storefront (no products, no categories) renders empty states instead of breaking", () => {
    const d = makeStorefront({ products: [], categories: [] });
    expect(render(d)).toContain("هنوز محصولی منتشر نشده است");
    const list = render(d, ["products"]);
    expect(list).toContain("هنوز محصولی منتشر نشده است");
    expect(list).not.toContain("دسته‌بندی محصولات");
  });
  it("paginates 12 per page with prev/next links", () => {
    const products = Array.from({ length: 30 }, (_, i) => ({ ...PRODUCT_A, id: `p${i}`, slug: `p-${i}`, name: `محصول ${i}`, categoryId: null }));
    const d = makeStorefront({ products, categories: [] });
    const p1 = render(d, ["products"]);
    expect(p1.match(/<article/g)).toHaveLength(12);
    expect(p1).toContain('rel="next"');
    expect(p1).not.toContain('rel="prev"');
    const p3 = render(d, ["products"], { page: "3" });
    expect(p3.match(/<article/g)).toHaveLength(6);
    expect(p3).toContain('rel="prev"');
    expect(p3).not.toContain('rel="next"');
    expect(render(d, ["products"], { page: "99" }).match(/<article/g)).toHaveLength(6); // clamped to the last page
  });
  it("product detail shows name, description (newlines kept), price, stock and a breadcrumb", () => {
    const h = render(makeStorefront(), ["products", PRODUCT_A.slug]);
    expect(h).toContain("چای سبز ایرانی\nبسته‌بندی ۲۵۰ گرمی");
    expect(h).toContain("۱۲۵٬۰۰۰ تومان");
    expect(h).toContain('aria-label="مسیر"');
    expect(h).toContain("خرید آنلاین در این نسخه فعال نیست");
  });
  it("about page renders rich text; contact page renders validated links and an empty state", () => {
    expect(render(makeStorefront(), ["about"])).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    const c = render(makeStorefront(), ["contact"]);
    expect(c).toContain('href="tel:02112345678"');
    expect(c).toContain('href="mailto:shop@example.com"');
    expect(c).toContain("https://www.instagram.com/shop_sample");
    const d = makeStorefront();
    d.store.contact = { phone: "", email: "", address: "" };
    d.store.social = { instagram: "", telegram: "", whatsapp: "" };
    expect(render(d, ["contact"])).toContain("اطلاعات تماس ثبت نشده است");
  });
  it("a store without any pages beyond HOME still renders (nav shrinks)", () => {
    const d = makeStorefront();
    d.pages = d.pages.filter((p) => p.type === "HOME");
    const h = render(d);
    expect(h).not.toContain("/preview/s1/about");
  });
});

describe("general template: safety", () => {
  it("escapes user text (product, store, description) - no markup injection", () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    const d = makeStorefront({ products: [{ ...PRODUCT_A, name: evil, description: evil }] });
    d.store.name = evil;
    for (const segs of [[], ["products"], ["products", PRODUCT_A.slug]]) {
      const h = render(d, segs);
      expect(h).not.toContain("<script>alert(1)");
      expect(h).not.toContain("<img src=x");
      expect(h).toContain("&lt;script&gt;");
    }
  });
  it("unsupported section types in a template are skipped, not fatal", () => {
    const v = buildView(makeStorefront(), { basePath: "/p", segments: [] });
    if (v.status !== "ok") throw new Error();
    const partial = { ...generalTemplate, sections: { hero: generalTemplate.sections.hero } } as unknown as TemplateModule;
    const h = renderToStaticMarkup(<StorefrontRenderer template={partial} ctx={v.ctx} />);
    expect(h).toContain("<h1");
    expect(h).not.toContain("محصولات ویژه");
  });
  it("never renders ids, statuses or other internal fields", () => {
    const h = render(makeStorefront(), ["products"]);
    expect(h).not.toContain(PRODUCT_B.id + '"');
    expect(h).not.toMatch(/DRAFT|ARCHIVED|ownerId|storeId/);
  });
});

describe("general template: images", () => {
  const key = `stores/s1/${"a".repeat(32)}.webp`;
  const withImage = () => {
    const d = makeStorefront({ products: [{ ...PRODUCT_A, image: { key, width: 800, height: 600 } }, PRODUCT_B] });
    d.store.logo = { key: `stores/s1/${"b".repeat(32)}.webp`, width: 120, height: 120 };
    return d;
  };
  it("renders product images with the host-built URL, real dimensions and lazy loading in cards", () => {
    const h = render(withImage(), ["products"]);
    expect(h).toContain(`src="${CDN}/${key}"`);
    expect(h).toContain('width="800"');
    expect(h).toContain('height="600"');
    expect(h).toContain('loading="lazy"');
    expect(h).toContain('alt=""'); // decorative in the card: the product name is the adjacent link text
  });
  it("product detail image is described by the product name and loaded eagerly", () => {
    const h = render(withImage(), ["products", PRODUCT_A.slug]);
    expect(h).toContain(`alt="${PRODUCT_A.name}"`);
    expect(h).toContain('loading="eager"');
  });
  it("renders the logo in the header on every page", () => {
    for (const segs of [[], ["products"], ["contact"]]) expect(render(withImage(), segs)).toContain(`src="${CDN}/stores/s1/${"b".repeat(32)}.webp"`);
  });
  it("products without an image, and URLs that cannot be built, fall back to the placeholder (no broken <img>)", () => {
    const none = render(makeStorefront(), ["products"]);
    expect(none).not.toContain("<img");
    const noUrl = render(withImage(), ["products"], undefined, () => null);
    expect(noUrl).not.toContain("<img");
    expect(noUrl).toContain("چای سبز");
  });
  it("never renders a host that did not come from the injected URL builder", () => {
    const h = render(withImage(), ["products"], undefined, (k) => `https://only-this-host.test/${k}`);
    expect([...h.matchAll(/src="(https?:[^"]+)"/g)].every((m) => m[1]!.startsWith("https://only-this-host.test/"))).toBe(true);
  });
});

describe("general template: typography and section images (phase 8)", () => {
  it("applies the typography choices as closed CSS values (size percent and weights), nothing else", () => {
    const d = makeStorefront();
    d.store.typography = { fontFamily: "vazirmatn", sizeScale: "large", headingWeight: 600, bodyWeight: 500 };
    const h = render(d);
    expect(h).toContain("font-size:110%");
    expect(h).toContain("--w-heading:600");
    expect(h).toContain("--w-body:500");
    for (const [scale, pct] of [["small", "92%"], ["normal", "100%"]] as const) {
      d.store.typography = { ...d.store.typography, sizeScale: scale };
      expect(render(d)).toContain(`font-size:${pct}`);
    }
  });
  it("the font family is not configurable in markup (no font-family inline style)", () => {
    expect(render(makeStorefront())).not.toMatch(/font-family/);
  });
  const key = `stores/s1/${"c".repeat(32)}.webp`;
  it("hero and image+text sections render the referenced image from the contract's images map", () => {
    const d = makeStorefront();
    d.images = { m1: { key, width: 640, height: 480 } };
    const home = d.pages.find((p) => p.type === "HOME")!;
    home.sections = home.sections.map((s) => ("imageId" in s.props ? ({ ...s, props: { ...s.props, imageId: "m1" } } as typeof s) : s));
    const h = render(d);
    expect(h.match(new RegExp(`src="${CDN}/${key}"`, "g"))?.length).toBe(2); // hero + imageText
    expect(h).toContain('width="640"');
  });
  it("an imageId that is not in the images map (not READY / foreign / missing) renders the placeholder, never an <img>", () => {
    const d = makeStorefront();
    const home = d.pages.find((p) => p.type === "HOME")!;
    home.sections = home.sections.map((s) => ("imageId" in s.props ? ({ ...s, props: { ...s.props, imageId: "ghost" } } as typeof s) : s));
    expect(render(d)).not.toContain("<img");
  });
});
