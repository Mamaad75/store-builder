import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import { THEME_CATALOG } from "@store-builder/shared/templates/theme-catalog";
import type { StorefrontData } from "@store-builder/shared/templates/storefront-data";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { LEGACY_THEMES, legacyData, legacyMediaUrl } from "./legacy-fixture";

/** Information pages, their links and the announcement bar in EVERY theme (the demo themes and the four original ones). */
const INFO = {
  terms: "## شرایط\nمتن <b>قوانین</b> فروشگاه.",
  faq: "مقدمهٔ پرسش‌ها.\n\n## ارسال چگونه است؟\nبا پیک.\n\n## بازگشت دارید؟\nبله، تا هفت روز.",
};
const ANN = { text: "ارسال رایگان برای خرید بالای پانصد هزار", link: "products" as const };

function render(data: StorefrontData, mediaUrl: (k: string) => string | null, segments: string[], withExtras: boolean, basePath = "") {
  const d = withExtras ? { ...data, store: { ...data.store, infoPages: INFO, announcement: ANN } } : data;
  const view = buildView(d, { basePath, segments, mediaUrl });
  if (view.status !== "ok") return view.status;
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
}

function check(label: string, data: StorefrontData, mediaUrl: (k: string) => string | null) {
  const home = render(data, mediaUrl, [], true) as string;
  expect(home, `${label} announcement`).toContain('data-announcement=""');
  expect(home).toContain(ANN.text);
  expect(home).toContain('href="/products"'); // the announcement link
  expect(home, `${label} links`).toContain('data-info-links=""');
  expect(home).toContain('href="/info/terms"');
  expect(home).toContain('href="/info/faq"');
  expect(home).not.toContain('href="/info/privacy"'); // a page without text has no link
  const terms = render(data, mediaUrl, ["info", "terms"], true) as string;
  expect(terms, `${label} terms`).toContain('data-info="terms"');
  expect(terms).toContain("&lt;b&gt;قوانین&lt;/b&gt;"); // text, never markup
  expect(terms).not.toContain("<b>قوانین</b>");
  const faq = render(data, mediaUrl, ["info", "faq"], true) as string;
  expect(faq, `${label} faq`).toContain("<details");
  const article = faq.slice(faq.indexOf('data-info="faq"'), faq.indexOf("</article>")); // the theme's own layout has its own disclosures (search, menu)
  expect((article.match(/<summary/g) ?? []).length).toBe(2);
  expect(faq).toContain("مقدمهٔ پرسش‌ها.");
  expect(render(data, mediaUrl, ["info", "privacy"], true)).toBe("not_found");
  expect(render(data, mediaUrl, ["info", "nope"], true)).toBe("not_found");
  // a store that wrote nothing: no bar, no links, no info routes, and the home page is as before
  const plain = render(data, mediaUrl, [], false) as string;
  expect(plain).not.toContain("data-announcement");
  expect(plain).not.toContain("data-info-links");
  expect(render(data, mediaUrl, ["info", "terms"], false)).toBe("not_found");
}

describe("information pages and the announcement in every theme", () => {
  const themes = THEME_CATALOG.map((t) => [t.key, t.version] as const);
  it.each(themes)("%s@%i", (key, version) => {
    const demo = loadThemeDemo(key, version);
    if (!demo) return; // the four original themes have no demo: covered below
    check(`${key}@${version}`, demo.data, demo.mediaUrl);
  });
  it.each(LEGACY_THEMES)("original theme %s", (key) => check(key, legacyData(key), legacyMediaUrl));
  it("the preview (a base path) shows them too, with links under the preview's own path", () => {
    const html = render(legacyData("general"), legacyMediaUrl, [], true, "/preview/abc") as string;
    expect(html).toContain('href="/preview/abc/info/terms"');
    expect(html).toContain('href="/preview/abc/products"');
  });
});
