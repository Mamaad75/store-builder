import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { orderDto, orderListDto, placedOrderDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { customerTokens } from "../customers/infrastructure/crypto.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** Phase 3.4 on real PostgreSQL, over HTTP: placing (atomic with stock and cart), numbering, idempotency, following, cancelling, managing. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const customerSessions = customerTokens(config.authSecret);
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

let keyN = 0;
const requestKey = () => `req-${Date.now()}-${++keyN}`.padEnd(20, "x");
const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };

/** A live store with two products (tea: no variants, stock 5; shirt: variant M, stock 2) and one shipping method with cash on delivery. */
async function liveStore(label: string) {
  const owner = await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 5, status: "ACTIVE", weightGrams: 500 } });
  const shirt = await prisma.product.create({ data: { storeId: store.id, name: "پیراهن", slug: `shirt-${label}`, searchKey: "پیراهن", price: 1, stockQuantity: 2, status: "ACTIVE" } });
  const m = await prisma.productVariant.create({ data: { storeId: store.id, productId: shirt.id, options: [{ name: "سایز", value: "M" }], optionsKey: '[["سایز","M"]]', price: 1, stockQuantity: 2 } });
  const products: StorefrontProduct[] = [
    { ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 5, weightGrams: 500, categoryId: null },
    { ...PRODUCT_A, id: shirt.id, slug: shirt.slug, name: "پیراهن", price: 250_000, stockQuantity: 2, categoryId: null, variants: [{ id: m.id, options: [{ name: "سایز", value: "M" }], price: 250_000, stockQuantity: 2 }] },
  ];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const method = await prisma.shippingMethod.create({ data: { storeId: store.id, name: "پیک", kind: "FLAT", price: 30_000, codEnabled: true, codFee: 10_000 } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const merchant = `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
  return { storeId: store.id, tea: tea.id, shirt: shirt.id, variant: m.id, method: method.id, merchant };
}

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
  return { call, jar };
}

async function merchantCall(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const stockOf = async (s: { tea: string; shirt: string; variant: string }) => ({
  tea: (await prisma.product.findUniqueOrThrow({ where: { id: s.tea } })).stockQuantity,
  shirt: (await prisma.product.findUniqueOrThrow({ where: { id: s.shirt } })).stockQuantity,
  variant: (await prisma.productVariant.findUniqueOrThrow({ where: { id: s.variant } })).stockQuantity,
});

describe("placing an order (phase 3.4)", () => {
  it("one transaction: the order snapshot, stock out, cart emptied, the event recorded; a retry returns the same order", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 2 });
    await me.call("POST", "/cart/items", { productId: s.shirt, variantId: s.variant, quantity: 1 });
    const body = { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD", note: "زنگ نزنید" };
    const placed = await me.call("POST", "/checkout/orders", body);
    expect(placed.status).toBe(201);
    placedOrderDto.parse(placed.json);
    expect(placed.json.order).toMatchObject({ number: 1, status: "PLACED", subtotal: 450_000, shipping: { name: "پیک", cost: 30_000 }, codFee: 10_000, total: 490_000, itemCount: 3, note: "زنگ نزنید" });
    expect(placed.json.order.address).toMatchObject({ phone: "+989123456789", province: "tehran" });
    expect(placed.json.order.items.map((i: any) => [i.name, i.variantLabel, i.unitPrice, i.quantity])).toEqual([["چای", "", 100_000, 2], ["پیراهن", "سایز: M", 250_000, 1]]);

    expect(await stockOf(s)).toEqual({ tea: 3, shirt: 1, variant: 1 });
    expect((await me.call("GET", "/cart")).json.lines).toEqual([]);
    expect(await prisma.stockReservation.count({ where: { ref: placed.json.order.id, status: "CONSUMED" } })).toBe(2);
    expect(await prisma.outboxEvent.count({ where: { type: "order.placed", storeId: s.storeId } })).toBe(1);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: placed.json.order.id } });
    expect(stored.accessTokenHash).not.toBe(placed.json.accessToken);

    const again = await me.call("POST", "/checkout/orders", body);
    expect(again.status).toBe(201);
    expect([again.json.order.id, again.json.accessToken]).toEqual([placed.json.order.id, placed.json.accessToken]);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(s)).toEqual({ tea: 3, shirt: 1, variant: 1 });
  });

  it("not ready = nothing ordered and nothing held: empty cart, no shipping for the province, cash on delivery unavailable", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    const empty = await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" });
    expect(empty.status).toBe(422);
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    await prisma.shippingMethod.update({ where: { id: s.method }, data: { provinces: ["fars"] } });
    expect((await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).status).toBe(422);
    await prisma.shippingMethod.update({ where: { id: s.method }, data: { provinces: [], codEnabled: false } });
    expect((await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).status).toBe(422);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.stockReservation.count()).toBe(0);
  });

  it("numbers are gap-free per store, even when orders arrive at the same time; another store counts on its own", async () => {
    const s = await liveStore("shop");
    const shoppers = Array.from({ length: 5 }, () => shopper("shop"));
    for (const sh of shoppers) await sh.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const placed = await Promise.all(shoppers.map((sh) => sh.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })));
    expect(placed.map((p) => p.status)).toEqual([201, 201, 201, 201, 201]);
    expect(placed.map((p) => p.json.order.number).sort()).toEqual([1, 2, 3, 4, 5]);
    expect((await stockOf(s)).tea).toBe(0);

    const other = await liveStore("other");
    const o = shopper("other");
    await o.call("POST", "/cart/items", { productId: other.tea, quantity: 1 });
    expect((await o.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: other.method, paymentMethod: "COD" })).json.order.number).toBe(1);
  });

  it("the last item goes to exactly one of two shoppers; stock never goes below zero", async () => {
    const s = await liveStore("shop");
    await prisma.product.update({ where: { id: s.tea }, data: { stockQuantity: 1 } });
    const a = shopper("shop");
    const b = shopper("shop");
    await a.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    await b.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const r = await Promise.all([a, b].map((sh) => sh.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })));
    // The loser is refused either at the stock hold (409) or, if the winner already committed, by its own checkout summary (422: sold out).
    const statuses = r.map((x) => x.status).sort();
    expect(statuses[0]).toBe(201);
    expect([409, 422]).toContain(statuses[1]);
    expect((await stockOf(s)).tea).toBe(0);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.stockReservation.count({ where: { status: "ACTIVE" } })).toBe(0);
  });
});

describe("following and cancelling (shoppers)", () => {
  it("a guest follows the order with its token and can cancel until the store confirms; cancelling gives the stock back", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.shirt, variantId: s.variant, quantity: 2 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).json;
    expect(await stockOf(s)).toMatchObject({ shirt: 0, variant: 0 });
    const t = placed.accessToken;
    expect((await me.call("GET", `/checkout/orders/${t}`)).json).toMatchObject({ order: { number: 1 }, canCancel: true });
    expect((await shopper("other").call("GET", `/checkout/orders/${t}`)).status).toBe(404);
    expect((await me.call("GET", `/checkout/orders/${"x".repeat(43)}`)).status).toBe(404);

    const cancelled = await me.call("POST", `/checkout/orders/${t}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.json).toMatchObject({ order: { status: "CANCELLED" }, canCancel: false });
    expect(await stockOf(s)).toMatchObject({ shirt: 2, variant: 2 });
    expect((await me.call("POST", `/checkout/orders/${t}/cancel`)).status).toBe(409); // twice: nothing more given back
    expect(await stockOf(s)).toMatchObject({ shirt: 2, variant: 2 });
  });

  it("signed-in customers list and read only their own orders", async () => {
    const s = await liveStore("shop");
    const c1 = await prisma.customer.create({ data: { storeId: s.storeId, phone: "+989121112233" } });
    const c2 = await prisma.customer.create({ data: { storeId: s.storeId, phone: "+989121112244" } });
    const me = shopper("shop");
    me.jar.set("sb_customer", await customerSessions.issue({ customerId: c1.id, storeId: s.storeId, authVersion: 0 }));
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).json;
    expect(placed.order.customerId).toBe(c1.id);
    expect((await me.call("GET", "/customer/orders")).json.map((o: any) => o.order.id)).toEqual([placed.order.id]);

    const other = shopper("shop");
    other.jar.set("sb_customer", await customerSessions.issue({ customerId: c2.id, storeId: s.storeId, authVersion: 0 }));
    expect((await other.call("GET", "/customer/orders")).json).toEqual([]);
    expect((await other.call("GET", `/customer/orders/${placed.order.id}`)).status).toBe(404);
    expect((await other.call("POST", `/customer/orders/${placed.order.id}/cancel`)).status).toBe(404);
    expect((await shopper("shop").call("GET", "/customer/orders")).status).toBe(401);
    expect((await me.call("POST", `/customer/orders/${placed.order.id}/cancel`)).json.order.status).toBe("CANCELLED");
  });
});

