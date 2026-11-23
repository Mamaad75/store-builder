import { describe, expect, it } from "vitest";
import { draftOrder, type ReadySummary } from "./orders.js";

const summary: ReadySummary = {
  ready: true,
  lines: [
    { productId: "p1", variantId: null, name: "چای", variantLabel: "", unitPrice: 100_000, quantity: 2, lineTotal: 200_000 },
    { productId: "p2", variantId: "v1", name: "پیراهن", variantLabel: "سایز: M", unitPrice: 250_000, quantity: 1, lineTotal: 250_000 },
  ],
  shippingOptions: [{ methodId: "m1", name: "پیک", kind: "FLAT" }],
  shippingMethodId: "m1",
  shippingCost: 60_000,
  codFee: 20_000,
  subtotal: 450_000,
  total: 530_000,
  blockers: [],
};
const address = { recipientName: "علی", phone: "+989123456789", province: "tehran", city: "تهران", line: "خیابان آزادی ۱۲", postalCode: "1384567891" };
const base = { id: "o1", storeId: "s1", customerId: null, requestKey: "k".repeat(16), accessTokenHash: "h", summary, address, weights: new Map([["p1", 500], ["p2", null]]), paymentMethod: "COD" as const, note: "" };

describe("drafting an order from a ready checkout", () => {
  it("snapshots every line, the chosen shipping and the amounts exactly as the checkout computed them", () => {
    const o = draftOrder(base);
    expect(o.items.map((i) => [i.name, i.variantLabel, i.unitPrice, i.quantity, i.lineTotal, i.weightGrams, i.position])).toEqual([
      ["چای", "", 100_000, 2, 200_000, 500, 0],
      ["پیراهن", "سایز: M", 250_000, 1, 250_000, null, 1],
    ]);
    expect(o).toMatchObject({ shipping: { methodId: "m1", name: "پیک", kind: "FLAT", cost: 60_000 }, codFee: 20_000, subtotal: 450_000, total: 530_000, itemCount: 3 });
  });

  it("refuses a summary that is not ready or has no chosen shipping option", () => {
    expect(() => draftOrder({ ...base, summary: { ...summary, ready: false } })).toThrow();
    expect(() => draftOrder({ ...base, summary: { ...summary, shippingMethodId: "gone" } })).toThrow();
  });
});
