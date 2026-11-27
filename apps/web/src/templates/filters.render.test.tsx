import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import { THEME_CATALOG } from "@store-builder/shared/templates/theme-catalog";
import type { StorefrontData } from "@store-builder/shared/templates/storefront-data";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { LEGACY_THEMES, legacyData, legacyMediaUrl } from "./legacy-fixture";

/** The price and stock filters above the product list in EVERY theme: present, no-JS (a GET form), keeping the shopper's other choices, and working. */
function page(data: StorefrontData, mediaUrl: (k: string) => string | null, sp: Record<string, string>, segments = ["products"]) {
  const view = buildView(data, { basePath: "", segments, searchParams: sp, mediaUrl });
  if (view.status !== "ok") throw new Error(view.status);
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
}
const section = (html: string) => html.slice(html.indexOf("data-list-filters"), html.indexOf("</form>", html.indexOf("data-list-filters")));

function check(label: string, data: StorefrontData, mediaUrl: (k: string) => string | null) {
  const prices = data.products.map((p) => p.price).sort((a, b) => a - b);
  expect(prices.length, `${label} has products`).toBeGreaterThan(2);
  const html = page(data, mediaUrl, {});
  const form = section(html);
  expect(form, `${label} form`).toContain('method="get"');
  expect(form).toContain('action="/products"');
  expect(form).toContain('name="min"');
  expect(form).toContain('name="max"');
  expect(form).toContain('name="available"');
  expect(form).not.toContain("حذف فیلتر"); // nothing to clear yet
  // a filter keeps what the shopper chose, and shows a way out
  const cheapest = prices[0]!;
  const filtered = page(data, mediaUrl, { max: String(cheapest), q: "ا", sort: "cheap", available: "1" });
  const f = section(filtered);
  expect(f).toContain('name="q" value="ا"');
  expect(f).toContain('name="sort" value="cheap"');
  expect(f).toMatch(/name="available"[^>]*checked/);
  expect(f).toContain(`value="${cheapest}"`);
  expect(f, `${label} clear`).toContain("حذف فیلتر");
  // the filter really narrows the list (an impossible range leaves nothing, the unfiltered list has every product)
  const none = page(data, mediaUrl, { min: "999999999" });
  expect(none).not.toContain(data.products[0]!.name);
  expect(html).toContain(data.products[0]!.name.slice(0, 6));
  // not on other pages
  expect(page(data, mediaUrl, {}, [])).not.toContain("data-list-filters");
}

describe("price and stock filters in every theme", () => {
  const themes = THEME_CATALOG.map((t) => [t.key, t.version] as const);
  it.each(themes)("%s@%i", (key, version) => {
    const demo = loadThemeDemo(key, version);
    if (!demo) return;
    check(`${key}@${version}`, demo.data, demo.mediaUrl);
  });
  it.each(LEGACY_THEMES)("original theme %s", (key) => {
    const base = legacyData(key);
    // the fixture has two products; a third makes the filter worth showing
    const third = { ...base.products[0]!, id: "p-c", slug: "kala-c", name: "کالای سوم", price: 300_000 };
    check(key, { ...base, products: [...base.products, third] }, legacyMediaUrl);
  });
});
