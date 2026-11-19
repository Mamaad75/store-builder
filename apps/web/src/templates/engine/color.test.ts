import { describe, expect, it } from "vitest";
import type { StorefrontStore } from "../storefront-data";
import { contrastRatio, readableTextOn } from "./color";
import { themeStyleVars } from "./theme-vars";

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
/** Every brand colour an owner can choose, sampled every 5 levels per channel (~140,000 colours) plus the channel maxima. */
function* brandColours() {
  const levels = [...Array.from({ length: 52 }, (_, i) => i * 5), 255];
  for (const r of levels) for (const g of levels) for (const b of levels) yield hex(r, g, b);
}

describe("color helpers", () => {
  it("picks readable text for dark and light brand colors", () => {
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#4f46e5")).toBe("#ffffff");
    expect(readableTextOn("#ffffff")).toBe("#000000");
    expect(readableTextOn("#facc15")).toBe("#000000");
  });
  it("the chosen text always reaches WCAG AA (4.5) for a sample of brand colors", () => {
    for (const c of ["#4f46e5", "#facc15", "#10b981", "#ef4444", "#0ea5e9", "#f97316", "#a3e635", "#7c3aed", "#14b8a6", "#e11d48"]) {
      expect(contrastRatio(c, readableTextOn(c)), c).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("regression (M3 audit): text on the brand colour reaches 4.5:1 for EVERY colour, including the band that was 4.21:1 (#0075ff)", () => {
    expect(contrastRatio("#0075ff", readableTextOn("#0075ff"))).toBeGreaterThanOrEqual(4.5);
    let worst = { ratio: Infinity, colour: "" };
    for (const c of brandColours()) {
      const ratio = contrastRatio(c, readableTextOn(c));
      if (ratio < worst.ratio) worst = { ratio, colour: c };
    }
    expect(worst.ratio, `worst: ${worst.colour}`).toBeGreaterThanOrEqual(4.5);
  });
  it("the accent used for text on white always reaches 4.5:1, whatever the brand colour", () => {
    let worst = { ratio: Infinity, colour: "" };
    for (const c of brandColours()) {
      const accent = String(themeStyleVars({ primaryColor: c, typography: { sizeScale: "normal", headingWeight: 700, bodyWeight: 400 } } as StorefrontStore)["--accent" as never]);
      const ratio = contrastRatio(accent, "#ffffff");
      if (ratio < worst.ratio) worst = { ratio, colour: c };
    }
    expect(worst.ratio, `worst: ${worst.colour}`).toBeGreaterThanOrEqual(4.5);
  });
});
