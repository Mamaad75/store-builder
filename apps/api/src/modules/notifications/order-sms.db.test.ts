import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import { createOrderSmsService } from "./notifications.api.js";
import type { TemplateSender } from "./application/ports.js";

/** Phase 3.6 on real PostgreSQL: order events from the outbox -> order SMS (fake sender), idempotent per event and kind, monthly cap. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
let app: NestExpressApplication | undefined;
let base = "";

beforeEach(async () => {
  await resetDb();
  ({ app, base } = await listenFetchable(() => createApp(config)));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };
let keyN = 0;
const requestKey = () => `sms-${Date.now()}-${++keyN}`.padEnd(20, "x");

async function liveStore(label: string) {
  const owner = await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 50, status: "ACTIVE" } });
  const products: StorefrontProduct[] = [{ ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 50, categoryId: null }];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const method = await prisma.shippingMethod.create({ data: { storeId: store.id, name: "پیک", kind: "FLAT", price: 30_000, codEnabled: true, codFee: 0 } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  return { storeId: store.id, tea: tea.id, method: method.id, merchant: `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}` };
}

async function placeCod(label: string, tea: string, method: string) {
  const jar: string[] = [];
  const call = async (m: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/public/stores/${label}${path}`, {
      method: m,
      headers: { origin: `http://${label}.localhost:3000`, "content-type": "application/json", ...(jar.length ? { cookie: jar.join("; ") } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) jar.push(c.split(";")[0]!);
    return r.json() as Promise<any>;
  };
  await call("POST", "/cart/items", { productId: tea, quantity: 1 });
  return call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: method, paymentMethod: "COD" });
}

async function merchantCall(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function service(sent: { phone: string; template: string; tokens: any }[]) {
  const sender: TemplateSender = { sendTemplate: async (phone, template, tokens) => void sent.push({ phone, template, tokens }) };
  return createOrderSmsService({
    authSecret: config.authSecret,
    storeOrigin: (label) => `http://${label}.localhost:3000`,
    platform: { settings: async () => ({ sms: (await prisma.platformSetting.findUnique({ where: { key: "sms" } }))?.value as { orderSms?: unknown } }), reveal: async () => null },
    sender,
  });
}
const enableSms = (cap = 500) =>
  prisma.platformSetting.upsert({
    where: { key: "sms" },
    create: { key: "sms", value: { provider: "kavenegar", customerOtpEnabled: false, otpTemplate: "", orderSms: { enabled: true, monthlyCapPerStore: cap, templates: { SHOPPER_PLACED: "placed", MERCHANT_NEW_ORDER: "merchant-new", SHOPPER_SHIPPED: "shipped" } } } },
    update: { value: { provider: "kavenegar", customerOtpEnabled: false, otpTemplate: "", orderSms: { enabled: true, monthlyCapPerStore: cap, templates: { SHOPPER_PLACED: "placed", MERCHANT_NEW_ORDER: "merchant-new", SHOPPER_SHIPPED: "shipped" } } } },
  });
const events = (type: string) => prisma.outboxEvent.findMany({ where: { type }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
const env = (e: { id: string; type: string; storeId: string | null; payload: unknown }) => ({ id: e.id, type: e.type, storeId: e.storeId, payload: e.payload });

describe("order SMS (phase 3.6)", () => {
  it("a placed order: the shopper's SMS with the real order link; the merchant's to the phone set in the dashboard; once per event", async () => {
    await enableSms();
    const s = await liveStore("shop");
    const placed = await placeCod("shop", s.tea, s.method);
    const sent: any[] = [];
    const svc = service(sent);
    const [e] = await events("order.placed");
    await svc.handle(env(e!));
    expect(sent).toEqual([{ phone: "+989123456789", template: "placed", tokens: { token: String(placed.order.number), token2: `http://shop.localhost:3000/o/${placed.accessToken}`, token10: "فروشگاه shop" } }]);
    expect(await prisma.smsMessage.findMany({ select: { kind: true, status: true, reason: true }, orderBy: { kind: "asc" } })).toEqual([
      { kind: "MERCHANT_NEW_ORDER", status: "SKIPPED", reason: "no_phone" },
      { kind: "SHOPPER_PLACED", status: "SENT", reason: null },
    ]);
    // the merchant sets a phone: the next order also reaches them; a re-delivery of the first event sends nothing
    const v = await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/sms-settings`, { enabled: true, merchantPhone: "0935 000 1122" });
    expect(v.json).toMatchObject({ enabled: true, merchantPhone: "+989350001122", platformEnabled: true, monthlyCap: 500, usedThisMonth: 1 });
    await svc.handle(env(e!));
    await placeCod("shop", s.tea, s.method);
    const [, e2] = await events("order.placed");
    await svc.handle(env(e2!));
    expect(sent.map((x) => [x.template, x.phone])).toEqual([["placed", "+989123456789"], ["placed", "+989123456789"], ["merchant-new", "+989350001122"]]);
    expect(sent[2].tokens).toMatchObject({ token2: "130000" });
    expect(await prisma.auditEvent.count({ where: { storeId: s.storeId, action: "store.sms_settings_updated" } })).toBe(1);
  });

  it("the store's switch, the monthly cap, shipped and cancel events; no phone or text is stored", async () => {
    await enableSms(2);
    const s = await liveStore("shop");
    const sent: any[] = [];
    const svc = service(sent);
    for (let i = 0; i < 2; i++) await placeCod("shop", s.tea, s.method);
    for (const e of await events("order.placed")) await svc.handle(env(e));
    expect(sent).toHaveLength(2);
    await placeCod("shop", s.tea, s.method);
    const third = (await events("order.placed"))[2]!;
    await svc.handle(env(third));
    expect(sent).toHaveLength(2);
    expect(await prisma.smsMessage.findFirst({ where: { eventId: third.id, kind: "SHOPPER_PLACED" } })).toMatchObject({ status: "SKIPPED", reason: "monthly_cap" });
    expect((await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/sms-settings`)).json).toMatchObject({ usedThisMonth: 2, monthlyCap: 2 });
    // shipped -> SMS (cap raised); the merchant turns SMS off -> skipped
    await enableSms(10);
    const order = await prisma.order.findFirstOrThrow({ orderBy: { number: "asc" } });
    for (const to of ["CONFIRMED", "SHIPPED"]) expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${order.id}/status`, { to, note: "" })).status).toBe(200);
    const changes = await events("order.status_changed");
    expect(changes.map((c) => (c.payload as any).actor)).toEqual(["MERCHANT", "MERCHANT"]);
    for (const c of changes) await svc.handle(env(c));
    expect(sent.at(-1)).toMatchObject({ template: "shipped" });
    await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/sms-settings`, { enabled: false, merchantPhone: "" });
    await placeCod("shop", s.tea, s.method);
    const last = (await events("order.placed")).at(-1)!;
    await svc.handle(env(last));
    expect(await prisma.smsMessage.findFirst({ where: { eventId: last.id, kind: "SHOPPER_PLACED" } })).toMatchObject({ status: "SKIPPED", reason: "store_off" });
    const columns = Object.keys((await prisma.smsMessage.findFirstOrThrow()) as object);
    expect(columns).not.toContain("phone");
  });

  it("only owner and manager change the settings; a bad phone is refused", async () => {
    const s = await liveStore("shop");
    expect((await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/sms-settings`, { enabled: true, merchantPhone: "021-1234" })).status).toBe(400);
    expect((await fetch(`${base}/api/stores/${s.storeId}/sms-settings`)).status).toBe(401);
    const other = await liveStore("other");
    expect((await merchantCall(other.merchant, "GET", `/stores/${s.storeId}/sms-settings`)).status).toBe(404);
  });

  it("review 3.6: one phone gets at most 6 SMS a day across all stores; the merchant's quota is separate from the shoppers'", async () => {
    await enableSms(3);
    const a = await liveStore("shop");
    const b = await liveStore("other");
    await merchantCall(a.merchant, "PUT", `/stores/${a.storeId}/sms-settings`, { enabled: true, merchantPhone: "09350001122" });
    const sent: any[] = [];
    const svc = service(sent);
    // the same shopper phone orders 4 times in each store (8 orders)
    for (let i = 0; i < 4; i++) {
      await placeCod("shop", a.tea, a.method);
      await placeCod("other", b.tea, b.method);
    }
    for (const e of await events("order.placed")) await svc.handle(env(e));
    const toShopper = sent.filter((x) => x.phone === "+989123456789");
    const toMerchant = sent.filter((x) => x.phone === "+989350001122");
    expect(toShopper.length).toBeLessThanOrEqual(6); // the daily limit per phone (and each store's shopper cap of 3)
    expect(toMerchant).toHaveLength(3); // the merchant's own cap, untouched by the shoppers' messages
    expect(await prisma.smsMessage.count({ where: { reason: { in: ["phone_daily_limit", "monthly_cap"] } } })).toBeGreaterThan(0);
    const rows = await prisma.smsMessage.findMany({ select: { recipientHash: true } });
    expect(rows.every((r) => r.recipientHash === null || /^[0-9a-f]{64}$/.test(r.recipientHash))).toBe(true); // a hash, never the number
  });
});
