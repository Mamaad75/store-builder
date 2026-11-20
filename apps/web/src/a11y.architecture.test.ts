import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@store-builder/shared/templates/engine/color";

/**
 * Accessibility guards for the fixes of the M3 audit (docs/audit-m3-accessibility.md). Each one failed on the code before the fix.
 * The runtime counterpart is e2e/a11y.spec.ts (axe-core on real pages).
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const THEMES = ["general", "coffee", "fashion", "appliances"] as const;
const css = (t: string) => read(`src/templates/${t}/${t}.module.css`);
const token = (source: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)?.[1];

describe("storefront themes", () => {
  it("finding 1: the owner's brand colour is never used directly as a TEXT colour (only --accent, which is always >= 4.5:1)", () => {
    // Decorative placeholder initials are aria-hidden when there is no image, so they are exempt from 1.4.3.
    const decorative = /^\.(cardArt|detailArt|heroArt|splitArt)\b/;
    for (const t of THEMES) {
      for (const rule of css(t).split("\n").filter((l) => /(^|[;{\s])color:\s*var\(--primary\)/.test(l))) {
        // Brand-coloured text on an --on-primary background is the same pair as --on-primary on the brand colour (>= 4.5:1, color.test.ts).
        const onOwnPair = /background:\s*var\(--on-primary\)/.test(rule);
        expect(decorative.test(rule.trim()) || onOwnPair, `${t}: ${rule.trim().slice(0, 80)}`).toBe(true);
      }
    }
  });

  it("finding 3: muted text reaches 4.5:1 on the page and on the alternate surface in every theme", () => {
    for (const t of THEMES) {
      const c = css(t);
      const [muted, bg, surface] = [token(c, "muted"), token(c, "bg") ?? "#ffffff", token(c, "surface")];
      expect(muted, `${t} --muted`).toBeDefined();
      expect(contrastRatio(muted!, bg), `${t} muted/bg`).toBeGreaterThanOrEqual(4.5);
      if (surface) expect(contrastRatio(muted!, surface), `${t} muted/surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("finding 6: every theme with a sticky header reserves room for it when a focused element scrolls into view", () => {
    for (const t of THEMES) {
      const c = css(t);
      if (/\.header \{[^}]*position: sticky/.test(c)) expect(c, t).toMatch(/:global\(html\):has\(\.root\) \{ scroll-padding-top: [\d.]+rem; \}/);
    }
  });

  it("finding 7: every theme turns transitions and animations off for prefers-reduced-motion", () => {
    for (const t of THEMES) expect(css(t), t).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.root \*[^{]*\{ transition: none !important; animation: none !important;/);
  });
});

describe("platform (dashboard, auth, landing, legal)", () => {
  it("finding 4: the page editor's section headers carry no aria-label, so the visible text is the accessible name (2.5.3)", () => {
    expect(read("src/components/pages/PageEditor.tsx")).not.toMatch(/<AccordionSummary[^>]*aria-label/);
  });

  it("finding 5: keyboard focus is outlined on every MUI button-like component and link", () => {
    const theme = read("src/theme/theme.ts");
    expect(theme).toMatch(/MuiButtonBase:[\s\S]*"&\.Mui-focusVisible": \{ outline: "3px solid #4f46e5"/);
    expect(theme).toMatch(/MuiLink:[\s\S]*"&:focus-visible": \{ outline: "3px solid #4f46e5"/);
    expect(contrastRatio("#4f46e5", "#ffffff")).toBeGreaterThanOrEqual(3); // non-text contrast of the indicator (1.4.11)
    expect(contrastRatio("#4f46e5", "#f7f8fa")).toBeGreaterThanOrEqual(3);
  });

  it("finding 8: every platform layout starts with the skip link to a main landmark with id=main", () => {
    for (const f of ["src/app/page.tsx", "src/app/(auth)/layout.tsx", "src/app/(legal)/layout.tsx", "src/app/dashboard/layout.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("<SkipLink />");
      expect(src, f).toMatch(/component="main" id="main"/);
      expect(src.indexOf("<SkipLink />"), f).toBeLessThan(src.indexOf('component="main"'));
    }
    expect(read("src/components/SkipLink.tsx")).toContain('href="#main"');
  });
});
