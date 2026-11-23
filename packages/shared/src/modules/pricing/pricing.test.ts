import { describe, expect, it } from "vitest";
import { MAX_PRICE_TOMAN } from "../../lib/money.js";
import { decideRate, isStale, linkFromInput, parseProviderNumber, priceLinkInputSchema, priceOf, type PriceLink } from "./pricing.js";

const parse = (v: unknown) => priceLinkInputSchema.parse(v);

describe("price links (phase 3.2b)", () => {
  it("dollar: today's toman price is converted once at the current rate, then follows the rate", () => {
    const link = linkFromInput(parse({ kind: "USD", fromToman: 5_000_000 }), 100_000)!;
    expect(link).toEqual({ kind: "USD", usdCents: 5_000, roundingToman: 1_000 });
    expect(priceOf(link, 100_000)).toEqual({ ok: true, priceToman: 5_000_000 });
    expect(priceOf(link, 102_345)).toEqual({ ok: true, priceToman: 5_117_000 }); // 5,117,250 rounded to 1,000
    expect(priceOf({ ...link, roundingToman: 1 }, 102_345)).toEqual({ ok: true, priceToman: 5_117_250 });
  });

  it("gold: the jewellery formula (labour on gold, profit on gold + labour, tax on labour + profit, stones added)", () => {
    const link = linkFromInput(parse({ kind: "GOLD", weightMg: 3_500, wageBp: 1_500, profitBp: 700, taxBp: 900, stoneToman: 200_000, roundingToman: 1 }), 0)!;
    // gold 3.5 g x 8,000,000 = 28,000,000; labour 15% = 4,200,000; profit 7% of 32,200,000 = 2,254,000; tax 9% of 6,454,000 = 580,860
    expect(priceOf(link, 8_000_000)).toEqual({ ok: true, priceToman: 28_000_000 + 4_200_000 + 2_254_000 + 580_860 + 200_000 });
  });

  it("gold from a toman price: equivalent weight, no labour", () => {
    const link = linkFromInput(parse({ kind: "GOLD", fromToman: 16_000_000 }), 8_000_000)!;
    expect(link).toMatchObject({ kind: "GOLD", weightMg: 2_000, wageBp: 0, profitBp: 0, taxBp: 0 });
    expect(priceOf(link, 9_000_000)).toEqual({ ok: true, priceToman: 18_000_000 });
  });

  it("refuses ambiguous or malformed input", () => {
    for (const bad of [
      { kind: "USD" },
      { kind: "USD", fromToman: 1000, usdCents: 10 },
      { kind: "USD", fromToman: 1.5 },
      { kind: "GOLD" },
      { kind: "GOLD", fromToman: 1000, weightMg: 10 },
      { kind: "GOLD", fromToman: 1000, wageBp: 100 },
      { kind: "GOLD", weightMg: 10, taxBp: 5000 },
      { kind: "GOLD", weightMg: 10, roundingToman: 7 },
      { kind: "EUR", fromToman: 1000 },
      { kind: "USD", fromToman: 1000, extra: 1 },
    ])
      expect(priceLinkInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("a result above the price cap is refused (the last price is kept)", () => {
    const link: PriceLink = { kind: "USD", usdCents: 100_000_000, roundingToman: 1 };
    expect(priceOf(link, 9_000_000)).toEqual({ ok: false, reason: "out_of_range" });
    expect(priceOf({ kind: "USD", usdCents: 1, roundingToman: 1_000 }, 100)).toEqual({ ok: false, reason: "out_of_range" }); // rounds to 0
    expect(MAX_PRICE_TOMAN).toBe(1_000_000_000);
  });

  it("integer arithmetic only: large values stay exact", () => {
    const link: PriceLink = { kind: "GOLD", weightMg: 9_999_999, wageBp: 10_000, profitBp: 10_000, taxBp: 3_000, stoneToman: 0, roundingToman: 1 };
    // gold 99,999,990; labour 100% = 99,999,990; profit 100% of 199,999,980; tax 30% of 299,999,970 = 89,999,991
    expect(priceOf(link, 10_000)).toEqual({ ok: true, priceToman: 99_999_990 + 99_999_990 + 199_999_980 + 89_999_991 });
  });
});

describe("rate decisions", () => {
  it("apply small moves, hold big jumps and the very first automatic rate, reject implausible values", () => {
    expect(decideRate("USD", 101_000, 100_000, 10)).toBe("apply");
    expect(decideRate("USD", 110_000, 100_000, 10)).toBe("apply"); // exactly 10% is not above it
    expect(decideRate("USD", 111_000, 100_000, 10)).toBe("hold");
    expect(decideRate("USD", 89_000, 100_000, 10)).toBe("hold");
    expect(decideRate("USD", 100_000, null, 10)).toBe("hold");
    expect(decideRate("USD", 1_000_000_000, 100_000, 10)).toBe("reject"); // e.g. rial read as toman x 1000
    expect(decideRate("GOLD18", 50, 8_000_000, 10)).toBe("reject");
    expect(decideRate("USD", 100_000.5, 100_000, 10)).toBe("reject");
  });
  it("regression (security review 3.2b): a slow drift of small steps is held once it exceeds twice the threshold within a day", () => {
    // each step is 9% (below 10%), but against the rate of 24 hours earlier the move is above 20%
    expect(decideRate("USD", 79_000, 86_800, 10, 100_000)).toBe("hold");
    expect(decideRate("USD", 85_000, 90_000, 10, 100_000)).toBe("apply"); // 15% in a day: still applied
    expect(decideRate("USD", 85_000, 90_000, 10, null)).toBe("apply");
    // re-review: days of small steps are bounded by the last rate a person confirmed (3x the threshold)
    expect(decideRate("USD", 69_000, 72_000, 10, 78_000, 100_000)).toBe("hold");
    expect(decideRate("USD", 72_000, 75_000, 10, 78_000, 100_000)).toBe("apply");
  });
  it("staleness", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    expect(isStale(null, now, 6)).toBe(true);
    expect(isStale(new Date("2026-11-23T06:30:00Z"), now, 6)).toBe(false);
    expect(isStale(new Date("2026-11-23T05:59:00Z"), now, 6)).toBe(true);
  });
  it("provider numbers: commas, decimals, rial; anything else is null", () => {
    expect(parseProviderNumber("1,234,567", "toman")).toBe(1_234_567);
    expect(parseProviderNumber("1234567.6", "toman")).toBe(1_234_568);
    expect(parseProviderNumber("1020000", "rial")).toBe(102_000);
    expect(parseProviderNumber(98500, "toman")).toBe(98_500);
    for (const bad of ["", "-5", "1e9", "abc", null, undefined, {}, "12345678901234"]) expect(parseProviderNumber(bad, "toman")).toBeNull();
  });
});
