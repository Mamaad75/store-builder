import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import { THEME_CATALOG } from "@store-builder/shared/templates/theme-catalog";
import type { StorefrontData } from "@store-builder/shared/templates/storefront-data";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";
import { LEGACY_THEMES, legacyData, legacyMediaUrl } from "./legacy-fixture";

/**
 * Responsive images in EVERY theme: an image with smaller copies is offered at 320 / 640 / 1024 pixels (srcset + sizes); an image without them is
 * rendered exactly as before; and the largest copy is never bigger than the picture is.
 */
const K = (n: number) => `stores/s/${String(n).repeat(32)}.webp`;
const url = (k: string) => `/m/${k}`;

/** Every product image and section image of the data, made 2048 wide with copies (or without, for the control). */
function withCopies(data: StorefrontData, variants: boolean): StorefrontData {
  let n = 0;
  const ref = () => ({ key: K(++n % 10), width: 2048, height: 1536, ...(variants ? { variants: true as const } : {}) });
  return {
    ...data,
    products: data.products.map((p) => ({ ...p, image: ref() })),
    images: Object.fromEntries(Object.keys(data.images).map((id) => [id, ref()])),
  };
}
const render = (data: StorefrontData, segments: string[]) => {
  const view = buildView(data, { basePath: "", segments, mediaUrl: url });
  if (view.status !== "ok") throw new Error(view.status);
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
};

function check(label: string, base: StorefrontData) {
  const data = withCopies(base, true);
  const slug = data.products[0]!.slug;
  for (const [name, segments] of [["home", []], ["list", ["products"]], ["detail", ["products", slug]]] as const) {
    const html = render(data, [...segments]);
    const sets = html.match(/srcSet="[^"]*"/g) ?? [];
    expect(sets.length, `${label} ${name} srcset`).toBeGreaterThan(0);
    for (const s of sets) {
      expect(s, `${label} ${name}`).toMatch(/-w320\.webp 320w, \/m\/[^ ]+-w640\.webp 640w, \/m\/[^ ]+-w1024\.webp 1024w/);
      expect(s).not.toMatch(/\.webp 2048w/); // the full-size picture is not a candidate
    }
    expect(html).toContain("sizes="); // the browser is told how big the image will be
    expect(html).not.toMatch(/-w(?!320|640|1024)\d+\.webp/);
  }
  // the control: the same data without copies has no srcset anywhere, and its images are as before
  const plain = render(withCopies(base, false), []);
  expect(plain, `${label} control`).not.toContain("srcSet");
  expect(plain).toContain("<img");
}

describe("responsive images in every theme", () => {
  const themes = THEME_CATALOG.map((t) => [t.key, t.version] as const);
  it.each(themes)("%s@%i", (key, version) => {
    const demo = loadThemeDemo(key, version);
    if (!demo) return; // the four original themes have no demo: covered below
    check(`${key}@${version}`, demo.data);
  });
  it.each(LEGACY_THEMES)("original theme %s", (key) => check(key, legacyData(key)));
  it("a product page offers the gallery thumbnails their small copy", () => {
    const base = withCopies(legacyData("general"), true);
    const p = { ...base.products[0]!, gallery: [{ key: K(7), width: 2048, height: 1536, variants: true as const }] };
    const html = render({ ...base, products: [p, ...base.products.slice(1)] }, ["products", p.slug]);
    expect(html.slice(html.indexOf("data-gallery"))).toMatch(/srcSet="[^"]*-w320\.webp 320w[^"]*" sizes="72px"/);
  });
});

describe("the data contract", () => {
  it("a media reference may carry variants: true, and nothing else extra", async () => {
    const { mediaRefSchema } = await import("@store-builder/shared/templates/storefront-data");
    expect(mediaRefSchema.safeParse({ key: K(1), width: 10, height: 10, variants: true }).success).toBe(true);
    expect(mediaRefSchema.safeParse({ key: K(1), width: 10, height: 10 }).success).toBe(true);
    expect(mediaRefSchema.safeParse({ key: K(1), width: 10, height: 10, variants: false }).success).toBe(false);
    expect(mediaRefSchema.safeParse({ key: `stores/s/${"1".repeat(32)}-w320.webp`, width: 10, height: 10 }).success).toBe(false); // a copy's key is never a reference
  });
});
