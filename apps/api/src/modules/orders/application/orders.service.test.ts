import { describe, expect, it } from "vitest";
import { PaymentUnavailableError, OrderNotReadyError, OrderRateLimitedError, OrderTransitionError } from "@store-builder/shared/modules/orders/errors";
import { ReservationLostError } from "@store-builder/shared/modules/inventory/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { OrderStatus } from "@store-builder/shared/modules/orders/orders";
import type { NewOrder, OrderView, ReadySummary } from "../domain/orders.js";
import { OrdersService } from "./orders.service.js";
import type { CheckoutPort, OrderStore, Shopper, StockHold } from "./ports.js";

const ready: ReadySummary = {
  ready: true,
  lines: [{ productId: "p1", variantId: null, name: "چای", variantLabel: "", unitPrice: 100_000, quantity: 2, lineTotal: 200_000 }],
  shippingOptions: [{ methodId: "m1", name: "پیک", kind: "FLAT" }],
  shippingMethodId: "m1",
  shippingCost: 30_000,
  codFee: 0,
  subtotal: 200_000,
  total: 230_000,
  blockers: [],
};
const address = { recipientName: "علی", phone: "+989123456789", province: "tehran", city: "تهران", line: "خیابان آزادی ۱۲", postalCode: "1384567891" };

class MemoryOrders implements OrderStore {
  rows: (OrderView & { storeId: string; requestKey: string; tokenHash: string })[] = [];
  createResult: "hold_lost" | "duplicate" | null = null;
  private view(o: NewOrder, n: number): OrderView {
    return {
      id: o.id, number: n, status: o.paymentMethod === "ONLINE" ? "AWAITING_PAYMENT" : "PLACED", paymentGateway: o.paymentGateway, paymentDeadline: o.paymentDeadline?.toISOString() ?? null, payment: null, createdAt: "2026-01-01T00:00:00.000Z", customerId: o.customerId, address: o.address,
      shipping: { name: o.shipping.name, kind: o.shipping.kind, cost: o.shipping.cost }, paymentMethod: o.paymentMethod, subtotal: o.subtotal, codFee: o.codFee,
      total: o.total, itemCount: o.itemCount, note: o.note, items: o.items.map((i) => ({ productId: i.productId, variantId: i.variantId, name: i.name, variantLabel: i.variantLabel, unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.lineTotal, weightGrams: i.weightGrams })), history: [{ from: null, to: "PLACED", actor: "CUSTOMER", note: "", at: "" }],
    };
  }
  async findByRequestKey(storeId: string, k: string) { return this.rows.find((r) => r.storeId === storeId && r.requestKey === k) ?? null; }
  async create(o: NewOrder) {
    if (this.createResult) return this.createResult;
    const v = { ...this.view(o, this.rows.length + 1), storeId: o.storeId, requestKey: o.requestKey, tokenHash: o.accessTokenHash };
    this.rows.push(v);
    return v;
  }
  async getById(storeId: string, id: string) { return this.rows.find((r) => r.storeId === storeId && r.id === id) ?? null; }
  async getByTokenHash(storeId: string, h: string) { return this.rows.find((r) => r.storeId === storeId && r.tokenHash === h) ?? null; }
  async getForCustomer(storeId: string, c: string, id: string) { return this.rows.find((r) => r.storeId === storeId && r.customerId === c && r.id === id) ?? null; }
  async listForCustomer(storeId: string, c: string) { return this.rows.filter((r) => r.storeId === storeId && r.customerId === c); }
  async list() { return { items: this.rows, nextCursor: null }; }
  async customerStats() { return []; }
  async transition(storeId: string, id: string, to: OrderStatus, check: (s: OrderStatus, m: "COD" | "ONLINE" | "CARD_TRANSFER") => void) {
    const r = this.rows.find((x) => x.storeId === storeId && x.id === id);
    if (!r) return null;
    check(r.status, r.paymentMethod);
    r.status = to;
    return r;
  }
}

function setup(o: { summary?: ReadySummary; allow?: boolean } = {}) {
  const orders = new MemoryOrders();
  const held: string[] = [];
  const released: string[] = [];
  const checkout: CheckoutPort = {
    liveStoreId: async (label) => { if (label !== "shop") throw new NotFoundError(); return "s1"; },
    prepareOrder: async () => ({ storeId: "s1", summary: o.summary ?? ready, address, cartId: "c1", weights: new Map() }),
  };
  const stock: StockHold = { reserve: async (_s, ref) => void held.push(ref), release: async (_s, ref) => { released.push(ref); return 1; } };
  let n = 0;
  const svc = new OrdersService(
    orders, checkout, stock,
    { tokenFor: (id) => `t${id}`.padEnd(43, "x"), hash: (t) => (t.length === 43 ? `h:${t}` : null), requestKeyFor: (k, owner) => `${owner}|${k}` },
    { consume: async () => ({ allowed: o.allow ?? true, retryAfterSeconds: 9 }) },
    () => `o${++n}`,
  );
  return { svc, orders, held, released };
}
const guest: Shopper = { cartToken: "t", customerId: null, ipKey: "1.2.3.4" };
const body = { requestKey: "r".repeat(20), shippingMethodId: "m1", paymentMethod: "COD", address: {} };

