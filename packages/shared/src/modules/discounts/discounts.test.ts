import { describe, expect, it } from "vitest";
import { discountInputSchema, evaluateDiscount, normalizeCode, type DiscountRule } from "./discounts.js";

const now = new Date("2026-11-24T12:00:00Z");
const rule = (o: Partial<DiscountRule>): DiscountRule => ({
  id: "d1", code: "OFF10", type: "PERCENT", value: 10, maxDiscount: null, minOrder: null, startsAt: null, endsAt: null, usageLimit: null,
  perCustomerLimit: null, firstOrderOnly: false, scope: "ALL", scopeIds: [], active: true, ...o,
});
const cart = { lines: [{ productId: "p1", categoryId: "c1", lineTotal: 200_000 }, { productId: "p2", categoryId: null, lineTotal: 55_555 }], subtotal: 255_555, shippingCost: 30_000 };
const usage = { total: 0, byCustomer: 0, hasPriorOrders: false };

describe("discount rules (phase 5.1)", () => {
  it("percent (rounded down, capped), fixed (never more than the eligible total), free shipping", () => {
    expect(evaluateDiscount(rule({}), cart, usage, now)).toEqual({ ok: true, itemsDiscount: 25_555, shippingDiscount: 0, amount: 25_555 });
    expect(evaluateDiscount(rule({ maxDiscount: 20_000 }), cart, usage, now)).toMatchObject({ amount: 20_000 });
    expect(evaluateDiscount(rule({ type: "FIXED", value: 50_000 }), cart, usage, now)).toMatchObject({ amount: 50_000 });
    expect(evaluateDiscount(rule({ type: "FIXED", value: 900_000 }), cart, usage, now)).toMatchObject({ amount: 255_555 });
    expect(evaluateDiscount(rule({ type: "FREE_SHIPPING", value: 0 }), cart, usage, now)).toEqual({ ok: true, itemsDiscount: 0, shippingDiscount: 30_000, amount: 30_000 });
    // review 5.1: no shipping cost, nothing to discount: no use is spent
    expect(evaluateDiscount(rule({ type: "FREE_SHIPPING", value: 0 }), { ...cart, shippingCost: 0 }, usage, now)).toEqual({ ok: false, reason: "no_shipping" });
  });

  it("scope: only chosen products or categories count", () => {
    expect(evaluateDiscount(rule({ scope: "PRODUCTS", scopeIds: ["p2"] }), cart, usage, now)).toMatchObject({ amount: 5_555 });
    expect(evaluateDiscount(rule({ scope: "CATEGORIES", scopeIds: ["c1"] }), cart, usage, now)).toMatchObject({ amount: 20_000 });
    expect(evaluateDiscount(rule({ scope: "CATEGORIES", scopeIds: ["c9"] }), cart, usage, now)).toEqual({ ok: false, reason: "no_eligible_items" });
  });

  it("limits: active, dates, minimum, total, per customer, first order", () => {
    expect(evaluateDiscount(rule({ active: false }), cart, usage, now)).toMatchObject({ reason: "inactive" });
    expect(evaluateDiscount(rule({ startsAt: "2026-12-01T00:00:00.000Z" }), cart, usage, now)).toMatchObject({ reason: "not_started" });
    expect(evaluateDiscount(rule({ endsAt: "2026-11-24T12:00:00.000Z" }), cart, usage, now)).toMatchObject({ reason: "expired" });
    expect(evaluateDiscount(rule({ minOrder: 300_000 }), cart, usage, now)).toEqual({ ok: false, reason: "min_order", minOrder: 300_000 });
    expect(evaluateDiscount(rule({ usageLimit: 3 }), cart, { ...usage, total: 3 }, now)).toMatchObject({ reason: "exhausted" });
    expect(evaluateDiscount(rule({ perCustomerLimit: 1 }), cart, { ...usage, byCustomer: 1 }, now)).toMatchObject({ reason: "customer_limit" });
    expect(evaluateDiscount(rule({ perCustomerLimit: 1 }), cart, { ...usage, byCustomer: null }, now)).toMatchObject({ ok: true }); // no phone yet
    expect(evaluateDiscount(rule({ firstOrderOnly: true }), cart, { ...usage, hasPriorOrders: true }, now)).toMatchObject({ reason: "first_order_only" });
  });

  it("the merchant's input: normalised code, type-specific value, dates in order, scope ids", () => {
    expect(normalizeCode(" yalda۱۴۰۵ ")).toBe("YALDA1405");
    const ok = discountInputSchema.parse({ code: "yalda-1405", type: "PERCENT", value: "۱۵", maxDiscount: "۵۰,۰۰۰" });
    expect(ok).toMatchObject({ code: "YALDA-1405", value: 15, maxDiscount: 50_000, scope: "ALL", firstOrderOnly: false, active: true });
    expect(discountInputSchema.parse({ code: "SHIPFREE", type: "FREE_SHIPPING" }).value).toBe(0);
    for (const bad of [
      { code: "ab", type: "PERCENT", value: 10 },
      { code: "OFF", type: "PERCENT", value: 120 },
      { code: "OFF", type: "FIXED", value: 500 },
      { code: "OFF", type: "FIXED", value: 5000, maxDiscount: 100 },
      { code: "OFF", type: "PERCENT", value: 10, startsAt: "2026-12-02T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
      { code: "OFF", type: "PERCENT", value: 10, scope: "PRODUCTS" },
      { code: "کد", type: "PERCENT", value: 10 },
    ]) expect(discountInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