describe("managing orders (merchant)", () => {
  it("lists newest first with a cursor, moves an order step by step with history and audit, and only cancels before shipping", async () => {
    const s = await liveStore("shop");
    for (let i = 0; i < 3; i++) {
      const sh = shopper("shop");
      await sh.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
      await sh.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" });
    }
    const page1 = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders?limit=2`);
    expect(page1.status).toBe(200);
    orderListDto.parse(page1.json);
    expect(page1.json.items.map((o: any) => o.number)).toEqual([3, 2]);
    const page2 = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders?limit=2&before=${page1.json.nextCursor}`);
    expect(page2.json).toMatchObject({ items: [{ number: 1 }], nextCursor: null });

    const id = page2.json.items[0].id;
    const step = (to: string) => merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${id}/status`, { to });
    expect((await step("SHIPPED")).status).toBe(409); // no skipping
    expect((await step("CONFIRMED")).json.status).toBe("CONFIRMED");
    expect((await step("SHIPPED")).json.status).toBe("SHIPPED");
    expect((await step("CANCELLED")).status).toBe(409); // shipped: no cancel
    const delivered = await step("DELIVERED");
    orderDto.parse(delivered.json);
    expect(delivered.json.history.map((h: any) => [h.from, h.to, h.actor])).toEqual([[null, "PLACED", "CUSTOMER"], ["PLACED", "CONFIRMED", "MERCHANT"], ["CONFIRMED", "SHIPPED", "MERCHANT"], ["SHIPPED", "DELIVERED", "MERCHANT"]]);
    expect(await prisma.auditEvent.count({ where: { storeId: s.storeId, action: "order.status_changed" } })).toBe(3);
    expect(await prisma.outboxEvent.count({ where: { type: "order.status_changed" } })).toBe(3);

    // the merchant's cancel gives stock back
    const before = (await stockOf(s)).tea;
    await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${page1.json.items[0].id}/status`, { to: "CANCELLED", note: "ناموجود در انبار" });
    expect((await stockOf(s)).tea).toBe(before + 1);
  });

  it("another merchant's store and its orders are the same 404 as missing ones", async () => {
    const s = await liveStore("shop");
    const sh = shopper("shop");
    await sh.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const id = (await sh.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).json.order.id;
    const other = await liveStore("other");
    expect((await merchantCall(other.merchant, "GET", `/stores/${s.storeId}/orders`)).status).toBe(404);
    expect((await merchantCall(other.merchant, "GET", `/stores/${other.storeId}/orders/${id}`)).status).toBe(404);
    expect((await merchantCall(other.merchant, "POST", `/stores/${other.storeId}/orders/${id}/status`, { to: "CONFIRMED" })).status).toBe(404);
  });

  it("the database keeps the money consistent", async () => {
    const s = await liveStore("shop");
    const sh = shopper("shop");
    await sh.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const id = (await sh.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).json.order.id;
    await expect(prisma.order.update({ where: { id }, data: { total: 1n } })).rejects.toThrow();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } });
    await expect(prisma.orderItem.update({ where: { id: item.id }, data: { lineTotal: 1n } })).rejects.toThrow();
  });
});

