import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadThemeDemo } from "@/app/themes/demo";
import { THEME_CATALOG } from "@store-builder/shared/templates/theme-catalog";
import StorefrontRenderer from "./engine/StorefrontRenderer";
import { buildView } from "./engine/view";

/** The eNamad seal in the footer of EVERY registered theme version: the official image and link when set, nothing when not. */
const SEAL = { id: "123456", code: "AbCdEfGh12345678" };

function html(key: string, version: number, enamad?: typeof SEAL) {
  const demo = loadThemeDemo(key, version);
  if (!demo) return null;
  const data = enamad ? { ...demo.data, store: { ...demo.data.store, enamad } } : demo.data;
  const view = buildView(data, { basePath: "/p", segments: [], mediaUrl: demo.mediaUrl });
  if (view.status !== "ok") throw new Error(`${key}@${version}: ${view.status}`);
  return renderToStaticMarkup(<StorefrontRenderer template={view.template} ctx={view.ctx} />);
}

describe("eNamad seal in every theme's footer", () => {
  const themes = THEME_CATALOG.map((t) => [t.key, t.version] as const);

  it.each(themes)("%s@%i shows the official image and verification link, and only when set", (key, version) => {
    const withSeal = html(key, version, SEAL);
    if (withSeal === null) return; // a version without a demo cannot be rendered here
    const src = "https://trustseal.enamad.ir/logo.aspx?id=123456&amp;Code=AbCdEfGh12345678";
    const href = "https://trustseal.enamad.ir/?id=123456&amp;Code=AbCdEfGh12345678";
    expect(withSeal, `${key}@${version} image`).toContain(`src="${src}"`);
    expect(withSeal, `${key}@${version} link`).toContain(`href="${href}"`);
    expect(withSeal).toContain('referrerPolicy="origin"');
    expect(withSeal).toContain('alt="نماد اعتماد الکترونیکی"');
    // the seal sits inside the page's footer, not in the header or body content
    const footer = withSeal.slice(withSeal.lastIndexOf("<footer"));
    expect(footer, `${key}@${version} in footer`).toContain("enamad-seal");
    expect(html(key, version)).not.toMatch(/enamad/i);
  });

  it("every theme was rendered (the loop is not vacuous)", () => {
    const rendered = themes.filter(([k, v]) => html(k, v, SEAL) !== null);
    expect(rendered.length).toBeGreaterThanOrEqual(20);
  });
});
