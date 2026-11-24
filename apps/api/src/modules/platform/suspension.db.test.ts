import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import sharp from "sharp";
import { merchantSuspensionDto, placedOrderDto, shopperOrderDto, storeSuspensionDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import type { VerifyResult } from "../orders/application/ports.js";

/**
 * ADR 0003 (G2) on real PostgreSQL, over HTTP: platform suspension of ONE store, independent of the merchant's publishing status; its effect
 * on the storefront, new business, existing orders (links, online payment return, card-to-card) and the dashboard (403 STORE_SUSPENDED);
 * audit history; authorization and tenant isolation.
 */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const MERCHANT_ID = "1344b5d4-0048-11e8-94db-005056a205be";
const SECRET_NOTE = "internal-note-7f3a: reported by provider ticket 991";

let app: NestExpressApplication | undefined;
let base = "";
let png: Buffer;
let n = 0;
const verify: () => VerifyResult = () => ({ outcome: "paid", code: 100, refId: "777", cardPan: "502229******5995", fee: 0 });

beforeEach(async () => {
  await resetDb();
  n = 0;
  const gateway = {
    startUrl: (_s: boolean, a: string) => `https://sandbox.zarinpal.com/pg/StartPay/${a}`,
    request: async () => ({ ok: true as const, authority: `S${String(++n).padStart(35, "0")}` }),
    verify: async () => verify(),
    inquiry: async () => ({ status: "unknown" as const }),
  };
  ({ app, base } = await listenFetchable(() => createApp(config, { paymentGateway: gateway })));
  png ??= await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

let keyN = 0;
const requestKey = () => `sus-${Date.now()}-${++keyN}`.padEnd(20, "x");
const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };

async function sessionOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
}

/** A live store with a product, a shipping method, a bank card (card-to-card) and Zarinpal (online payment). */
async function liveStore(label: string, ownerId?: string) {
  const owner = ownerId ? { id: ownerId } : await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 20, status: "ACTIVE" } });
  const products: StorefrontProduct[] = [{ ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 20, categoryId: null }];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const method = await prisma.shippingMethod.create({ data: { storeId: store.id, name: "پیک", kind: "FLAT", price: 30_000, codEnabled: true, codFee: 0 } });
  const merchant = await sessionOf(owner.id);
  await prisma.platformSetting.upsert({ where: { key: "payment" }, create: { key: "payment", value: { zarinpalEnabled: true, sandbox: true } }, update: {} });
  expect((await call(merchant, "PUT", `/stores/${store.id}/secrets/payment.zarinpal.merchant_id`, { value: MERCHANT_ID })).status).toBe(204);
  expect((await call(merchant, "PUT", `/stores/${store.id}/bank-cards`, { cards: [{ cardNumber: "6037991234567893", holderName: "علی رضایی" }] })).status).toBe(200);
  return { storeId: store.id, ownerId: owner.id, tea: tea.id, method: method.id, merchant, label };
}

async function superAdmin() {
  const u = await makeUser();
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await sessionOf(u.id) };
}

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, text: t, json: (t ? JSON.parse(t) : null) as any };
}