describe("placing an order", () => {
  it("holds the stock under the order id, writes the order and hands out its access token", async () => {
    const { svc, held, released } = setup();
    const r = await svc.place("shop", guest, body);
    expect(r.order).toMatchObject({ id: "o1", number: 1, status: "PLACED", total: 230_000 });
    expect(r.canCancel).toBe(true);
    expect(r.accessToken).toMatch(/^to1/);
    expect(held).toEqual(["o1"]);
    expect(released).toEqual([]);
  });

  it("the same request key returns the same order (and token) instead of a second one", async () => {
    const { svc, orders, held } = setup();
    const a = await svc.place("shop", guest, body);
    const b = await svc.place("shop", guest, body);
    expect(b.order.id).toBe(a.order.id);
    expect(b.accessToken).toBe(a.accessToken);
    expect(orders.rows).toHaveLength(1);
    expect(held).toEqual(["o1"]);
  });

  it("an incomplete checkout orders nothing and holds nothing", async () => {
    const { svc, held } = setup({ summary: { ...ready, ready: false, blockers: ["no_shipping_for_province"] } });
    await expect(svc.place("shop", guest, body)).rejects.toMatchObject({ blockers: ["no_shipping_for_province"] });
    await expect(svc.place("shop", guest, body)).rejects.toBeInstanceOf(OrderNotReadyError);
    expect(held).toEqual([]);
  });

  it("a lost hold or a failed write releases the stock it took", async () => {
    const { svc, orders, released } = setup();
    orders.createResult = "hold_lost";
    await expect(svc.place("shop", guest, body)).rejects.toBeInstanceOf(ReservationLostError);
    expect(released).toEqual(["o1"]);
  });

  it("is rate limited, validated, refuses client prices, and refuses online payment without a payment service", async () => {
    await expect(setup({ allow: false }).svc.place("shop", guest, body)).rejects.toBeInstanceOf(OrderRateLimitedError);
    const { svc, held } = setup();
    await expect(svc.place("shop", guest, { ...body, paymentMethod: "ONLINE" })).rejects.toBeInstanceOf(PaymentUnavailableError);
    await expect(svc.place("shop", guest, { ...body, paymentMethod: "CARD" })).rejects.toBeInstanceOf(ValidationError);
    expect(held).toEqual([]);
    await expect(svc.place("shop", guest, { ...body, total: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.place("nope", guest, body)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("review 3.4 regressions", () => {
  it("the same requestKey from another shopper is a different checkout: never someone else's order or token", async () => {
    const { svc, orders } = setup();
    const a = await svc.place("shop", guest, body);
    const b = await svc.place("shop", { ...guest, cartToken: "other-cart" }, body);
    expect(b.order.id).not.toBe(a.order.id);
    expect(orders.rows).toHaveLength(2);
    await expect(svc.place("shop", { ...guest, cartToken: null }, body)).rejects.toBeInstanceOf(OrderNotReadyError);
  });
});

describe("following and cancelling", () => {
  it("a guest follows and cancels with the token; a forged token is a 404; after confirmation only the store can cancel", async () => {
    const { svc } = setup();
    const { accessToken } = await svc.place("shop", guest, body);
    expect((await svc.getByToken("shop", accessToken)).order.number).toBe(1);
    await expect(svc.getByToken("shop", "x".repeat(43))).rejects.toBeInstanceOf(NotFoundError);
    await svc.transition({ storeId: "s1", actorId: "u1" }, "o1", { to: "CONFIRMED" });
    await expect(svc.cancelByToken("shop", accessToken, guest)).rejects.toBeInstanceOf(OrderTransitionError);
    expect((await svc.transition({ storeId: "s1", actorId: "u1" }, "o1", { to: "CANCELLED" })).status).toBe("CANCELLED");
  });

  it("a customer sees only their own orders; the merchant cannot skip steps", async () => {
    const { svc } = setup();
    await svc.place("shop", { ...guest, customerId: "c1" }, body);
    expect(await svc.listMine("s1", "c1")).toHaveLength(1);
    await expect(svc.getMine("s1", "c2", "o1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.cancelMine("s1", "c2", "o1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.transition({ storeId: "s1", actorId: "u1" }, "o1", { to: "DELIVERED" })).rejects.toBeInstanceOf(OrderTransitionError);
    expect((await svc.cancelMine("s1", "c1", "o1")).order.status).toBe("CANCELLED");
  });
});