describe("security review 3.4 regressions", () => {
  it("cancelling after the ordered variant was deleted gives no phantom stock to the product", async () => {
    const s = await liveStore("shop");
    const l = await prisma.productVariant.create({ data: { storeId: s.storeId, productId: s.shirt, options: [{ name: "سایز", value: "L" }], optionsKey: '[["سایز","L"]]', price: 1, stockQuantity: 4 } });
    await prisma.product.update({ where: { id: s.shirt }, data: { stockQuantity: 6 } }); // 2 (M) + 4 (L)
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.shirt, variantId: s.variant, quantity: 2 });
    const placed = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).json;
    // the merchant removes M: the product now has only L (product stock = sum of variants = 4)
    await prisma.productVariant.delete({ where: { id: s.variant } });
    await prisma.product.update({ where: { id: s.shirt }, data: { stockQuantity: 4 } });
    expect((await me.call("POST", `/checkout/orders/${placed.accessToken}/cancel`)).json.order.status).toBe("CANCELLED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: s.shirt } })).stockQuantity).toBe(4);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: l.id } })).stockQuantity).toBe(4);
  });

  it("another shopper sending the same requestKey gets their own checkout, never the first order or its token", async () => {
    const s = await liveStore("shop");
    const key = requestKey();
    const a = shopper("shop");
    await a.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const first = (await a.call("POST", "/checkout/orders", { requestKey: key, address, shippingMethodId: s.method, paymentMethod: "COD" })).json;
    const b = shopper("shop");
    const replay = await b.call("POST", "/checkout/orders", { requestKey: key, address, shippingMethodId: s.method, paymentMethod: "COD" });
    expect(replay.status).toBe(422); // b has no cart: nothing to order, and nothing of a's is returned
    expect(JSON.stringify(replay.json)).not.toContain(first.accessToken);
    await b.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const own = (await b.call("POST", "/checkout/orders", { requestKey: key, address, shippingMethodId: s.method, paymentMethod: "COD" })).json;
    expect(own.order.id).not.toBe(first.order.id);
    expect(own.accessToken).not.toBe(first.accessToken);
  });
});

