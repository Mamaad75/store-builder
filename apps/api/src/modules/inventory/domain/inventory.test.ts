import { describe, expect, it } from "vitest";
import type { VariantInput } from "@store-builder/shared/modules/inventory/variants";
import { MAX_LINE_QUANTITY, MAX_RESERVATION_LINES, RESERVATION_TTL_DEFAULT_S, normaliseReservation, planVariantReplace, sellable } from "./inventory.js";

const K = (colour: string) => JSON.stringify([["رنگ", colour]]);
const v = (colour: string, price = 100): VariantInput => ({ options: [{ name: "رنگ", value: colour }], price, stockQuantity: 1 });

describe("planVariantReplace", () => {
  it("keeps the id of an unchanged combination, inserts new ones and removes the rest, in the new order", () => {
    const plan = planVariantReplace(
      [
        { id: "red1", optionsKey: K("قرمز") },
        { id: "blue1", optionsKey: K("آبی") },
      ],
      [v("سبز"), v("قرمز", 250)],
    );
    expect(plan.update).toEqual([{ id: "red1", input: v("قرمز", 250), optionsKey: K("قرمز"), position: 1 }]);
    expect(plan.insert).toEqual([{ input: v("سبز"), optionsKey: K("سبز"), position: 0 }]);
    expect(plan.remove).toEqual(["blue1"]);
  });
  it("an empty set removes everything", () => {
    expect(planVariantReplace([{ id: "a", optionsKey: "x=y" }], [])).toEqual({ update: [], insert: [], remove: ["a"] });
  });
});

describe("normaliseReservation", () => {
  it("merges repeated lines and returns them in lock order (product, then variant)", () => {
    const r = normaliseReservation(
      "cart_1",
      [
        { productId: "pb", quantity: 1 },
        { productId: "pa", variantId: "vz", quantity: 2 },
        { productId: "pa", variantId: "va", quantity: 1 },
        { productId: "pb", variantId: null, quantity: 3 },
      ],
      undefined,
    );
    expect(r).toEqual({
      ok: true,
      ref: "cart_1",
      ttlSeconds: RESERVATION_TTL_DEFAULT_S,
      lines: [
        { productId: "pa", variantId: "va", quantity: 1 },
        { productId: "pa", variantId: "vz", quantity: 2 },
        { productId: "pb", variantId: null, quantity: 4 },
      ],
    });
  });
  it("refuses malformed requests", () => {
    const line = { productId: "p1", quantity: 1 };
    expect(normaliseReservation("bad ref!", [line], undefined)).toEqual({ ok: false, problem: "bad_ref" });
    expect(normaliseReservation("r", [], undefined)).toEqual({ ok: false, problem: "no_lines" });
    expect(normaliseReservation("r", [line], 30)).toEqual({ ok: false, problem: "bad_ttl" });
    expect(normaliseReservation("r", [line], 7200)).toEqual({ ok: false, problem: "bad_ttl" });
    for (const bad of [{ productId: "P-1", quantity: 1 }, { productId: "p1", quantity: 0 }, { productId: "p1", quantity: 1.5 }, { productId: "p1", variantId: 5, quantity: 1 }, { productId: "p1", quantity: "2" }])
      expect(normaliseReservation("r", [bad], undefined), JSON.stringify(bad)).toEqual({ ok: false, problem: "bad_line" });
    // merged quantity over the per-line cap
    expect(normaliseReservation("r", [{ productId: "p1", quantity: MAX_LINE_QUANTITY }, { productId: "p1", quantity: 1 }], undefined)).toEqual({ ok: false, problem: "bad_line" });
    const many = Array.from({ length: MAX_RESERVATION_LINES + 1 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(normaliseReservation("r", many, undefined)).toEqual({ ok: false, problem: "too_many_lines" });
  });
});

describe("sellable", () => {
  const line = (variantId: string | null) => ({ productId: "p", variantId, quantity: 1 });
  it("is the stock of what was asked for when it can be sold", () => {
    expect(sellable(line(null), { productActive: true, hasVariants: false, available: 4 })).toBe(4);
    expect(sellable(line("v"), { productActive: true, hasVariants: true, available: 2 })).toBe(2);
  });
  it("is 0 for a missing or inactive product, and when the variant choice does not match the product", () => {
    expect(sellable(line(null), { productActive: true, hasVariants: false, available: null })).toBe(0);
    expect(sellable(line(null), { productActive: false, hasVariants: false, available: 9 })).toBe(0);
    expect(sellable(line(null), { productActive: true, hasVariants: true, available: 9 })).toBe(0); // must choose a variant
    expect(sellable(line("v"), { productActive: true, hasVariants: false, available: 9 })).toBe(0);
  });
});
