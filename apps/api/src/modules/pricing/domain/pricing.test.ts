import { describe, expect, it } from "vitest";
import { lowestPrice, repriceLinks, targetOf } from "./pricing.js";

const at = new Date("2026-11-24T08:00:00Z");

describe("repriceLinks", () => {
  it("prices every link at its own rate; a missing rate leaves the link alone; an out-of-range result is reported", () => {
    const out = repriceLinks(
      [
        { productId: "p1", variantId: null, link: { kind: "USD", usdCents: 1_000, roundingToman: 1 } },
        { productId: "p2", variantId: "v1", link: { kind: "GOLD", weightMg: 1_000, wageBp: 0, profitBp: 0, taxBp: 0, stoneToman: 0, roundingToman: 1 } },
        { productId: "p3", variantId: null, link: { kind: "USD", usdCents: 100_000_000, roundingToman: 1 } },
      ],
      { USD: { rateToman: 100_000, appliedAt: at } },
    );
    expect(out).toEqual([
      { productId: "p1", variantId: null, result: "priced", priceToman: 1_000_000, rateAt: at },
      { productId: "p2", variantId: "v1", result: "no_rate" },
      { productId: "p3", variantId: null, result: "out_of_range" },
    ]);
  });
  it("lowest price and targets", () => {
    expect(lowestPrice([])).toBeNull();
    expect(lowestPrice([30, 10, 20])).toBe(10);
    expect(targetOf(null)).toBe("-");
    expect(targetOf("v1")).toBe("v1");
  });
});