function shopper(label: string) {
  const jar = new Map<string, string>();
  return async (method: string, path: string, body?: unknown, raw?: Buffer, headers: Record<string, string> = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(`${base}/api/public/stores/${label}${path}`, {
      method,
      headers: { origin: `http://${label}.localhost:3000`, ...(cookie ? { cookie } : {}), ...(raw ? { "content-type": "application/octet-stream" } : body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    const t = await r.text();
    return { status: r.status, text: t, json: (t ? JSON.parse(t) : null) as any };
  };
}

async function order(s: { tea: string; method: string; label: string }, paymentMethod: "COD" | "ONLINE" | "CARD_TRANSFER") {
  const me = shopper(s.label);
  await me("POST", "/cart/items", { productId: s.tea, quantity: 1 });
  const r = await me("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod, ...(paymentMethod === "ONLINE" ? { gateway: "ZARINPAL" } : {}) });
  expect(r.status).toBe(201);
  return { me, placed: placedOrderDto.parse(r.json) };
}

const suspend = (admin: { cookie: string }, storeId: string, internalNote = SECRET_NOTE) =>
  call(admin.cookie, "POST", `/platform/stores/${storeId}/suspend`, { reason: "FRAUD", publicMessage: "فروشگاه شما به دلیل گزارش تخلف معلق شد.", internalNote });
const restore = (admin: { cookie: string }, storeId: string) => call(admin.cookie, "POST", `/platform/stores/${storeId}/restore`, { note: "بررسی شد" });
const storefront = (label: string) => fetch(`${base}/api/public/stores/${label}`).then((r) => r.status);
const receipt = (me: ReturnType<typeof shopper>, token: string) =>
  me("POST", `/checkout/orders/${token}/receipt`, undefined, png, { "x-receipt-tracking-code": "123456789", "x-receipt-payer-last4": "5995" });

describe("platform suspension (ADR 0003, G2)", () => {
  it("storefront and new business are closed; existing orders stay reachable; payments started before are verified; card numbers hidden", async () => {
    const s = await liveStore("shop");
    const admin = await superAdmin();
    const cod = await order(s, "COD");
    const online = await order(s, "ONLINE");
    const card = await order(s, "CARD_TRANSFER");
    const unpaid = await order(s, "ONLINE");
    expect((await online.me("POST", `/checkout/orders/${online.placed.accessToken}/pay`)).status).toBe(200); // a payment session opened before

    expect((await suspend(admin, s.storeId)).status).toBe(204);

    // storefront and new business: the same neutral 404 as any offline store
    expect(await storefront("shop")).toBe(404);
    const fresh = shopper("shop");
    expect((await fresh("POST", "/cart/items", { productId: s.tea, quantity: 1 })).status).toBe(404);
    expect((await fresh("GET", "/checkout/payment-methods")).status).toBe(404);
    expect((await fresh("POST", "/customer/register", { phone: "09125550000", name: "سارا", password: "a-good-password" })).status).toBe(404);

    // existing orders: readable, cancellable; nothing discloses why
    const v = await cod.me("GET", `/checkout/orders/${cod.placed.accessToken}`);
    expect(v.status).toBe(200);
    expect(shopperOrderDto.parse(v.json).storeOpen).toBe(false);
    expect(v.text).not.toMatch(/FRAUD|internal-note|معلق/);
    expect((await cod.me("POST", `/checkout/orders/${cod.placed.accessToken}/cancel`)).json.order.status).toBe("CANCELLED");

    // the online payment started before the suspension is verified on return (money may have moved)
    const back = await online.me("POST", "/checkout/payments/verify", { authority: `S${"1".padStart(35, "0")}`, status: "OK" });
    expect(back.json.outcome).toBe("paid");
    // but no NEW payment session, and card-to-card details are hidden and receipts refused
    const u = shopperOrderDto.parse((await unpaid.me("GET", `/checkout/orders/${unpaid.placed.accessToken}`)).json);
    expect(u.canPay).toBe(false);
    const payAgain = await unpaid.me("POST", `/checkout/orders/${unpaid.placed.accessToken}/pay`);
    expect([payAgain.status, payAgain.json.errorName, payAgain.json.payload.reason]).toEqual([422, "PaymentUnavailableError", "store"]);
    const c = shopperOrderDto.parse((await card.me("GET", `/checkout/orders/${card.placed.accessToken}`)).json);
    expect([c.transfer?.cards, c.transfer?.canSubmit]).toEqual([[], false]);
    expect(JSON.stringify(c)).not.toContain("6037991234567893");
    expect((await receipt(card.me, card.placed.accessToken)).status).toBe(422);
    expect(await prisma.transferReceipt.count()).toBe(0);
  });

  it("the dashboard: reads and order management allowed; every other write is 403 STORE_SUSPENDED; the public message only", async () => {
    const s = await liveStore("shop");
    const admin = await superAdmin();
    const card = await order(s, "CARD_TRANSFER");
    expect((await receipt(card.me, card.placed.accessToken)).status).toBe(204); // sent before the suspension
    const cod = await order(s, "COD");
    expect((await suspend(admin, s.storeId)).status).toBe(204);

    const refused: [string, string, unknown?][] = [
      ["POST", `/stores/${s.storeId}/publish`, {}],
      ["POST", `/stores/${s.storeId}/unpublish`],
      ["PATCH", `/stores/${s.storeId}`, { name: "x" }],
      ["POST", `/stores/${s.storeId}/delete`, { confirmName: "فروشگاه shop" }],
      ["PUT", `/stores/${s.storeId}/bank-cards`, { cards: [{ cardNumber: "6037991234567893", holderName: "دیگری" }] }],
      ["PUT", `/stores/${s.storeId}/secrets/payment.zarinpal.merchant_id`, { value: MERCHANT_ID }],
      ["POST", `/stores/${s.storeId}/discounts`, { code: "X100", type: "FIXED", value: 1000 }],
      ["POST", `/stores/${s.storeId}/categories`, { name: "دسته" }],
    ];
    for (const [m, p, b] of refused) {
      const r = await call(s.merchant, m, p, b);
      expect([r.status, r.json?.errorName, r.json?.payload?.code], `${m} ${p}`).toEqual([403, "StoreSuspendedError", "STORE_SUSPENDED"]);
      expect(r.text).not.toContain("internal-note");
    }
    expect((await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).status).toBe("PUBLISHED"); // unpublish was refused: untouched

    // reads and managing existing orders
    expect((await call(s.merchant, "GET", `/stores/${s.storeId}/orders`)).status).toBe(200);
    expect((await call(s.merchant, "GET", `/stores/${s.storeId}/discounts`)).status).toBe(200);
    expect((await call(s.merchant, "POST", `/stores/${s.storeId}/orders/${cod.placed.order.id}/status`, { to: "CONFIRMED", note: "" })).status).toBe(200);
    const rid = (await call(s.merchant, "GET", `/stores/${s.storeId}/orders/${card.placed.order.id}/receipts`)).json[0].id;
    expect((await call(s.merchant, "POST", `/stores/${s.storeId}/orders/${card.placed.order.id}/receipts/${rid}/review`, { decision: "approve" })).status).toBe(200);

    // the merchant sees the public message, never the reason details or the internal note
    const mine = await call(s.merchant, "GET", `/stores/${s.storeId}/suspension`);
    expect(merchantSuspensionDto.parse(mine.json)).toMatchObject({ suspended: true, publicMessage: "فروشگاه شما به دلیل گزارش تخلف معلق شد." });
    expect(mine.text).not.toContain("internal-note");
    const audit = await call(s.merchant, "GET", `/stores/${s.storeId}/audit`);
    expect(audit.status).toBe(200);
    expect(audit.text).toContain("store.suspended");
    expect(audit.text).not.toContain("internal-note");
  });

  it("the three conditions never overwrite one another (publishing, suspension; restore publishes nothing)", async () => {
    const s = await liveStore("shop");
    const admin = await superAdmin();
    // a store the merchant unpublished, then suspended: restoring keeps it unpublished (and offline)
    expect((await call(s.merchant, "POST", `/stores/${s.storeId}/unpublish`)).status).toBe(204);
    expect((await suspend(admin, s.storeId)).status).toBe(204);
    expect((await prisma.storeSuspension.findFirstOrThrow()).merchantStatusAtStart).toBe("UNPUBLISHED");
    expect((await call(s.merchant, "POST", `/stores/${s.storeId}/publish`, {})).status).toBe(403); // republish cannot bypass
    expect((await restore(admin, s.storeId)).status).toBe(204);
    expect(await storefront("shop")).toBe(404);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).status).toBe("UNPUBLISHED");

    // a published store, suspended: status stays PUBLISHED but the storefront is offline; restoring brings it back as it was
    const t = await liveStore("tea");
    expect((await suspend(admin, t.storeId)).status).toBe(204);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: t.storeId } })).status).toBe("PUBLISHED");
    expect(await storefront("tea")).toBe(404);
    expect((await restore(admin, t.storeId)).status).toBe(204);
    expect(await storefront("tea")).toBe(200);
    expect((await call(t.merchant, "PATCH", `/stores/${t.storeId}`, { name: "تازه" })).status).not.toBe(403);
  });

  it("history and audit: actor, time, reason, previous merchant status; amend; restore; conflicts; internal note stays platform-only", async () => {
    const s = await liveStore("shop");
    const admin = await superAdmin();
    expect((await restore(admin, s.storeId)).json.payload.reason).toBe("not_suspended");
    expect((await call(admin.cookie, "POST", `/platform/stores/${s.storeId}/suspend`, { reason: "FRAUD", publicMessage: "  " })).status).toBe(400);
    expect((await call(admin.cookie, "POST", `/platform/stores/${s.storeId}/suspend`, { reason: "NOPE", publicMessage: "x" })).status).toBe(400);
    expect((await suspend(admin, s.storeId)).status).toBe(204);
    const again = await suspend(admin, s.storeId);
    expect([again.status, again.json.payload.reason]).toEqual([409, "already_suspended"]);
    expect((await call(admin.cookie, "POST", `/platform/stores/${s.storeId}/suspension/amend`, { reason: "LEGAL_ORDER", publicMessage: "به دستور مرجع قانونی معلق است.", internalNote: SECRET_NOTE })).status).toBe(204);
    expect((await restore(admin, s.storeId)).status).toBe(204);
    expect((await suspend(admin, s.storeId, "second")).status).toBe(204);

    const h = await call(admin.cookie, "GET", `/platform/stores/${s.storeId}/suspensions`);
    const rows = h.json.map((r: unknown) => storeSuspensionDto.parse(r));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ reason: "LEGAL_ORDER", internalNote: SECRET_NOTE, merchantStatusAtStart: "PUBLISHED", suspendedById: admin.id, liftedById: admin.id, liftNote: "بررسی شد" });
    expect(rows[0]).toMatchObject({ liftedAt: null, internalNote: "second" });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).suspendedAt).not.toBeNull();

    const events = await prisma.auditEvent.findMany({ where: { targetId: s.storeId, action: { contains: "suspen" } }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.storeId === null ? "platform" : "store", e.action, e.actorId])).toEqual([
      ["platform", "platform.store_suspended", admin.id], ["store", "store.suspended", admin.id],
      ["platform", "platform.store_suspension_amended", admin.id], ["store", "store.suspension_amended", admin.id],
      ["platform", "platform.store_suspended", admin.id], ["store", "store.suspended", admin.id],
    ]);
    expect(await prisma.auditEvent.count({ where: { action: { in: ["platform.store_restored", "store.restored"] } } })).toBe(2);
    expect(JSON.stringify(await prisma.auditEvent.findMany())).not.toContain("internal-note"); // notes live only in StoreSuspension
    // the database refuses a second open suspension even outside the service
    await expect(prisma.storeSuspension.create({ data: { storeId: s.storeId, reason: "OTHER", publicMessage: "x", internalNote: "", merchantStatusAtStart: "PUBLISHED" } })).rejects.toThrow();
  });

  it("authorization and tenant isolation", async () => {
    const owner = await makeUser();
    const a = await liveStore("shop", owner.id);
    const b = await liveStore("tea", owner.id); // the same owner's other store
    const stranger = await liveStore("other");
    const admin = await superAdmin();

    // only super admins: merchants, staff and anonymous callers cannot suspend, restore or read the history
    for (const cookie of [a.merchant, stranger.merchant, ""]) {
      expect((await suspend({ cookie }, a.storeId)).status).toBeOneOf([401, 403]);
      expect((await call(cookie, "GET", `/platform/stores/${a.storeId}/suspensions`)).status).toBeOneOf([401, 403]);
    }
    expect((await suspend(admin, "nosuchstore")).status).toBe(404);
    expect((await suspend(admin, a.storeId)).status).toBe(204);
    expect((await restore({ cookie: a.merchant }, a.storeId)).status).toBe(403);

    // suspending one store never touches the owner's other store
    expect(await storefront("tea")).toBe(200);
    expect((await call(owner && b.merchant, "PATCH", `/stores/${b.storeId}`, { name: "دیگر" })).status).not.toBe(403);
    expect((await call(b.merchant, "GET", `/stores/${b.storeId}/suspension`)).json.suspended).toBe(false);
    // another merchant cannot read this store's suspension (no existence leak)
    expect((await call(stranger.merchant, "GET", `/stores/${a.storeId}/suspension`)).status).toBe(404);
    // a revoked admin loses the power at once
    await prisma.platformAdmin.delete({ where: { userId: admin.id } });
    expect((await restore(admin, a.storeId)).status).toBe(403);
  });

  it("two admins suspending at once: exactly one wins; the store row and the open history row agree", async () => {
    const s = await liveStore("shop");
    const [x, y] = [await superAdmin(), await superAdmin()];
    const r = await Promise.all([suspend(x, s.storeId), suspend(y, s.storeId)]);
    expect(r.map((v) => v.status).sort()).toEqual([204, 409]);
    expect(await prisma.storeSuspension.count({ where: { storeId: s.storeId, liftedAt: null } })).toBe(1);
    const open = await prisma.storeSuspension.findFirstOrThrow({ where: { liftedAt: null } });
    expect((await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).suspendedAt?.getTime()).toBe(open.suspendedAt.getTime());
  });
});
