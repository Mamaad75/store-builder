import { describe, expect, it } from "vitest";
import { asciiNumber, buildLinkInput, EMPTY_LINK_FORM, formFromLink, parseScaled, previewPrice, type LinkForm } from "./price-link-form";
import type { CurrentRates, PriceLinkView } from "@/client/api";

const f = (o: Partial<LinkForm>): LinkForm => ({ ...EMPTY_LINK_FORM, ...o });
const rates: CurrentRates = { USD: { rateToman: 60_000, appliedAt: "2026-11-26T08:00:00.000Z" }, GOLD18: { rateToman: 4_000_000, appliedAt: "2026-11-26T08:00:00.000Z" } };

describe("asciiNumber / parseScaled", () => {
  it("reads Persian and Arabic digits, separators and the Persian decimal point", () => {
    expect(asciiNumber("۱٬۲۳۴٫۵")).toBe("1234.5");
    expect(asciiNumber(" ١٢٣ ")).toBe("123");
    expect(parseScaled("۲٫۵", 3)).toBe(2500);
    expect(parseScaled("12", 2)).toBe(1200);
    expect(parseScaled("0.05", 2)).toBe(5);
    expect(parseScaled("1,250,000", 0)).toBe(1_250_000);
  });
  it("refuses anything that is not a plain non-negative decimal within the scale (no float surprises)", () => {
    for (const bad of ["", "abc", "-1", "1.234", "1e3", "1..2", ".5", "5.", "9".repeat(14)]) expect(parseScaled(bad, 2), bad).toBeNull();
    expect(parseScaled("2.5", 0)).toBeNull();
    expect(parseScaled("0.1", 1)).toBe(1); // 0.1 is exactly one tenth: never 0.1 * 10 in floating point
    expect(parseScaled("1.15", 2)).toBe(115);
  });
});

describe("buildLinkInput", () => {
  it("today's price in toman: the system works the equivalent out", () => {
    expect(buildLinkInput(f({ kind: "USD", basis: "toman", toman: "۶٬۰۰۰٬۰۰۰" }))).toEqual({ ok: true, input: { kind: "USD", fromToman: 6_000_000, roundingToman: 1000 } });
    expect(buildLinkInput(f({ kind: "GOLD", basis: "toman", toman: "8000000", rounding: 10_000 }))).toEqual({ ok: true, input: { kind: "GOLD", fromToman: 8_000_000, wageBp: 0, profitBp: 0, taxBp: 900, stoneToman: 0, roundingToman: 10_000 } }); // schema defaults; a plain toman link carries no labour or tax
  });
  it("dollar amount in cents", () => expect(buildLinkInput(f({ kind: "USD", basis: "native", usd: "100.5" }))).toEqual({ ok: true, input: { kind: "USD", usdCents: 10050, roundingToman: 1000 } }));
  it("gold formula: grams to milligrams, percents to basis points", () => {
    expect(buildLinkInput(f({ kind: "GOLD", basis: "native", grams: "2.5", wage: "12.5", profit: "7", tax: "9", stone: "150000" }))).toEqual({
      ok: true,
      input: { kind: "GOLD", weightMg: 2500, wageBp: 1250, profitBp: 700, taxBp: 900, stoneToman: 150_000, roundingToman: 1000 },
    });
  });
  it("explains what is wrong in Persian, field by field", () => {
    for (const form of [f({ toman: "" }), f({ toman: "0" }), f({ basis: "native", kind: "USD", usd: "" }), f({ basis: "native", kind: "GOLD", grams: "" }), f({ basis: "native", kind: "GOLD", grams: "1", wage: "x" }), f({ basis: "native", kind: "GOLD", grams: "1", stone: "1.5" })]) {
      const r = buildLinkInput(form);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/[؀-ۿ]/);
    }
  });
  it("the shared schema's own limits apply (tax above 30% is refused)", () => expect(buildLinkInput(f({ basis: "native", kind: "GOLD", grams: "1", tax: "40" })).ok).toBe(false));
});

describe("previewPrice", () => {
  it("dollar: cents x rate / 100, rounded to the step", () => {
    const b = buildLinkInput(f({ kind: "USD", basis: "native", usd: "10", rounding: 1000 }));
    expect(b.ok && previewPrice(b.input, rates)).toMatchObject({ ok: true, price: 600_000, rateToman: 60_000 });
  });
  it("gold formula at the gram rate", () => {
    const b = buildLinkInput(f({ kind: "GOLD", basis: "native", grams: "2", wage: "10", profit: "0", tax: "0", stone: "0", rounding: 1 }));
    // gold 2 x 4,000,000 = 8,000,000; labour 10% = 800,000
    expect(b.ok && previewPrice(b.input, rates)).toMatchObject({ ok: true, price: 8_800_000 });
  });
  it("a toman price links at today's rate: the preview equals the typed price (to the rounding step)", () => {
    const b = buildLinkInput(f({ kind: "USD", basis: "toman", toman: "6000000", rounding: 1 }));
    expect(b.ok && previewPrice(b.input, rates)).toMatchObject({ ok: true, price: 6_000_000 });
  });
  it("no rate yet is its own answer", () => {
    const b = buildLinkInput(f({ kind: "USD", basis: "native", usd: "1" }));
    expect(b.ok && previewPrice(b.input, { USD: null, GOLD18: null })).toEqual({ ok: false, reason: "no_rate" });
  });
});

describe("formFromLink", () => {
  const base = { productId: "p", variantId: null, status: "OK", lastPriceToman: 1, lastRateAt: null, usdCents: null, weightMg: null, wageBp: 0, profitBp: 0, taxBp: 900, stoneToman: 0 } as const;
  it("round-trips a stored link into the form and back to the same input", () => {
    const gold: PriceLinkView = { ...base, kind: "GOLD", weightMg: 2500, wageBp: 1250, profitBp: 700, stoneToman: 150_000, roundingToman: 10_000 };
    const form = formFromLink(gold);
    expect(form).toMatchObject({ kind: "GOLD", basis: "native", grams: "2.5", wage: "12.5", profit: "7", tax: "9", stone: "150000", rounding: 10_000 });
    expect(buildLinkInput(form)).toEqual({ ok: true, input: { kind: "GOLD", weightMg: 2500, wageBp: 1250, profitBp: 700, taxBp: 900, stoneToman: 150_000, roundingToman: 10_000 } });
    const usd: PriceLinkView = { ...base, kind: "USD", usdCents: 10050, roundingToman: 1000 };
    expect(formFromLink(usd)).toMatchObject({ kind: "USD", usd: "100.5" });
  });
});
