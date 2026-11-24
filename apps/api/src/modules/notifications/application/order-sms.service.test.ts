import { describe, expect, it } from "vitest";
import { orderSmsPlatformSchema, type OrderSmsKind } from "@store-builder/shared/modules/notifications/order-sms";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { OrderSmsRetryError, OrderSmsService } from "./order-sms.service.js";
import type { ClaimOutcome, SmsStore, StoreSmsChoice, TemplateSender } from "./ports.js";

class MemorySms implements SmsStore {
  rows = new Map<string, { storeId: string; kind: OrderSmsKind; status: string; reason: string | null }>();
  choices = new Map<string, StoreSmsChoice>();
  async choice(storeId: string) {
    return this.choices.get(storeId) ?? { enabled: true, merchantPhone: null };
  }
  async saveChoice(storeId: string, c: StoreSmsChoice) {
    this.choices.set(storeId, c);
    return c;
  }
  async claim(r: { storeId: string; eventId: string; kind: OrderSmsKind }, limits: { cap: number }): Promise<ClaimOutcome> {
    const k = `${r.eventId}|${r.kind}`;
    const ex = this.rows.get(k);
    if (ex && ex.status !== "FAILED") return "duplicate";
    if ((await this.used(r.storeId)) >= limits.cap) {
      this.rows.set(k, { storeId: r.storeId, kind: r.kind, status: "SKIPPED", reason: "monthly_cap" });
      return "capped";
    }
    this.rows.set(k, { storeId: r.storeId, kind: r.kind, status: "PENDING", reason: null });
    return "go";
  }
  async skip(r: { storeId: string; eventId: string; kind: OrderSmsKind }, reason: string) {
    const k = `${r.eventId}|${r.kind}`;
    if (!this.rows.has(k)) this.rows.set(k, { storeId: r.storeId, kind: r.kind, status: "SKIPPED", reason });
  }
  async mark(eventId: string, kind: OrderSmsKind, status: "SENT" | "FAILED", reason: string | null) {
    const r = this.rows.get(`${eventId}|${kind}`);
    if (r?.status === "PENDING") Object.assign(r, { status, reason });
  }
  async used(storeId: string) {
    return [...this.rows.values()].filter((r) => r.storeId === storeId && (r.status === "SENT" || r.status === "PENDING")).length;
  }
}

const allTemplates = Object.fromEntries(["SHOPPER_PLACED", "SHOPPER_SHIPPED", "SHOPPER_CANCELLED", "SHOPPER_EXPIRED", "SHOPPER_RECEIPT_REJECTED", "MERCHANT_NEW_ORDER", "MERCHANT_RECEIPT"].map((k) => [k, `tpl-${k.toLowerCase()}`]));

function setup(o: { enabled?: boolean; cap?: number; templates?: Record<string, string>; sender?: "ok" | "fail" | "none" } = {}) {
  const sent: { phone: string; template: string; tokens: unknown }[] = [];
  let failNext = o.sender === "fail";
  const sender: TemplateSender = {
    async sendTemplate(phone, template, tokens) {
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error("x"), { reason: "server_error" });
      }
      sent.push({ phone, template, tokens });
    },
  };
  const store = new MemorySms();
  const settings = orderSmsPlatformSchema.parse({ enabled: o.enabled ?? true, monthlyCapPerStore: o.cap ?? 500, templates: o.templates ?? allTemplates });
  const svc = new OrderSmsService(
    { get: async (storeId, id) => (id === "o1" ? { number: 7, total: 230_000, storeName: "چای", link: "https://shop.example.ir/orders/TOKEN", phone: "+989121112233", status: "PLACED" } : null) },
    { settings: async () => settings, sender: async () => (o.sender === "none" ? null : sender) },
    store,
  );
  return { svc, sent, store };
}
const placed = (id = "e1") => ({ id, type: "order.placed", storeId: "s1", payload: { orderId: "o1", number: 7 } });

