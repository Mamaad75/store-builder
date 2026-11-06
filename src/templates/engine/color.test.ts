import { describe, expect, it } from "vitest";
import { contrastRatio, readableTextOn } from "./color";

describe("color helpers", () => {
  it("picks readable text for dark and light brand colors", () => {
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#4f46e5")).toBe("#ffffff");
    expect(readableTextOn("#ffffff")).toBe("#111827");
    expect(readableTextOn("#facc15")).toBe("#111827");
  });
  it("the chosen text always reaches WCAG AA (4.5) for a sample of brand colors", () => {
    for (const c of ["#4f46e5", "#facc15", "#10b981", "#ef4444", "#0ea5e9", "#f97316", "#a3e635", "#7c3aed", "#14b8a6", "#e11d48"]) {
      expect(contrastRatio(c, readableTextOn(c)), c).toBeGreaterThanOrEqual(4.5);
    }
  });
});
