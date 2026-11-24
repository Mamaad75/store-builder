import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import sharp from "sharp";
import { placedOrderDto, shopperOrderDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import { PaymentsService } from "./application/payments.service.js";

/** D35b-1 on real PostgreSQL, over HTTP: bank cards, card-to-card orders, receipts (private images), merchant review, expiry. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const MELLI = "6037991234567893";
const MELLAT = "6104339876543210";

let app: NestExpressApplication | undefined;
let base = "";
let png: Buffer;
let gatewayCalls = 0;

beforeEach(async () => {
  await resetDb();
  gatewayCalls = 0;
  const gateway = {
    startUrl: (_s: boolean, a: string) => `https://sandbox.zarinpal.com/pg/StartPay/${a}`,
    request: async () => ({ ok: true as const, authority: `S${String(++gatewayCalls).padStart(35, "0")}` }),
    verify: async () => ({ outcome: "unknown" as const }),
    inquiry: async () => ({ status: "unknown" as const }),
  };
  ({ app, base } = await listenFetchable(() => createApp(config, { paymentGateway: gateway })));
  png ??= await sharp({ create: { width: 300, height: 500, channels: 3, background: { r: 240, g: 240, b: 240 } } }).withMetadata({ exif: { IFD0: { Copyright: "secret-gps" } } }).png().toBuffer();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

let keyN = 0;
const requestKey = () => `ct-${Date.now()}-${++keyN}`.padEnd(20, "x");
const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };

async function liveStore(label: string, o: { cards?: boolean } = {}) {
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
  if (o.cards !== false) {
    const r = await merchantCall(merchant, "PUT", `/stores/${store.id}/bank-cards`, { cards: [{ cardNumber: "۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۳", holderName: "علی رضایی" }] });
    expect(r.status).toBe(200);
  }
  return { storeId: store.id, tea: tea.id, method: method.id, merchant };
}

function shopper(label: string) {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown, raw?: Buffer, extra: Record<string, string> = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(`${base}/api/public/stores/${label}${path}`, {
      method,
      headers: {
        origin: `http://${label}.localhost:3000`,
        ...(cookie ? { cookie } : {}),
        ...(raw ? { "content-type": "application/octet-stream" } : body !== undefined ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body),
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
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, headers: r.headers, json: (type.includes("json") ? await r.json() : null) as any, bytes: type.startsWith("image/") ? Buffer.from(await r.arrayBuffer()) : null };
}

async function transferOrder(label = "shop") {
  const s = await liveStore(label);
  const me = shopper(label);
  await me.call("POST", "/cart/items", { productId: s.tea, quantity: 2 });
  const placed = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "CARD_TRANSFER" });
  expect(placed.status).toBe(201);
  return { s, me, placed: placedOrderDto.parse(placed.json) };
}

const stock = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stockQuantity;
const send = (me: ReturnType<typeof shopper>, token: string, q = "trackingCode=123456789&payerCardLast4=5995", img: Buffer = png) => {
  const f = new URLSearchParams(q);
  return me.call("POST", `/checkout/orders/${token}/receipt`, undefined, img, {
    "x-receipt-tracking-code": encodeURIComponent(f.get("trackingCode") ?? ""),
    "x-receipt-payer-last4": encodeURIComponent(f.get("payerCardLast4") ?? ""),
  });
};

describe("card-to-card (D35b-1)", () => {
  it("bank cards: validated (Luhn, at most 5, no duplicates), bank name from the number, store.view to read; offered only with cards", async () => {
    const s = await liveStore("shop", { cards: false });
    const me = shopper("shop");
    expect((await me.call("GET", "/checkout/payment-methods")).json).toEqual({ cod: true, online: false, cardTransfer: false });
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const refused = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "CARD_TRANSFER" });
    expect([refused.status, refused.json.errorName]).toEqual([422, "PaymentUnavailableError"]);

    const bad = await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/bank-cards`, { cards: [{ cardNumber: "6037991234567890", holderName: "علی" }] });
    expect(bad.status).toBe(400);
    const ok = await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/bank-cards`, { cards: [{ cardNumber: MELLI, holderName: "علی رضایی" }, { cardNumber: MELLAT, holderName: "سارا", bankName: "ملت" }] });
    expect(ok.json).toEqual([{ cardNumber: MELLI, holderName: "علی رضایی", bankName: "بانک ملی ایران" }, { cardNumber: MELLAT, holderName: "سارا", bankName: "ملت" }]);
    expect((await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/bank-cards`)).json).toHaveLength(2);
    expect((await me.call("GET", "/checkout/payment-methods")).json.cardTransfer).toBe(true);
    expect(await prisma.auditEvent.count({ where: { storeId: s.storeId, action: "store.bank_cards_replaced" } })).toBe(1); // the refused one wrote nothing
  });

  it("a card-to-card order waits 24 h with its stock held; the shopper sees the cards and the amount, no COD fee", async () => {
    const { s, placed } = await transferOrder();
    expect(placed.order).toMatchObject({ status: "AWAITING_PAYMENT", paymentMethod: "CARD_TRANSFER", codFee: 0, total: 230_000 });
    const left = new Date(placed.order.paymentDeadline!).getTime() - Date.now();
    expect(left).toBeGreaterThan(23.9 * 3600_000);
    expect(left).toBeLessThanOrEqual(24 * 3600_000);
    expect(placed.canPay).toBe(false); // no online pay button
    expect(placed.transfer).toEqual({ cards: [{ cardNumber: MELLI, holderName: "علی رضایی", bankName: "بانک ملی ایران" }], receipts: [], canSubmit: true });
    expect(await stock(s.tea)).toBe(3);
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed" } })).toBe(0);
  });

  it("receipt -> merchant approves -> PLACED with 'order.placed'; the image is private, re-encoded and served only to the store", async () => {
    const { s, me, placed } = await transferOrder();
    const t = placed.accessToken;
    expect((await send(me, t, "trackingCode=۷۷۸۸۹۹۰۰۱&payerCardLast4=۵۹۹۵")).status).toBe(204);
    const view = shopperOrderDto.parse((await me.call("GET", `/checkout/orders/${t}`)).json);
    expect(view.transfer!.receipts).toMatchObject([{ status: "SUBMITTED", payerCardLast4: "5995", reviewNote: "" }]);
    expect(view.transfer!.canSubmit).toBe(false);
    expect(view.canCancel).toBe(false); // under review
    expect(JSON.stringify(view)).not.toContain("778899001"); // the tracking number is not echoed to whoever holds the link

    const list = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders/${placed.order.id}/receipts`);
    expect(list.json).toMatchObject([{ status: "SUBMITTED", trackingCode: "778899001", payerCardLast4: "5995" }]);
    const rid = list.json[0].id as string;
    const img = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/image`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("cache-control")).toBe("private, no-store");
    const meta = await sharp(img.bytes!).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(["webp", 300, 500, undefined]);
    // nobody else: another merchant, or no session
    const other = await liveStore("other");
    expect((await merchantCall(other.merchant, "GET", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/image`)).status).toBe(404); // not their store (no enumeration)
    expect((await merchantCall(other.merchant, "GET", `/stores/${other.storeId}/orders/${placed.order.id}/receipts/${rid}/image`)).status).toBe(404);
    expect((await fetch(`${base}/api/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/image`)).status).toBe(401);

    const ok = await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/review`, { decision: "approve" });
    expect(ok.status).toBe(200);
    expect(ok.json.result).toBe("approved");
    expect(ok.json.order.status).toBe("PLACED");
    expect(ok.json.order.history.at(-1)).toMatchObject({ from: "AWAITING_PAYMENT", to: "PLACED", actor: "MERCHANT", note: "رسید کارت به کارت تأیید شد" });
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed" } })).toBe(1);
    // decided once
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/review`, { decision: "approve" })).status).toBe(409);
    // a paid card-to-card order is not cancelled by the shopper
    expect((await me.call("POST", `/checkout/orders/${t}/cancel`)).status).toBe(409);
    const after = (await me.call("GET", `/checkout/orders/${t}`)).json;
    expect([after.order.status, after.transfer.cards, after.transfer.canSubmit]).toEqual(["PLACED", [], false]);
  });

  it("reject with a reason -> the shopper sees it and may send a corrected receipt; the deadline is extended if needed", async () => {
    const { s, me, placed } = await transferOrder();
    const t = placed.accessToken;
    await send(me, t);
    expect((await send(me, t)).json.errorName).toBe("ReceiptNotAllowedError"); // one under review at a time
    const rid = (await prisma.transferReceipt.findFirstOrThrow()).id;
    await prisma.order.update({ where: { id: placed.order.id }, data: { paymentDeadline: new Date(Date.now() - 3600_000) } });
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/review`, { decision: "reject" })).status).toBe(400); // reason required
    const r = await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/review`, { decision: "reject", reason: "مبلغ واریزی کمتر از مبلغ سفارش است" });
    expect([r.json.result, r.json.order.status]).toEqual(["rejected", "AWAITING_PAYMENT"]);
    expect(new Date(r.json.order.paymentDeadline).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const view = (await me.call("GET", `/checkout/orders/${t}`)).json;
    expect(view.transfer.receipts[0]).toMatchObject({ status: "REJECTED", reviewNote: "مبلغ واریزی کمتر از مبلغ سفارش است" });
    expect(view.transfer.canSubmit).toBe(true);
    expect((await send(me, t, "trackingCode=987654321&payerCardLast4=1234")).status).toBe(204);
  });

  it("receipts are validated: fields, a real still image, the order's method and window, at most 5 per order", async () => {
    const { s, me, placed } = await transferOrder();
    const t = placed.accessToken;
    expect((await send(me, t, "trackingCode=12&payerCardLast4=5995")).status).toBe(400);
    expect((await send(me, t, "trackingCode=123456&payerCardLast4=59")).status).toBe(400);
    expect((await send(me, t, undefined, Buffer.from("<svg onload=alert(1)>"))).status).toBe(422); // not an image (media rules)
    expect((await send(me, t, undefined, Buffer.alloc(0))).status).toBe(400);
    expect(await prisma.transferReceipt.count()).toBe(0);
    for (let i = 0; i < 5; i++) {
      expect((await send(me, t)).status).toBe(204);
      await prisma.transferReceipt.updateMany({ where: { status: "SUBMITTED" }, data: { status: "REJECTED", reviewNote: "نادرست", reviewedAt: new Date() } });
    }
    const sixth = await send(me, t);
    expect([sixth.status, sixth.json.errorName]).toEqual([409, "ReceiptNotAllowedError"]);
    // other orders: a COD order takes no receipt; an unknown token is 404
    const cod = shopper("shop");
    await cod.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const c = await cod.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" });
    expect((await send(cod, c.json.accessToken)).status).toBe(409);
    expect((await send(me, "x".repeat(43))).status).toBe(404);
  });

  it("expiry: an order without a receipt expires (stock back); one whose receipt waits for the merchant does not", async () => {
    const a = await transferOrder("shop");
    const b = shopper("shop");
    await b.call("POST", "/cart/items", { productId: a.s.tea, quantity: 1 });
    const pb = (await b.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: a.s.method, paymentMethod: "CARD_TRANSFER" })).json;
    await send(b, pb.accessToken);
    await prisma.order.updateMany({ data: { paymentDeadline: new Date(Date.now() - 3600_000) } });
    expect((await app!.get(PaymentsService).reconcile()).expiredOrders).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.placed.order.id } })).status).toBe("EXPIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pb.order.id } })).status).toBe("AWAITING_PAYMENT");
    expect(await stock(a.s.tea)).toBe(4);
    // while a receipt waits, the shopper cannot cancel; the merchant's cancel rejects the receipt in the same transaction (review D35b-1)
    expect((await b.call("POST", `/checkout/orders/${pb.accessToken}/cancel`)).status).toBe(409);
    const c = await merchantCall(a.s.merchant, "POST", `/stores/${a.s.storeId}/orders/${pb.order.id}/status`, { to: "CANCELLED", note: "" });
    expect([c.status, c.json.status]).toEqual([200, "CANCELLED"]);
    expect(await prisma.transferReceipt.findFirstOrThrow({ where: { orderId: pb.order.id } })).toMatchObject({ status: "REJECTED", reviewNote: "سفارش توسط فروشگاه لغو شد" });
    expect(await stock(a.s.tea)).toBe(5);
  });

  it("review D35b-1: a card-to-card order can never be paid through the gateway, even with online payment on", async () => {
    const { s, me, placed } = await transferOrder();
    await prisma.platformSetting.upsert({ where: { key: "payment" }, create: { key: "payment", value: { zarinpalEnabled: true, sandbox: true } }, update: { value: { zarinpalEnabled: true, sandbox: true } } });
    expect((await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/secrets/payment.zarinpal.merchant_id`, { value: "1344b5d4-0048-11e8-94db-005056a205be" })).status).toBe(204);
    const r = await me.call("POST", `/checkout/orders/${placed.accessToken}/pay`);
    expect([r.status, r.json.errorName]).toEqual([409, "PaymentNotAllowedError"]);
    expect(gatewayCalls).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("review D35b-1: no deadline extension once no further receipt can be sent; a closed order costs no image processing", async () => {
    const { s, me, placed } = await transferOrder();
    const t = placed.accessToken;
    for (let i = 0; i < 4; i++) {
      await send(me, t);
      await prisma.transferReceipt.updateMany({ where: { status: "SUBMITTED" }, data: { status: "REJECTED", reviewNote: "نادرست", reviewedAt: new Date() } });
    }
    await send(me, t); // the fifth
    const deadline = new Date(Date.now() + 3600_000);
    await prisma.order.update({ where: { id: placed.order.id }, data: { paymentDeadline: deadline } });
    const rid = (await prisma.transferReceipt.findFirstOrThrow({ where: { status: "SUBMITTED" } })).id;
    const r = await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/receipts/${rid}/review`, { decision: "reject", reason: "مبلغ کم است" });
    expect(new Date(r.json.order.paymentDeadline).getTime()).toBe(deadline.getTime());
    // refused before decoding: a non-image body on a full order answers 409 (state), not 422 (image)
    expect((await send(me, t, undefined, Buffer.from("not an image"))).status).toBe(409);
  });
});