describe("customer accounts and guest orders (phase 3.3b)", () => {
  const placeAsGuest = async (s: Awaited<ReturnType<typeof liveStore>>, phone = "09123456789") => {
    const g = shopper("shop");
    await g.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    return (await g.call("POST", "/checkout/orders", { requestKey: requestKey(), address: { ...address, phone }, shippingMethodId: s.method, paymentMethod: "COD" })).json;
  };

  it("a guest order creates the store's customer for that phone (unverified) and is attached to it", async () => {
    const s = await liveStore("shop");
    const placed = await placeAsGuest(s);
    const c = await prisma.customer.findUniqueOrThrow({ where: { storeId_phone: { storeId: s.storeId, phone: "+989123456789" } } });
    expect(c).toMatchObject({ name: "علی رضایی", phoneVerifiedAt: null, passwordHash: null });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } })).toMatchObject({ customerId: c.id, linkedByPhone: true });
    await placeAsGuest(s); // the same phone again: still one customer
    expect(await prisma.customer.count({ where: { storeId: s.storeId } })).toBe(1);
  });

  it("a password account does not see orders attached to its phone; a verified phone does", async () => {
    const s = await liveStore("shop");
    const guestOrder = await placeAsGuest(s);
    const me = shopper("shop");
    const reg = await me.call("POST", "/customer/register", { phone: "09123456789", name: "علی", password: "a-good-password" });
    expect(reg.status).toBe(200);
    expect(reg.json.customer).toMatchObject({ phoneVerified: false });
    expect(me.jar.get("sb_customer")).toBeTruthy();
    expect((await me.call("GET", "/customer/orders")).json).toEqual([]); // the guest order is not proven theirs
    expect((await me.call("GET", `/customer/orders/${guestOrder.order.id}`)).status).toBe(404);

    // an order placed while signed in is theirs
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const own = (await me.call("POST", "/checkout/orders", { requestKey: requestKey(), address, shippingMethodId: s.method, paymentMethod: "COD" })).json;
    expect((await me.call("GET", "/customer/orders")).json.map((o: any) => o.order.id)).toEqual([own.order.id]);

    // once the phone is verified (SMS code), every order of that phone is theirs
    const c = await prisma.customer.findUniqueOrThrow({ where: { storeId_phone: { storeId: s.storeId, phone: "+989123456789" } } });
    await prisma.customer.update({ where: { id: c.id }, data: { phoneVerifiedAt: new Date() } });
    expect((await me.call("GET", "/customer/orders")).json.map((o: any) => o.order.id).sort()).toEqual([guestOrder.order.id, own.order.id].sort());
  });

  it("password sign-in: wrong password and unknown phone get the same answer; registering a phone twice is refused", async () => {
    const s = await liveStore("shop");
    await shopper("shop").call("POST", "/customer/register", { phone: "09121112233", name: "مریم", password: "a-good-password" });
    const a = await shopper("shop").call("POST", "/customer/login", { phone: "09121112233", password: "wrong-password" });
    const b = await shopper("shop").call("POST", "/customer/login", { phone: "09129998877", password: "a-good-password" });
    expect([a.status, b.status]).toEqual([400, 400]);
    expect(a.json.errorName).toBe(b.json.errorName);
    const ok = shopper("shop");
    expect((await ok.call("POST", "/customer/login", { phone: "۰۹۱۲۱۱۱۲۲۳۳", password: "a-good-password" })).status).toBe(200);
    expect((await ok.call("GET", "/customer/me")).json.customer.name).toBe("مریم");
    expect((await shopper("shop").call("POST", "/customer/register", { phone: "09121112233", name: "x x", password: "another-password" })).status).toBe(409);
    const stored = await prisma.customer.findFirstOrThrow({ where: { storeId: s.storeId, phone: "+989121112233" } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("the merchant sees each customer's order count, spending and orders", async () => {
    const s = await liveStore("shop");
    const first = await placeAsGuest(s);
    await placeAsGuest(s);
    await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${first.order.id}/status`, { to: "CANCELLED" });
    const c = await prisma.customer.findFirstOrThrow({ where: { storeId: s.storeId } });
    const stats = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders/customer-stats?ids=${c.id}`);
    expect(stats.json).toEqual([{ customerId: c.id, orders: 2, spent: 140_000, lastOrderAt: expect.any(String) }]); // 100k + 30k + 10k, the cancelled one not counted
    const theirs = await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/orders?customerId=${c.id}`);
    expect(theirs.json.items).toHaveLength(2);
  });
});
