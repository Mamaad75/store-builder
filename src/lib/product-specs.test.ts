import { describe, expect, it } from "vitest";
import { BUSINESS_CATEGORIES } from "./business-categories";
import {
  CARD_SPEC_ROWS,
  MAX_SPEC_ROWS,
  SPEC_LABEL_MAX,
  SPEC_VALUE_MAX,
  analyzeSpecs,
  cardSpecs,
  detailSpecs,
  specsInputSchema,
  specsUnchanged,
} from "./product-specs";
import { SPEC_PRESETS, getSpecPreset, listSpecPresets } from "./spec-presets";

describe("specsInputSchema (what an owner may write)", () => {
  it("accepts an empty list and ordinary Persian rows, normalising letters, digits, spaces", () => {
    expect(specsInputSchema.parse([])).toEqual([]);
    expect(specsInputSchema.parse([{ label: "  ظرفيت ", value: "۷  كيلوگرم" }])).toEqual([{ label: "ظرفیت", value: "۷ کیلوگرم" }]);
  });
  it("enforces the approved limits exactly: 30 rows, 40 characters per label, 120 per value", () => {
    const row = (i: number) => ({ label: `ویژگی ${i}`, value: "x" });
    expect(specsInputSchema.safeParse(Array.from({ length: MAX_SPEC_ROWS }, (_, i) => row(i))).success).toBe(true);
    expect(specsInputSchema.safeParse(Array.from({ length: MAX_SPEC_ROWS + 1 }, (_, i) => row(i))).success).toBe(false);
    expect(specsInputSchema.safeParse([{ label: "a".repeat(SPEC_LABEL_MAX), value: "v" }]).success).toBe(true);
    expect(specsInputSchema.safeParse([{ label: "a".repeat(SPEC_LABEL_MAX + 1), value: "v" }]).success).toBe(false);
    expect(specsInputSchema.safeParse([{ label: "l", value: "v".repeat(SPEC_VALUE_MAX) }]).success).toBe(true);
    expect(specsInputSchema.safeParse([{ label: "l", value: "v".repeat(SPEC_VALUE_MAX + 1) }]).success).toBe(false);
  });
  it.each([
    ["empty label", [{ label: "  ", value: "v" }]],
    ["empty value", [{ label: "l", value: "" }]],
    ["control character", [{ label: "l\u0000", value: "v" }]],
    ["unknown key", [{ label: "l", value: "v", extra: 1 }]],
    ["not strings", [{ label: 1, value: 2 }]],
    ["not an object", ["x"]],
    ["duplicate label (case-insensitive)", [{ label: "Brand", value: "a" }, { label: "brand", value: "b" }]],
    ["not an array", { label: "l", value: "v" }],
  ])("rejects %s", (_n, input) => {
    expect(specsInputSchema.safeParse(input).success).toBe(false);
  });
  it("keeps HTML-looking text as inert text (it is escaped at render time, never interpreted)", () => {
    const v = '<script>alert(1)</script> & "q"';
    expect(specsInputSchema.parse([{ label: "x", value: v }])[0]!.value).toBe(v);
  });
});

describe("analyzeSpecs (what is already stored): classifies, never rewrites", () => {
  it("valid stored specs are returned as stored", () => {
    const rows = [{ label: "برند", value: "الف" }];
    expect(analyzeSpecs(rows)).toEqual({ ok: true, rows });
    expect(analyzeSpecs([])).toEqual({ ok: true, rows: [] });
  });
  it.each([
    ["not an array", { a: 1 }, "not_an_array"],
    ["null", null, "not_an_array"],
    ["too many rows", Array.from({ length: 31 }, (_, i) => ({ label: `l${i}`, value: "v" })), "too_many_rows"],
    ["row with extra key", [{ label: "l", value: "v", x: 1 }], "invalid_row"],
    ["empty value", [{ label: "l", value: "" }], "invalid_row"],
    ["too long value", [{ label: "l", value: "v".repeat(121) }], "invalid_row"],
    ["control character", [{ label: "l", value: "a\u0001b" }], "invalid_row"],
    ["duplicate labels", [{ label: "l", value: "a" }, { label: "L", value: "b" }], "duplicate_label"],
  ])("reports %s as invalid (%s)", (_n, raw, reason) => {
    const a = analyzeSpecs(raw);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe(reason);
  });
  it("does not mutate its input", () => {
    const raw = [{ label: "  l ", value: "v" }];
    const copy = JSON.stringify(raw);
    analyzeSpecs(raw);
    expect(JSON.stringify(raw)).toBe(copy);
  });
  it("specsUnchanged is true only for valid stored specs equal to the new rows", () => {
    const rows = [{ label: "برند", value: "الف" }];
    expect(specsUnchanged(rows, rows)).toBe(true);
    expect(specsUnchanged(rows, [])).toBe(false);
    expect(specsUnchanged([{ label: "", value: "" }], [])).toBe(false); // invalid stored value: replacing it is a real change
    expect(specsUnchanged(null, [])).toBe(false);
  });
});

describe("display helpers", () => {
  const rows = [1, 2, 3, 4].map((i) => ({ label: `l${i}`, value: `v${i}` }));
  it("cards show at most the first two rows; the detail page shows all of them", () => {
    expect(CARD_SPEC_ROWS).toBe(2);
    expect(cardSpecs(rows)).toEqual(rows.slice(0, 2));
    expect(detailSpecs(rows)).toEqual(rows);
  });
  it("no rows (or undefined) yields nothing", () => {
    expect(cardSpecs([])).toEqual([]);
    expect(detailSpecs(undefined)).toEqual([]);
  });
});

describe("spec presets are optional suggestions, never rules, and not tied to one business category", () => {
  it("every category is offered EVERY preset (the suggestion only changes the order)", () => {
    const all = SPEC_PRESETS.map((p) => p.key).sort();
    for (const c of BUSINESS_CATEGORIES) {
      expect(listSpecPresets(c.suggestedSpecPresets).map((p) => p.key).sort(), c.key).toEqual(all);
    }
    expect(listSpecPresets().map((p) => p.key).sort()).toEqual(all);
  });
  it("the suggested presets are listed first", () => {
    expect(listSpecPresets(["general"])[0]!.key).toBe("general");
    expect(listSpecPresets(["appliance"])[0]!.key).toBe("appliance");
  });
  it("the appliance preset is usable by a store of any other category (e.g. a coffee shop selling a kettle)", () => {
    const preset = getSpecPreset("appliance")!;
    for (const c of BUSINESS_CATEGORIES) {
      expect(listSpecPresets(c.suggestedSpecPresets).some((p) => p.key === preset.key), c.key).toBe(true);
    }
    // its labels are valid rows in any store, and any other label is equally valid without a preset
    expect(specsInputSchema.safeParse(preset.labels.map((label) => ({ label, value: "x" }))).success).toBe(true);
    expect(specsInputSchema.safeParse([{ label: "برچسب دلخواه", value: "x" }]).success).toBe(true);
  });
  it("preset labels themselves respect the limits (so applying one can never produce an invalid row)", () => {
    for (const p of SPEC_PRESETS) {
      expect(p.labels.length).toBeLessThanOrEqual(MAX_SPEC_ROWS);
      expect(new Set(p.labels.map((l) => l.toLowerCase())).size).toBe(p.labels.length);
      for (const l of p.labels) expect(l.length).toBeLessThanOrEqual(SPEC_LABEL_MAX);
    }
  });
});