describe("order SMS service (phase 3.6)", () => {
  it("a placed order: the shopper's SMS with number, link and store; the merchant's only with a merchant phone", async () => {
    const { svc, sent, store } = setup();
    await svc.handle(placed());
    expect(sent).toEqual([{ phone: "+989121112233", template: "tpl-shopper_placed", tokens: { token: "7", token2: "https://shop.example.ir/orders/TOKEN", token10: "چای" } }]);
    expect(store.rows.get("e1|MERCHANT_NEW_ORDER")).toMatchObject({ status: "SKIPPED", reason: "no_phone" });
    await store.saveChoice("s1", { enabled: true, merchantPhone: "+989350001122" });
    await svc.handle(placed("e2"));
    expect(sent.at(-1)).toEqual({ phone: "+989350001122", template: "tpl-merchant_new_order", tokens: { token: "7", token2: "230000", token10: "چای" } });
  });

  it("a re-delivered event sends nothing twice; a failed send is retried by the queue (only the failed kind)", async () => {
    const { svc, sent, store } = setup({ sender: "fail" });
    await store.saveChoice("s1", { enabled: true, merchantPhone: "+989350001122" });
    await expect(svc.handle(placed())).rejects.toBeInstanceOf(OrderSmsRetryError);
    expect(store.rows.get("e1|SHOPPER_PLACED")).toMatchObject({ status: "FAILED", reason: "server_error" });
    expect(sent.map((s) => s.template)).toEqual(["tpl-merchant_new_order"]);
    await svc.handle(placed()); // the retry
    await svc.handle(placed()); // a duplicate delivery
    expect(sent.map((s) => s.template)).toEqual(["tpl-merchant_new_order", "tpl-shopper_placed"]);
  });

  it("off switches: platform off (nothing recorded), store off, no template, no sender; the monthly cap", async () => {
    const off = setup({ enabled: false });
    await off.svc.handle(placed());
    expect(off.store.rows.size).toBe(0);
    const store = setup();
    await store.store.saveChoice("s1", { enabled: false, merchantPhone: null });
    await store.svc.handle(placed());
    expect(store.store.rows.get("e1|SHOPPER_PLACED")?.reason).toBe("store_off");
    const noTpl = setup({ templates: {} });
    await noTpl.svc.handle(placed());
    expect(noTpl.store.rows.get("e1|SHOPPER_PLACED")?.reason).toBe("no_template");
    const noSender = setup({ sender: "none" });
    await noSender.svc.handle(placed());
    expect(noSender.store.rows.get("e1|SHOPPER_PLACED")?.reason).toBe("no_sender");
    const capped = setup({ cap: 1 });
    await capped.svc.handle(placed("a"));
    await capped.svc.handle(placed("b"));
    expect([capped.sent.length, capped.store.rows.get("b|SHOPPER_PLACED")?.reason]).toEqual([1, "monthly_cap"]);
  });

  it("review 3.6: a timeout counts as sent and is never retried; a permanent refusal is not retried either", async () => {
    for (const reason of ["timeout", "rejected"]) {
      const store = new MemorySms();
      const svc = new OrderSmsService(
        { get: async () => ({ number: 7, total: 1, storeName: "چای", link: null, phone: "+989121112233", status: "PLACED" }) },
        { settings: async () => orderSmsPlatformSchema.parse({ enabled: true, templates: allTemplates }), sender: async () => ({ sendTemplate: async () => { throw Object.assign(new Error("x"), { reason }); } }) },
        store,
      );
      await svc.handle(placed()); // does not throw: nothing to retry
      expect(store.rows.get("e1|SHOPPER_PLACED")).toMatchObject(reason === "timeout" ? { status: "SENT", reason: "uncertain" } : { status: "FAILED", reason: "rejected" });
    }
  });

  it("status events: shipped/expired/cancelled-by-store send; a shopper's own cancellation and unknown orders do not", async () => {
    const status = { current: "SHIPPED" };
    const sent: string[] = [];
    const svc = new OrderSmsService(
      { get: async (_s, id) => (id === "o1" ? { number: 7, total: 1, storeName: "چای", link: null, phone: "+989121112233", status: status.current } : null) },
      { settings: async () => orderSmsPlatformSchema.parse({ enabled: true, templates: allTemplates }), sender: async () => ({ sendTemplate: async (_p, t) => void sent.push(t) }) },
      new MemorySms(),
    );
    await svc.handle({ id: "s1", type: "order.status_changed", storeId: "s1", payload: { orderId: "o1", to: "SHIPPED", actor: "MERCHANT" } });
    status.current = "CANCELLED";
    await svc.handle({ id: "s2", type: "order.status_changed", storeId: "s1", payload: { orderId: "o1", to: "CANCELLED", actor: "CUSTOMER" } });
    status.current = "EXPIRED";
    await svc.handle({ id: "s3", type: "order.status_changed", storeId: "s1", payload: { orderId: "o1", to: "EXPIRED", actor: "SYSTEM" } });
    status.current = "AWAITING_PAYMENT";
    await svc.handle({ id: "s4", type: "order.receipt_rejected", storeId: "s1", payload: { orderId: "o1" } });
    await svc.handle({ id: "s5", type: "order.placed", storeId: "s1", payload: { orderId: "gone" } });
    // stale: a "placed" delivered after the order expired is not sent
    status.current = "EXPIRED";
    await svc.handle({ id: "s6", type: "order.placed", storeId: "s1", payload: { orderId: "o1" } });
    expect(sent).toEqual(["tpl-shopper_shipped", "tpl-shopper_expired", "tpl-shopper_receipt_rejected"]);
  });

  it("the merchant's settings: validated phone, usage against the cap, which messages exist", async () => {
    const { svc } = setup({ templates: { SHOPPER_PLACED: "a", MERCHANT_NEW_ORDER: "b" } });
    await expect(svc.save({ storeId: "s1" }, { enabled: true, merchantPhone: "123" })).rejects.toBeInstanceOf(ValidationError);
    expect(await svc.save({ storeId: "s1" }, { enabled: true, merchantPhone: "09350001122" })).toMatchObject({
      enabled: true, merchantPhone: "+989350001122", platformEnabled: true, monthlyCap: 500, usedThisMonth: 0, available: ["SHOPPER_PLACED", "MERCHANT_NEW_ORDER"],
    });
  });
});
