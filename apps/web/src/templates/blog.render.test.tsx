import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import { THEME_CATALOG } from "@store-builder/shared/templates/theme-catalog";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { LEGACY_THEMES, legacyData, legacyMediaUrl } from "./legacy-fixture";

/** The blog inside EVERY registered theme version: the theme's own layout around plain article markup, a nav link only when posts exist. */
const POSTS = [
  { slug: "tea-guide", title: "راهنمای دم کردن چای", excerpt: "سه نکتهٔ ساده", body: "## آب\nآب تازه بجوشانید.\n\nپاراگراف <b>دوم</b> با نشانه‌گذاری.", publishedAt: "2026-11-20T10:00:00.000Z" },
  { slug: "second", title: "مقالهٔ دوم", body: "متن مقالهٔ دوم برای آزمون.", publishedAt: "2026-11-10T10:00:00.000Z" },
];

function html(key: string, version: number, segments: string[], posts = true) {
  const demo = loadThemeDemo(key, version);
  if (!demo) return null;
  const data = posts ? { ...demo.data, posts: POSTS } : demo.data;
  const view = buildView(data, { basePath: "", segments, mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") return view.status;
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
}

describe("the blog in every theme", () => {
  const themes = THEME_CATALOG.map((t) => [t.key, t.version] as const);

  it.each(themes)("%s@%i: list, post, navigation link, and nothing when there are no posts", (key, version) => {
    const list = html(key, version, ["blog"]);
    if (list === null) return; // a version without a demo (see the count below)
    expect(list, `${key}@${version} list`).toContain('data-blog="list"');
    expect(list).toContain("راهنمای دم کردن چای");
    expect(list).toContain('href="/blog/tea-guide"');
    expect(list).toContain("سه نکتهٔ ساده");
    expect(list).toContain('href="/blog"'); // the navigation link (the layout is the theme's own)
    const post = html(key, version, ["blog", "tea-guide"])!;
    expect(post, `${key}@${version} post`).toContain('data-blog="post"');
    expect(post).toContain("<h2");
    expect(post).toContain("آب تازه بجوشانید.");
    expect(post).toContain("&lt;b&gt;دوم&lt;/b&gt;"); // text, never markup
    expect(post).not.toContain("<b>دوم</b>");
    expect(html(key, version, ["blog", "nope"])).toBe("not_found");
    // a store without posts: no blog route, no link, and the home page is untouched
    expect(html(key, version, ["blog"], false)).toBe("not_found");
    expect(html(key, version, [], false)).not.toContain('href="/blog"');
    expect(html(key, version, [])).toContain('href="/blog"');
  });

  it("every theme was rendered (the loop is not vacuous)", () => {
    const rendered = themes.filter(([k, v]) => html(k, v, ["blog"]) !== null).map(([k]) => k);
    expect(rendered.length).toBeGreaterThanOrEqual(20);
    // every theme FAMILY is covered, including the legacy ones with their own layout (general, fashion, appliances, coffee) and the studios
    for (const family of ["bazaar", "golkhaneh", "sormeh", "dookht", "sofreh", "khaneh", "circuit", "arcade"]) expect(rendered, family).toContain(family);
  });
});

describe("the blog in the four original themes (own layouts, no demo)", () => {
  const render = (key: string, segments: string[], posts = true) => {
    const view = buildView(legacyData(key, posts ? { posts: POSTS } : {}), { basePath: "", segments, mediaUrl: legacyMediaUrl });
    if (view.status !== "ok") return view.status;
    return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
  };
  it.each(LEGACY_THEMES)("%s: list, post, navigation link, and nothing without posts", (key) => {
    const list = render(key, ["blog"]);
    expect(list).toContain('data-blog="list"');
    expect(list).toContain('href="/blog/tea-guide"');
    expect(list).toContain('href="/blog"');
    expect(render(key, ["blog", "tea-guide"])).toContain("آب تازه بجوشانید.");
    expect(render(key, ["blog", "nope"])).toBe("not_found");
    expect(render(key, ["blog"], false)).toBe("not_found");
    expect(render(key, [], false)).not.toContain('href="/blog"');
    expect(render(key, [])).toContain('href="/blog"');
  });
});
