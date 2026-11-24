import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { paymentReturnDto, paymentSettingsViewDto, placedOrderDto, shopperOrderDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import { PaymentsService } from "./application/payments.service.js";
import type { GatewayInquiry, GatewayRequest, GatewayVerify, PaymentGateway, VerifyResult } from "./application/ports.js";

/** Phase 3.5 on real PostgreSQL, over HTTP, with a fake Zarinpal: online orders, paying, verifying, reconciling, expiring. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const MERCHANT_ID = "1344b5d4-0048-11e8-94db-005056a205be";

class FakeZarinpal implements PaymentGateway {
  requests: GatewayRequest[] = [];
  verifies: GatewayVerify[] = [];
  inquiries: GatewayInquiry[] = [];
  n = 0;
  requestOk = true;
  verifyResult: (v: GatewayVerify) => VerifyResult = () => ({ outcome: "paid", code: 100, refId: String(200 + this.verifies.length), cardPan: "502229******5995", fee: 0 });
  inquiryStatus: "PAID" | "IN_BANK" | "FAILED" | "VERIFIED" | "REVERSED" | "unknown" = "IN_BANK";
  startUrl(_sandbox: boolean, authority: string) {
    return `https://sandbox.zarinpal.com/pg/StartPay/${authority}`;
  }
  async request(r: GatewayRequest) {
    this.requests.push(r);
    if (!this.requestOk) return { ok: false as const, code: -9 };
    return { ok: true as const, authority: `S${String(++this.n).padStart(35, "0")}` };
  }
  async verify(v: GatewayVerify) {
    this.verifies.push(v);
    return this.verifyResult(v);
  }
  async inquiry(q: GatewayInquiry) {
    this.inquiries.push(q);
    return { status: this.inquiryStatus };
  }
}

let app: NestExpressApplication | undefined;
let base = "";
let zp: FakeZarinpal;

beforeEach(async () => {
  await resetDb();
  zp = new FakeZarinpal();
  ({ app, base } = await listenFetchable(() => createApp(config, { paymentGateway: zp })));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

let keyN = 0;
const requestKey = () => `pay-${Date.now()}-${++keyN}`.padEnd(20, "x");
const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };

async function liveStore(label: string, o: { online?: boolean } = {}) {
  const owner = await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 5, status: "ACTIVE" } });
  const products: StorefrontProduct[] = [{ ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 5, categoryId: null }];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const method = await prisma.shippingMethod.create({ data: { storeId: store.id, name: "پیک", kind: "FLAT", price: 30_000, codEnabled: true, codFee: 10_000 } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const merchant = `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
  if (o.online !== false) {
    await enablePlatform();
    expect((await merchantCall(merchant, "PUT", `/stores/${store.id}/secrets/payment.zarinpal.merchant_id`, { value: MERCHANT_ID })).status).toBe(204);
  }
  return { storeId: store.id, tea: tea.id, method: method.id, merchant };
}

const enablePlatform = () =>
  prisma.platformSetting.upsert({ where: { key: "payment" }, create: { key: "payment", value: { zarinpalEnabled: true, sandbox: true } }, update: { value: { zarinpalEnabled: true, sandbox: true } } });

function shopper(label: string) {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(`${base}/api/public/stores/${label}${path}`, {
      method,
      headers: { origin: `http://${label}.localhost:3000`, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    const text = await r.text();
    return { status: r.status, json: (text ? JSON.parse(text) : null) as any };
  };
  return { call };
}

async function merchantCall(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** An online order of 2 teas (230,000 toman with shipping, no cash-on-delivery fee). */
async function onlineOrder(label = "shop") {
  const s = await liveStore(label);
  const me = shopper(label);
  await me.call("POST", "/cart/items", { productId: s.tea, quantity: 2 });
  const placed = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE" });
  expect(placed.status).toBe(201);
  return { s, me, placed: placedOrderDto.parse(placed.json) };
}

const stock = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stockQuantity;

describe("online payment (phase 3.5)", () => {
  it("is offered only when the platform has it on AND the store has a well-formed merchant id", async () => {
    const s = await liveStore("shop", { online: false });
    const me = shopper("shop");
    expect((await me.call("GET", "/checkout/payment-methods")).json).toEqual({ cod: true, online: false, gateways: [], cardTransfer: false });
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const refused = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE" });
    expect(refused.status).toBe(422);
    expect(refused.json.errorName).toBe("PaymentUnavailableError");
    expect(await prisma.order.count()).toBe(0);
    expect(await stock(s.tea)).toBe(5);

    await enablePlatform();
    expect((await me.call("GET", "/checkout/payment-methods")).json.online).toBe(false); // no merchant id yet
    await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.zarinpal.merchant_id`, { value: "not-a-merchant-id" });
    expect((await me.call("GET", "/checkout/payment-methods")).json.online).toBe(false);
    const v = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/payment-settings`);
    expect(paymentSettingsViewDto.parse(v.json).gateways).toEqual([
      { gateway: "ZARINPAL", platformEnabled: true, configured: true, valid: false, active: false, callbackUrl: "http://shop.localhost:3000/checkout/payment/return" },
      { gateway: "AQAYEPARDAKHT", platformEnabled: false, configured: false, valid: false, active: false, callbackUrl: "http://shop.localhost:3000/checkout/payment/return/aqayepardakht" },
    ]);
    expect(JSON.stringify(v.json)).not.toContain("not-a-merchant-id");
    await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.zarinpal.merchant_id`, { value: MERCHANT_ID });
    expect((await me.call("GET", "/checkout/payment-methods")).json.online).toBe(true);
  });

  it("an online order awaits its payment: stock taken, cart emptied, no fee, a deadline, and no 'order.placed' yet", async () => {
    const { s, me, placed } = await onlineOrder();
    expect(placed.order).toMatchObject({ status: "AWAITING_PAYMENT", paymentMethod: "ONLINE", codFee: 0, total: 230_000, payment: null });
    expect(placed.canPay).toBe(true);
    const deadline = new Date(placed.order.paymentDeadline!).getTime();
    expect(deadline - Date.now()).toBeGreaterThan(19 * 60_000);
    expect(deadline - Date.now()).toBeLessThanOrEqual(20 * 60_000);
    expect(await stock(s.tea)).toBe(3);
    expect((await me.call("GET", "/cart")).json.lines).toEqual([]);
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed" } })).toBe(0);
  });

  it("paying: the gateway gets the order's own total in RIAL, the store's return address and auto_verify off; the return verifies server-side", async () => {
    const { s, me, placed } = await onlineOrder();
    const t = placed.accessToken;
    const start = await me.call("POST", `/checkout/orders/${t}/pay`);
    expect(start.status).toBe(200);
    expect(start.json.url).toMatch(/^https:\/\/sandbox\.zarinpal\.com\/pg\/StartPay\/S0{34}1$/);
    expect(zp.requests[0]).toMatchObject({ sandbox: true, merchantId: MERCHANT_ID, amountRial: 2_300_000, callbackUrl: "http://shop.localhost:3000/checkout/payment/return", orderRef: "1", mobile: "09123456789" });
    expect(zp.requests[0]!.description).toContain("فروشگاه shop");
    const authority = `S${"1".padStart(35, "0")}`;

    const back = await me.call("POST", "/checkout/payments/verify", { authority, status: "OK" });
    expect(back.status).toBe(200);
    expect(paymentReturnDto.parse(back.json)).toEqual({ outcome: "paid", accessToken: t });
    expect(zp.verifies).toEqual([{ sandbox: true, merchantId: MERCHANT_ID, amountRial: 2_300_000, authority }]);

    const view = shopperOrderDto.parse((await me.call("GET", `/checkout/orders/${t}`)).json);
    expect(view.order.status).toBe("PLACED");
    expect(view.order.payment).toMatchObject({ refId: "201", cardPan: "502229******5995" });
    expect(view.canPay).toBe(false);
    expect(view.order.history.map((h) => [h.from, h.to, h.actor])).toEqual([[null, "AWAITING_PAYMENT", "CUSTOMER"], ["AWAITING_PAYMENT", "PLACED", "SYSTEM"]]);
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed", storeId: s.storeId } })).toBe(1);

    // the same return again (reload): same answer, no second verify, no second event
    expect((await me.call("POST", "/checkout/payments/verify", { authority, status: "OK" })).json.outcome).toBe("paid");
    expect(zp.verifies).toHaveLength(1);
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed" } })).toBe(1);
    // a paid order cannot be paid again
    expect((await me.call("POST", `/checkout/orders/${t}/pay`)).status).toBe(409);

    const attempts = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders/${placed.order.id}/payments`);
    expect(attempts.json).toHaveLength(1);
    expect(attempts.json[0]).toMatchObject({ status: "PAID", refId: "201" });
    expect(JSON.stringify(attempts.json)).not.toContain(authority);
  });

  it("Status=NOK changes nothing; 'not paid yet' (-51, e.g. a forged early return) leaves the attempt open; only -50/-54 fail it", async () => {
    const { me, placed } = await onlineOrder();
    const t = placed.accessToken;
    await me.call("POST", `/checkout/orders/${t}/pay`);
    const a1 = `S${"1".padStart(35, "0")}`;
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "NOK" })).json.outcome).toBe("failed");
    expect(zp.verifies).toHaveLength(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } })).status).toBe("CREATED");

    zp.verifyResult = () => ({ outcome: "pending", code: -51 });
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" })).json.outcome).toBe("failed");
    expect(await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } })).toMatchObject({ status: "CREATED", lastCode: -51, verifySentAt: null });
    // the buyer really pays afterwards and comes back: verified
    zp.verifyResult = () => ({ outcome: "paid", code: 100, refId: "555", cardPan: null, fee: null });
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" })).json.outcome).toBe("paid");

    const second = await onlineOrder("shop2");
    await second.me.call("POST", `/checkout/orders/${second.placed.accessToken}/pay`);
    const a2 = `S${"2".padStart(35, "0")}`;
    zp.verifyResult = () => ({ outcome: "failed", code: -50 });
    expect((await second.me.call("POST", "/checkout/payments/verify", { authority: a2, status: "OK" })).json.outcome).toBe("failed");
    expect(await prisma.payment.findUniqueOrThrow({ where: { authority: a2 } })).toMatchObject({ status: "FAILED", lastCode: -50 });
    const view = (await second.me.call("GET", `/checkout/orders/${second.placed.accessToken}`)).json;
    expect([view.order.status, view.canPay]).toEqual(["AWAITING_PAYMENT", true]);
    expect((await second.me.call("POST", `/checkout/orders/${second.placed.accessToken}/pay`)).status).toBe(200);
  });

  it("the order link goes back only to the browser that opened the payment (return-key cookie), never to whoever has the authority", async () => {
    const { s, me, placed } = await onlineOrder();
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    const a1 = `S${"1".padStart(35, "0")}`;
    const stranger = shopper("shop");
    const r = await stranger.call("POST", "/checkout/payments/verify", { authority: a1, status: "NOK" });
    expect(r.json).toEqual({ outcome: "failed", accessToken: null });
    const ok = await stranger.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" });
    expect(ok.json).toEqual({ outcome: "paid", accessToken: null });
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" })).json).toEqual({ outcome: "paid", accessToken: placed.accessToken });
    // a paid online order is not cancelled by the shopper (the store cancels it and returns the money)
    expect((await me.call("POST", `/checkout/orders/${placed.accessToken}/cancel`)).status).toBe(409);
    expect((await me.call("GET", `/checkout/orders/${placed.accessToken}`)).json.canCancel).toBe(false);
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/status`, { to: "CANCELLED", note: "" })).status).toBe(200);
  });

  it("a LOST verify answer may mean captured money: the order can be neither cancelled nor expired until a definite answer", async () => {
    const { s, me, placed } = await onlineOrder();
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    const a1 = `S${"1".padStart(35, "0")}`;
    zp.verifyResult = () => ({ outcome: "unknown" });
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" })).json.outcome).toBe("pending");
    const p1 = await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } });
    expect(p1.status).toBe("CREATED");
    expect(p1.verifySentAt).not.toBeNull();
    expect((await me.call("POST", `/checkout/orders/${placed.accessToken}/cancel`)).status).toBe(409);
    expect((await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`)).status).toBe(409);

    const svc = app!.get(PaymentsService);
    await prisma.order.update({ where: { id: placed.order.id }, data: { paymentDeadline: new Date(Date.now() - 60 * 60_000) } });
    await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    zp.inquiryStatus = "unknown";
    expect((await svc.reconcile()).expiredOrders).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("AWAITING_PAYMENT");
    expect(await stock(s.tea)).toBe(3);
    // Zarinpal answers again: it was verified (101): the order is placed after all
    zp.inquiryStatus = "VERIFIED";
    zp.verifyResult = () => ({ outcome: "paid", code: 101, refId: "909", cardPan: null, fee: null });
    await prisma.payment.updateMany({ data: { nextCheckAt: new Date(0) } });
    expect(await svc.reconcile()).toMatchObject({ paid: 1, expiredOrders: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("PLACED");
  });

  it("captured money on an order already paid by another attempt is recorded REFUND_REQUIRED, never silently dropped", async () => {
    const { me, placed } = await onlineOrder();
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    const a1 = `S${"1".padStart(35, "0")}`;
    zp.verifyResult = () => ({ outcome: "unknown" }); // a1: the verify answer is lost
    await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" });
    // the shop lets no new attempt start meanwhile; simulate a second attempt that was opened before (two tabs)
    const first = await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } });
    await prisma.payment.create({
      data: { storeId: first.storeId, orderId: placed.order.id, provider: "ZARINPAL", sandbox: true, authority: `S${"9".padStart(35, "0")}`, amountRial: 2_300_000n, merchantFingerprint: first.merchantFingerprint, returnKeyHash: "b".repeat(64) },
    });
    zp.verifyResult = (v) => ({ outcome: "paid", code: 100, refId: v.authority.endsWith("9") ? "999" : "111", cardPan: null, fee: null });
    expect((await me.call("POST", "/checkout/payments/verify", { authority: `S${"9".padStart(35, "0")}`, status: "OK" })).json.outcome).toBe("paid");
    // a1 is still open (lost answer): the reconciler resumes it; it turns out captured too
    await prisma.payment.updateMany({ where: { authority: a1 }, data: { createdAt: new Date(Date.now() - 10 * 60_000), nextCheckAt: new Date(0) } });
    zp.inquiryStatus = "VERIFIED";
    expect((await app!.get(PaymentsService).reconcile()).paid).toBe(1);
    expect(await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } })).toMatchObject({ status: "REFUND_REQUIRED", refId: "111" });
    expect(await prisma.payment.count({ where: { status: "PAID" } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed" } })).toBe(1);
  });

  it("an attempt is verified only with the merchant id that opened it: a changed id leaves it open, never failed", async () => {
    const { s, me, placed } = await onlineOrder();
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.zarinpal.merchant_id`, { value: "2344b5d4-0048-11e8-94db-005056a205be" });
    const a1 = `S${"1".padStart(35, "0")}`;
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" })).json.outcome).toBe("pending");
    expect(zp.verifies).toHaveLength(0);
    expect(await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } })).toMatchObject({ status: "CREATED", verifySentAt: null });
  });

  it("an unclear verify answer settles nothing; the reconciler asks the gateway, verifies and places the order", async () => {
    const { me, placed } = await onlineOrder();
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    const a1 = `S${"1".padStart(35, "0")}`;
    zp.verifyResult = () => ({ outcome: "unknown", code: -12 }); // an answer that settles nothing (too many attempts)
    expect((await me.call("POST", "/checkout/payments/verify", { authority: a1, status: "OK" })).json.outcome).toBe("pending");
    const open = await prisma.payment.findUniqueOrThrow({ where: { authority: a1 } });
    expect(open.status).toBe("CREATED");
    expect(open.verifySentAt).not.toBeNull(); // review D35c-1: an unknown answer proves nothing: the order cannot expire meanwhile

    const svc = app!.get(PaymentsService);
    zp.inquiryStatus = "IN_BANK";
    await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect(await svc.reconcile()).toMatchObject({ paid: 0, unclear: 1, expiredOrders: 0 });
    zp.inquiryStatus = "PAID";
    zp.verifyResult = () => ({ outcome: "paid", code: 101, refId: "777", cardPan: null, fee: null });
    expect((await svc.reconcile()).paid).toBe(0); // backed off: not due yet
    await prisma.payment.updateMany({ data: { nextCheckAt: new Date(0) } });
    expect(await svc.reconcile()).toMatchObject({ paid: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("PLACED");
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed" } })).toBe(1);
  });

  it("an unpaid order expires after its deadline (plus grace): stock back, attempts closed and never verified", async () => {
    const { s, me, placed } = await onlineOrder();
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    const svc = app!.get(PaymentsService);
    // still inside the window: nothing happens
    expect((await svc.reconcile()).expiredOrders).toBe(0);
    await prisma.order.update({ where: { id: placed.order.id }, data: { paymentDeadline: new Date(Date.now() - 16 * 60_000) } });
    await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    zp.inquiryStatus = "IN_BANK";
    expect((await svc.reconcile()).expiredOrders).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("EXPIRED");
    expect((await prisma.payment.findFirstOrThrow()).status).toBe("EXPIRED");
    expect(await stock(s.tea)).toBe(5);
    expect(zp.verifies).toHaveLength(0);
    // the buyer comes back late: never verified (Zarinpal returns the money)
    expect((await me.call("POST", "/checkout/payments/verify", { authority: `S${"1".padStart(35, "0")}`, status: "OK" })).json.outcome).toBe("closed");
    expect(zp.verifies).toHaveLength(0);
    expect((await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`)).status).toBe(409);
  });

  it("past the deadline no new payment can start; while one is being verified the order cannot be cancelled", async () => {
    const { me, placed } = await onlineOrder();
    const t = placed.accessToken;
    await me.call("POST", `/checkout/orders/${t}/pay`);
    await prisma.payment.updateMany({ data: { status: "VERIFYING", claimedAt: new Date() } });
    const c = await me.call("POST", `/checkout/orders/${t}/cancel`);
    expect(c.status).toBe(409);
    expect(c.json.errorName).toBe("PaymentNotAllowedError");
    await prisma.payment.updateMany({ data: { status: "FAILED", claimedAt: null } });
    await prisma.order.update({ where: { id: placed.order.id }, data: { paymentDeadline: new Date(Date.now() - 1000) } });
    expect((await me.call("POST", `/checkout/orders/${t}/pay`)).status).toBe(409);
    expect((await me.call("POST", `/checkout/orders/${t}/cancel`)).status).toBe(200);
  });

  it("at most 5 attempts per order; a gateway refusal answers 502 and records nothing", async () => {
    const { me, placed } = await onlineOrder();
    const t = placed.accessToken;
    zp.requestOk = false;
    const r = await me.call("POST", `/checkout/orders/${t}/pay`);
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toMatch(/-9|zarinpal/i);
    expect(await prisma.payment.count()).toBe(0);
    zp.requestOk = true;
    for (let i = 0; i < 5; i++) expect((await me.call("POST", `/checkout/orders/${t}/pay`)).status).toBe(200);
    expect((await me.call("POST", `/checkout/orders/${t}/pay`)).status).toBe(409);
  });

  it("an authority is looked up within the store only; malformed bodies are 400", async () => {
    const { me, placed } = await onlineOrder("shop");
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    await liveStore("other");
    const a = `S${"1".padStart(35, "0")}`;
    expect((await shopper("other").call("POST", "/checkout/payments/verify", { authority: a, status: "OK" })).status).toBe(404);
    expect(zp.verifies).toHaveLength(0);
    for (const bad of [{}, { authority: "x", status: "OK" }, { authority: a, status: "MAYBE" }, { authority: a, status: "OK", amount: 1 }]) {
      expect((await me.call("POST", "/checkout/payments/verify", bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("Aghaye Pardakht and the choice of gateway (D35c-1)", () => {
  class FakeAqaye implements PaymentGateway {
    requests: GatewayRequest[] = [];
    verifies: GatewayVerify[] = [];
    n = 0;
    verifyResult: () => VerifyResult = () => ({ outcome: "paid", code: 1, refId: "AP" + String(this.n).padStart(10, "0"), cardPan: null, fee: null });
    startUrl(sandbox: boolean, t: string) {
      return `https://panel.aqayepardakht.ir/startpay/${sandbox ? "sandbox/" : ""}${t}`;
    }
    async request(r: GatewayRequest) {
      this.requests.push(r);
      return { ok: true as const, authority: `AP${String(++this.n).padStart(10, "0")}` };
    }
    async verify(v: GatewayVerify) {
      this.verifies.push(v);
      return this.verifyResult();
    }
  }
  let ap: FakeAqaye;
  beforeEach(async () => {
    await app?.close();
    ap = new FakeAqaye();
    ({ app, base } = await listenFetchable(() => createApp(config, { paymentGateway: { ZARINPAL: zp, AQAYEPARDAKHT: ap } })));
  });

  async function apStore(label = "shop") {
    const s = await liveStore(label); // Zarinpal on, with a merchant id
    await prisma.platformSetting.update({ where: { key: "payment" }, data: { value: { zarinpalEnabled: true, aqayepardakhtEnabled: true, sandbox: true } } });
    expect((await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.aqayepardakht.pin`, { value: "D45DE2605E6E6F98" })).status).toBe(204);
    return s;
  }

  it("the shopper sees both gateways and pays through the chosen one: toman range checked, GET return, verified server-side", async () => {
    const s = await apStore();
    const me = shopper("shop");
    expect((await me.call("GET", "/checkout/payment-methods")).json).toMatchObject({ online: true, gateways: ["ZARINPAL", "AQAYEPARDAKHT"] });
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 2 });
    const placed = placedOrderDto.parse((await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" })).json);
    expect(placed.order).toMatchObject({ status: "AWAITING_PAYMENT", paymentMethod: "ONLINE", paymentGateway: "AQAYEPARDAKHT", total: 230_000 });
    const start = await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    expect(start.json.url).toBe("https://panel.aqayepardakht.ir/startpay/sandbox/AP0000000001");
    expect(zp.requests).toHaveLength(0);
    expect(ap.requests[0]).toMatchObject({ sandbox: true, merchantId: "D45DE2605E6E6F98", amountRial: 2_300_000, callbackUrl: "http://shop.localhost:3000/checkout/payment/return/aqayepardakht", orderRef: "1" });
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ provider: "AQAYEPARDAKHT", authority: "AP0000000001", amountRial: 2_300_000n });

    // status 0 changes nothing; the wrong gateway for this transid is not found; status 1 verifies
    expect((await me.call("POST", "/checkout/payments/verify", { gateway: "AQAYEPARDAKHT", authority: "AP0000000001", status: "0" })).json.outcome).toBe("failed");
    expect(ap.verifies).toHaveLength(0);
    expect((await me.call("POST", "/checkout/payments/verify", { gateway: "ZARINPAL", authority: "AP0000000001", status: "OK" })).status).toBe(400);
    const back = await me.call("POST", "/checkout/payments/verify", { gateway: "AQAYEPARDAKHT", authority: "AP0000000001", status: "1" });
    expect(back.json).toEqual({ outcome: "paid", accessToken: placed.accessToken });
    expect(ap.verifies).toEqual([{ sandbox: true, merchantId: "D45DE2605E6E6F98", amountRial: 2_300_000, authority: "AP0000000001" }]);
    const view = (await me.call("GET", `/checkout/orders/${placed.accessToken}`)).json;
    expect([view.order.status, view.order.payment.refId]).toEqual(["PLACED", "AP0000000001"]);
  });

  it("a gateway is offered only when the platform has it on and the store has a valid credential; amounts outside its range are refused", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    expect((await me.call("GET", "/checkout/payment-methods")).json.gateways).toEqual(["ZARINPAL"]); // Aghaye Pardakht off
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const off = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" });
    expect([off.status, off.json.errorName]).toEqual([422, "PaymentUnavailableError"]);
    await prisma.platformSetting.update({ where: { key: "payment" }, data: { value: { zarinpalEnabled: true, aqayepardakhtEnabled: true, sandbox: true } } });
    await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.aqayepardakht.pin`, { value: "bad pin!" });
    expect((await me.call("GET", "/checkout/payment-methods")).json.gateways).toEqual(["ZARINPAL"]);
    // a valid pin turns it on
    await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.aqayepardakht.pin`, { value: "D45DE2605E6E6F98" });
    expect((await me.call("GET", "/checkout/payment-methods")).json.gateways).toEqual(["ZARINPAL", "AQAYEPARDAKHT"]);
    const cod = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD", gateway: "ZARINPAL" });
    expect(cod.status).toBe(400); // a gateway only with ONLINE
  });

  it("the reconciler verifies Aghaye Pardakht attempts directly (it has no inquiry); 'not paid' leaves them open, with back-off", async () => {
    const s = await apStore();
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" })).json;
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    ap.verifyResult = () => ({ outcome: "pending", code: 0 });
    const svc = app!.get(PaymentsService);
    expect(await svc.reconcile()).toMatchObject({ paid: 0, unclear: 1 });
    expect(await prisma.payment.findFirstOrThrow()).toMatchObject({ status: "CREATED", verifySentAt: null, checks: 1 });
    ap.verifyResult = () => ({ outcome: "paid", code: 2, refId: "AP0000000001", cardPan: null, fee: null }); // verified before
    await prisma.payment.updateMany({ data: { nextCheckAt: new Date(0) } });
    expect((await svc.reconcile()).paid).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("PLACED");
  });

  it("review D35c-1: Aghaye Pardakht attempts are never closed unverified: two paid sessions -> one PAID, one REFUND_REQUIRED", async () => {
    const s = await apStore();
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" })).json;
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`); // a second tab
    expect(ap.requests.map((r) => r.attemptRef)).toHaveLength(2);
    expect(new Set(ap.requests.map((r) => r.attemptRef)).size).toBe(2); // unique invoice per attempt
    ap.verifyResult = () => ({ outcome: "paid", code: 1, refId: "x", cardPan: null, fee: null });
    expect((await me.call("POST", "/checkout/payments/verify", { gateway: "AQAYEPARDAKHT", authority: "AP0000000001", status: "1" })).json.outcome).toBe("paid");
    expect((await prisma.payment.findUniqueOrThrow({ where: { authority: "AP0000000002" } })).status).toBe("CREATED"); // not silently expired
    // the second one was paid too: verified, recorded for the merchant to refund
    expect((await me.call("POST", "/checkout/payments/verify", { gateway: "AQAYEPARDAKHT", authority: "AP0000000002", status: "1" })).json.outcome).toBe("refund");
    expect((await prisma.payment.findUniqueOrThrow({ where: { authority: "AP0000000002" } })).status).toBe("REFUND_REQUIRED");
  });

  it("review D35c-1: an expired order's Aghaye Pardakht attempt stays open and is still verified by the reconciler", async () => {
    const s = await apStore();
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" })).json;
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    await prisma.order.update({ where: { id: placed.order.id }, data: { paymentDeadline: new Date(Date.now() - 3600_000) } });
    await prisma.payment.updateMany({ data: { createdAt: new Date(Date.now() - 3600_000) } });
    ap.verifyResult = () => ({ outcome: "pending", code: 0 });
    const svc = app!.get(PaymentsService);
    expect((await svc.reconcile()).expiredOrders).toBe(1);
    expect((await prisma.payment.findFirstOrThrow()).status).toBe("CREATED");
    ap.verifyResult = () => ({ outcome: "paid", code: 1, refId: "x", cardPan: null, fee: null }); // the buyer paid late
    await prisma.payment.updateMany({ data: { nextCheckAt: new Date(0) } });
    expect((await svc.reconcile()).paid).toBe(1);
    expect((await prisma.payment.findFirstOrThrow()).status).toBe("REFUND_REQUIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("EXPIRED");
  });

  it("review D35c-1: a sandbox session never places an order once the platform has left sandbox mode", async () => {
    const s = await apStore();
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "ONLINE", gateway: "AQAYEPARDAKHT" })).json;
    await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    await prisma.platformSetting.update({ where: { key: "payment" }, data: { value: { zarinpalEnabled: true, aqayepardakhtEnabled: true, sandbox: false } } });
    expect((await me.call("POST", "/checkout/payments/verify", { gateway: "AQAYEPARDAKHT", authority: "AP0000000001", status: "1" })).json.outcome).toBe("failed");
    expect(ap.verifies).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).status).toBe("AWAITING_PAYMENT");
  });
});

describe("ADR 0003 (D1): online payment when the merchant unpublishes", () => {
  it("a payment started before unpublishing is verified on return; the order can still be paid from its link", async () => {
    const { s, me, placed } = await onlineOrder();
    const t = placed.accessToken;
    expect((await me.call("POST", `/checkout/orders/${t}/pay`)).status).toBe(200);
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/unpublish`)).status).toBe(204);
    const back = await me.call("POST", "/checkout/payments/verify", { authority: `S${"1".padStart(35, "0")}`, status: "OK" });
    expect(paymentReturnDto.parse(back.json)).toEqual({ outcome: "paid", accessToken: t });
    const view = shopperOrderDto.parse((await me.call("GET", `/checkout/orders/${t}`)).json);
    expect([view.order.status, view.storeOpen]).toEqual(["PLACED", false]);
  });

  it("an unpaid order on an unpublished store: pay works from the link; payment-methods (new business) is 404", async () => {
    const { s, me, placed } = await onlineOrder();
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/unpublish`)).status).toBe(204);
    const view = shopperOrderDto.parse((await me.call("GET", `/checkout/orders/${placed.accessToken}`)).json);
    expect([view.canPay, view.storeOpen]).toEqual([true, false]);
    expect((await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`)).status).toBe(200);
    expect((await me.call("GET", "/checkout/payment-methods")).status).toBe(404);
  });
});
