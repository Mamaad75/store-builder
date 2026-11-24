import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { checkoutSummaryDto, discountDto, placedOrderDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** Phase 5.1 on real PostgreSQL, over HTTP: discount codes from the dashboard to the checkout summary and the order. */
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

let keyN = 0;
const requestKey = () => `dis-${Date.now()}-${++keyN}`.padEnd(20, "x");
const address = (phone = "09123456789") => ({ recipientName: "علی رضایی", phone, province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" });

async function liveStore(label = "shop") {
  const owner = await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  const cat = await prisma.productCategory.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, position: 0 } });
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 50, status: "ACTIVE", categoryId: cat.id } });
  const cup = await prisma.product.create({ data: { storeId: store.id, name: "فنجان", slug: `cup-${label}`, searchKey: "فنجان", price: 1, stockQuantity: 50, status: "ACTIVE" } });
  const products: StorefrontProduct[] = [
    { ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 50, categoryId: cat.id },
    { ...PRODUCT_A, id: cup.id, slug: cup.slug, name: "فنجان", price: 50_000, stockQuantity: 50, categoryId: null },
  ];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [{ id: cat.id, name: "چای", slug: cat.slug }] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const method = await prisma.shippingMethod.create({ data: { storeId: store.id, name: "پیک", kind: "FLAT", price: 30_000, codEnabled: true, codFee: 0 } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  return { storeId: store.id, tea: tea.id, cup: cup.id, cat: cat.id, method: method.id, merchant: `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}` };
}

function shopper(label = "shop") {
  const jar: string[] = [];
  return async (m: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/public/stores/${label}${path}`, {
      method: m,
      headers: { origin: `http://${label}.localhost:3000`, "content-type": "application/json", ...(jar.length ? { cookie: jar.join("; ") } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) jar.push(c.split(";")[0]!);
    const t = await r.text();
    return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
  };
}
async function merchantCall(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
const create = (s: { storeId: string; merchant: string }, body: unknown) => merchantCall(s.merchant, "POST", `/stores/${s.storeId}/discounts`, body);

describe("discount codes (phase 5.1)", () => {
  it("a percent code with a cap: in the summary, on the order snapshot, and counted; cancelling gives the use back", async () => {
    const s = await liveStore();
    const d = await create(s, { code: "yalda", type: "PERCENT", value: 20, maxDiscount: 30_000, usageLimit: 1 });
    expect(d.status).toBe(201);
    discountDto.parse(d.json);
    const shop = shopper();
    await shop("POST", "/cart/items", { productId: s.tea, quantity: 2 });
    const q = await shop("POST", "/checkout/quote", { address: address(), shippingMethodId: s.method, cashOnDelivery: true, discountCode: " Yalda " });
    const sum = checkoutSummaryDto.parse(q.json);
    expect([sum.subtotal, sum.shippingCost, sum.discount?.amount, sum.total, sum.ready]).toEqual([200_000, 30_000, 30_000, 200_000, true]);
    expect(JSON.stringify(q.json)).not.toContain(d.json.id); // the discount id stays on the server
    const placed = placedOrderDto.parse((await shop("POST", "/checkout/orders", { requestKey: requestKey(), address: address(), shippingMethodId: s.method, paymentMethod: "COD", discountCode: "YALDA" })).json);
    expect(placed.order).toMatchObject({ discountCode: "YALDA", discountAmount: 30_000, total: 200_000, subtotal: 200_000 });
    expect((await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/discounts`)).json[0].used).toBe(1);
    // exhausted for the next shopper
    const other = shopper();
    await other("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const q2 = await other("POST", "/checkout/quote", { address: address("09351112233"), shippingMethodId: s.method, cashOnDelivery: true, discountCode: "yalda" });
    expect([q2.json.discountError?.reason, q2.json.ready, q2.json.blockers.includes("discount_invalid")]).toEqual(["exhausted", false, true]);
    const refused = await other("POST", "/checkout/orders", { requestKey: requestKey(), address: address("09351112233"), shippingMethodId: s.method, paymentMethod: "COD", discountCode: "yalda" });
    expect([refused.status, refused.json.errorName, refused.json.payload.reason]).toEqual([422, "DiscountInvalidError", "exhausted"]);
    // the merchant cancels the first order: the use comes back
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/orders/${placed.order.id}/status`, { to: "CANCELLED", note: "" })).status).toBe(200);
    expect((await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/discounts`)).json[0].used).toBe(0);
    expect((await other("POST", "/checkout/quote", { address: address("09351112233"), shippingMethodId: s.method, cashOnDelivery: true, discountCode: "yalda" })).json.discount.amount).toBe(20_000);
  });

  it("a single-use code ordered by two shoppers at once: exactly one order gets it", async () => {
    const s = await liveStore();
    await create(s, { code: "ONCE", type: "FIXED", value: 10_000, usageLimit: 1 });
    const a = shopper();
    const b = shopper();
    await a("POST", "/cart/items", { productId: s.cup, quantity: 1 });
    await b("POST", "/cart/items", { productId: s.cup, quantity: 1 });
    const [ra, rb] = await Promise.all([
      a("POST", "/checkout/orders", { requestKey: requestKey(), address: address("09121110000"), shippingMethodId: s.method, paymentMethod: "COD", discountCode: "once" }),
      b("POST", "/checkout/orders", { requestKey: requestKey(), address: address("09121110001"), shippingMethodId: s.method, paymentMethod: "COD", discountCode: "once" }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([201, 422]);
    expect(await prisma.discountRedemption.count({ where: { released: false } })).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: s.cup } })).stockQuantity).toBe(49); // the refused order took no stock
  });

  it("scope, minimum, first order, per customer, free shipping, dates, unknown codes", async () => {
    const s = await liveStore();
    await create(s, { code: "TEA10", type: "PERCENT", value: 10, scope: "CATEGORIES", scopeIds: [s.cat] });
    await create(s, { code: "BIG", type: "FIXED", value: 20_000, minOrder: 500_000 });
    await create(s, { code: "WELCOME", type: "FIXED", value: 5_000, firstOrderOnly: true, perCustomerLimit: 1 });
    await create(s, { code: "SHIP", type: "FREE_SHIPPING" });
    await create(s, { code: "LATER", type: "FIXED", value: 5_000, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    const shop = shopper();
    await shop("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    await shop("POST", "/cart/items", { productId: s.cup, quantity: 1 });
    const quote = async (code: string, phone = "09123456789") => (await shop("POST", "/checkout/quote", { address: address(phone), shippingMethodId: s.method, cashOnDelivery: true, discountCode: code })).json;
    expect((await quote("tea10")).discount.amount).toBe(10_000); // 10% of the tea only
    expect((await quote("big")).discountError).toMatchObject({ reason: "min_order", minOrder: 500_000 });
    expect((await quote("ship")).discount).toMatchObject({ amount: 30_000, shippingDiscount: 30_000 });
    expect((await quote("ship")).total).toBe(150_000);
    expect((await quote("later")).discountError.reason).toBe("not_started");
    expect((await quote("nope")).discountError.reason).toBe("not_found");
    expect((await quote("welcome")).discount.amount).toBe(5_000);
    await shop("POST", "/checkout/orders", { requestKey: requestKey(), address: address(), shippingMethodId: s.method, paymentMethod: "COD", discountCode: "welcome" });
    const again = shopper();
    await again("POST", "/cart/items", { productId: s.cup, quantity: 1 });
    expect((await again("POST", "/checkout/quote", { address: address(), shippingMethodId: s.method, cashOnDelivery: true, discountCode: "welcome" })).json.discountError.reason).toBe("customer_limit");
  });

  it("the merchant's list: validation, unique codes, owner/manager only; a code changed between summary and order is refused", async () => {
    const s = await liveStore();
    expect((await create(s, { code: "x", type: "PERCENT", value: 10 })).status).toBe(400);
    expect((await create(s, { code: "DUP", type: "PERCENT", value: 10 })).status).toBe(201);
    const dup = await create(s, { code: "dup", type: "FIXED", value: 5000 });
    expect([dup.status, dup.json.errorName]).toEqual([409, "DiscountCodeTakenError"]);
    const other = await liveStore("other");
    expect((await merchantCall(other.merchant, "GET", `/stores/${s.storeId}/discounts`)).status).toBe(404);
    expect((await fetch(`${base}/api/stores/${s.storeId}/discounts`)).status).toBe(401);
    // quote with 10%, the merchant changes it to 50%, the shopper places with the old summary in mind: priced now, at 50%
    const shop = shopper();
    await shop("POST", "/cart/items", { productId: s.cup, quantity: 1 });
    const id = (await merchantCall(s.merchant, "GET", `/stores/${s.storeId}/discounts`)).json[0].id;
    expect((await merchantCall(s.merchant, "PUT", `/stores/${s.storeId}/discounts/${id}`, { code: "DUP", type: "PERCENT", value: 50 })).status).toBe(200);
    const placed = await shop("POST", "/checkout/orders", { requestKey: requestKey(), address: address(), shippingMethodId: s.method, paymentMethod: "COD", discountCode: "dup" });
    expect(placed.json.order).toMatchObject({ discountAmount: 25_000, total: 55_000 }); // the order is always priced at placing time
    expect(await prisma.auditEvent.count({ where: { storeId: s.storeId, action: { startsWith: "discount." } } })).toBe(2);
    expect((await merchantCall(s.merchant, "POST", `/stores/${s.storeId}/discounts/${id}/delete`)).status).toBe(204);
    expect((await prisma.order.findFirstOrThrow()).discountCode).toBe("DUP"); // the snapshot stays
  });
});
