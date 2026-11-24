import { describe, expect, it } from "vitest";
import type { DiscountInput, DiscountRule } from "@store-builder/shared/modules/discounts/discounts";
import { DiscountCodeTakenError } from "@store-builder/shared/modules/discounts/errors";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { DiscountsService } from "./discounts.service.js";
import type { DiscountStore } from "./ports.js";

function memory(): DiscountStore & { rows: (DiscountRule & { title: string; createdAt: string; used: number })[] } {
  const rows: (DiscountRule & { title: string; createdAt: string; used: number })[] = [];
  return {
    rows,
    list: async () => rows,
    get: async (_s, id) => rows.find((r) => r.id === id) ?? null,
    findByCode: async (_s, code) => rows.find((r) => r.code === code) ?? null,
    create: async (_s, d: DiscountInput) => {
      if (rows.some((r) => r.code === d.code)) return "taken";
      const r = { ...d, id: `d${rows.length + 1}`, createdAt: "", used: 0 };
      rows.push(r);
      return r;
    },
    update: async () => null,
    remove: async () => true,
    usage: async () => ({ total: 0, byCustomer: 0, hasPriorOrders: false }),
  };
}

describe("discounts service (phase 5.1)", () => {
  it("creates validated codes; a taken code is refused; the checkout evaluates case-insensitively", async () => {
    const svc = new DiscountsService(memory(), () => new Date("2026-11-24T00:00:00Z"));
    await svc.create({ storeId: "s1" }, { code: "off10", type: "PERCENT", value: 10 });
    await expect(svc.create({ storeId: "s1" }, { code: "OFF10", type: "FIXED", value: 5000 })).rejects.toBeInstanceOf(DiscountCodeTakenError);
    await expect(svc.create({ storeId: "s1" }, { code: "x", type: "FIXED", value: 5000 })).rejects.toBeInstanceOf(ValidationError);
    const cart = { lines: [{ productId: "p", categoryId: null, lineTotal: 100_000 }], subtotal: 100_000, shippingCost: 0 };
    expect((await svc.evaluate("s1", " off10 ", cart, { phone: null, customerId: null })).result).toMatchObject({ ok: true, amount: 10_000 });
    expect((await svc.evaluate("s1", "NOPE", cart, { phone: null, customerId: null })).result).toEqual({ ok: false, reason: "not_found" });
  });
});
