import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { cartViewDto, checkoutSummaryDto, savedAddressDto, shippingMethodDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { customerTokens } from "../customers/infrastructure/crypto.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import { purgeExpiredCarts } from "./checkout.api.js";

/** Phase 3.3 on real PostgreSQL, over HTTP: cart cookie, origins, store isolation, live stock, shipping, saved addresses, cleanup. */
const PLATFORM = "http://localhost:3000";
const storeOrigin = (label: string) => `http://${label}.localhost:3000`;
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

/** A live store `label`: product rows (stock), a published snapshot naming them (prices), and its subdomain. */
async function liveStore(label: string) {
  const owner = await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 10, status: "ACTIVE", weightGrams: 1500 } });
  const shirt = await prisma.product.create({ data: { storeId: store.id, name: "پیراهن", slug: `shirt-${label}`, searchKey: "پیراهن", price: 1, stockQuantity: 3, status: "ACTIVE" } });
  const m = await prisma.productVariant.create({ data: { storeId: store.id, productId: shirt.id, options: [{ name: "سایز", value: "M" }], optionsKey: '[["سایز","M"]]', price: 1, stockQuantity: 3 } });
  const products: StorefrontProduct[] = [
    { ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 10, weightGrams: 1500, categoryId: null },
    { ...PRODUCT_A, id: shirt.id, slug: shirt.slug, name: "پیراهن", price: 250_000, stockQuantity: 3, categoryId: null, variants: [{ id: m.id, options: [{ name: "سایز", value: "M" }], price: 250_000, stockQuantity: 3 }] },
  ];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
  const merchant = `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
  return { storeId: store.id, tea: tea.id, shirt: shirt.id, variant: m.id, merchant };
}

/** A tiny cookie jar per shopper: what the browser would send back. */
function shopper(label: string, origin = storeOrigin(label)) {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(`${base}/api/public/stores/${label}${path}`, {
      method,
      headers: { origin, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    const text = await r.text();
    return { status: r.status, headers: r.headers, setCookies: r.headers.getSetCookie(), json: (text ? JSON.parse(text) : null) as any };
  };
  return { call, jar };
}

const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };

async function putMethods(storeId: string, merchant: string, methods: unknown[]) {
  const r = await fetch(`${base}/api/stores/${storeId}/shipping-methods`, { method: "PUT", headers: { origin: PLATFORM, cookie: merchant, "content-type": "application/json" }, body: JSON.stringify({ methods }) });
  return { status: r.status, json: (await r.json()) as any };
}

describe("cart over HTTP (phase 3.3)", () => {
  it("the first add sets an httpOnly cart cookie; prices come from the published store; nothing is cacheable", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    const add = await me.call("POST", "/cart/items", { productId: s.tea, quantity: 2 });
    expect(add.status).toBe(200);
    expect(add.setCookies.join()).toMatch(/sb_cart=[A-Za-z0-9_-]{43}; Max-Age=2592000;.*HttpOnly; SameSite=Lax/);
    expect(add.headers.get("cache-control")).toBe("no-store");
    cartViewDto.parse(add.json);
    expect(add.json).toMatchObject({ subtotal: 200_000, count: 2 });
    // the stored token is only a hash
    const row = await prisma.cart.findFirstOrThrow();
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toBe(me.jar.get("sb_cart"));

    await me.call("POST", "/cart/items", { productId: s.shirt, variantId: s.variant, quantity: 1 });
    const cart = await me.call("GET", "/cart");
    expect(cart.json.lines.map((l: any) => [l.name, l.variantLabel, l.unitPrice, l.quantity])).toEqual([["چای", "", 100_000, 2], ["پیراهن", "سایز: M", 250_000, 1]]);
    expect(cart.json.subtotal).toBe(450_000);
  });

  it("posts are accepted from the platform and from the store's own origin only", async () => {
    const s = await liveStore("shop");
    await liveStore("other");
    expect((await shopper("shop", PLATFORM).call("POST", "/cart/items", { productId: s.tea, quantity: 1 })).status).toBe(200);
    expect((await shopper("shop", storeOrigin("other")).call("POST", "/cart/items", { productId: s.tea, quantity: 1 })).status).toBe(403);
    expect((await shopper("shop", "https://evil.example").call("POST", "/cart/items", { productId: s.tea, quantity: 1 })).status).toBe(403);
    expect((await shopper("shop", storeOrigin("other")).call("POST", "/checkout/quote", {})).status).toBe(403);
  });

  it("a cart belongs to one store: its cookie shows nothing in another store, and another store's products cannot be added", async () => {
    const a = await liveStore("shop");
    await liveStore("other");
    const me = shopper("shop", PLATFORM);
    await me.call("POST", "/cart/items", { productId: a.tea, quantity: 1 });
    const elsewhere = shopper("other", PLATFORM);
    elsewhere.jar.set("sb_cart", me.jar.get("sb_cart")!);
    expect((await elsewhere.call("GET", "/cart")).json.lines).toEqual([]);
    expect((await elsewhere.call("POST", "/cart/items", { productId: a.tea, quantity: 1 })).status).toBe(404);
  });

  it("stock is read live: a sold-out line stays with its reason and counts in no total", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 4 });
    await prisma.product.update({ where: { id: s.tea }, data: { stockQuantity: 3 } });
    expect((await me.call("GET", "/cart")).json.lines[0]).toMatchObject({ problem: "not_enough_stock", available: 3, lineTotal: 0 });
    await prisma.product.update({ where: { id: s.tea }, data: { status: "ARCHIVED" } });
    expect((await me.call("GET", "/cart")).json.lines[0].problem).toBe("unavailable");
  });

  it("a product deleted from the draft cannot be added, and its lines leave every cart", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.shirt, variantId: s.variant, quantity: 1 });
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    await prisma.product.delete({ where: { id: s.tea } });
    expect((await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 })).status).toBe(404);
    expect((await me.call("GET", "/cart")).json.lines.map((l: any) => l.productId)).toEqual([s.shirt]);
  });

  it("validation: variant required, bad bodies are 400 with field errors, set 0 removes", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    const r = await me.call("POST", "/cart/items", { productId: s.shirt, quantity: 1 });
    expect(r.status).toBe(400);
    expect((await me.call("POST", "/cart/items", { productId: s.tea, quantity: "2" })).status).toBe(400);
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    expect((await me.call("PUT", "/cart/items", { productId: s.tea, quantity: 0 })).json.lines).toEqual([]);
    expect((await me.call("DELETE", "/cart")).status).toBe(204);
  });

  it("the database refuses a quantity out of range and a line key that does not match its product", async () => {
    const s = await liveStore("shop");
    const cart = await prisma.cart.create({ data: { storeId: s.storeId, tokenHash: "a".repeat(64) } });
    await expect(prisma.cartItem.create({ data: { storeId: s.storeId, cartId: cart.id, productId: s.tea, lineKey: `${s.tea}|-`, quantity: 0 } })).rejects.toThrow();
    await expect(prisma.cartItem.create({ data: { storeId: s.storeId, cartId: cart.id, productId: s.tea, lineKey: "forged|-", quantity: 1 } })).rejects.toThrow();
  });
});

describe("shipping methods and the checkout summary (phase 3.3)", () => {
  it("the merchant's methods apply at once; province prices, weight, free-above and cash on delivery add up server-side", async () => {
    const s = await liveStore("shop");
    const put = await putMethods(s.storeId, s.merchant, [
      { name: "پیک تهران", kind: "FLAT", price: 60_000, provinces: ["tehran"], cashOnDelivery: { enabled: true, provinces: ["tehran"], fee: 20_000 } },
      { name: "پست", kind: "WEIGHT", price: 50_000, perKg: 10_000, provincePrices: [{ province: "tehran", price: 40_000 }], freeAbove: 5_000_000 },
      { name: "غیرفعال", kind: "FLAT", price: 1, enabled: false },
    ]);
    expect(put.status).toBe(200);
    put.json.forEach((m: unknown) => shippingMethodDto.parse(m));
    expect(await prisma.auditEvent.count({ where: { storeId: s.storeId, action: "store.shipping_methods_replaced" } })).toBe(1);

    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 2 }); // 2 x 1.5 kg = 3 kg
    const q = await me.call("POST", "/checkout/quote", { address, shippingMethodId: put.json[1].id });
    expect(q.status).toBe(200);
    checkoutSummaryDto.parse(q.json);
    expect(q.json.shippingOptions.map((o: any) => [o.name, o.cost])).toEqual([["پیک تهران", 60_000], ["پست", 60_000]]); // 40k + 2 extra kg
    expect(q.json).toMatchObject({ subtotal: 200_000, shippingCost: 60_000, total: 260_000, ready: true });

    const cod = await me.call("POST", "/checkout/quote", { address, shippingMethodId: put.json[0].id, cashOnDelivery: true });
    expect(cod.json).toMatchObject({ total: 280_000, codFee: 20_000, cashOnDelivery: true, ready: true });

    const fars = await me.call("POST", "/checkout/quote", { address: { ...address, province: "fars" }, shippingMethodId: put.json[0].id });
    expect(fars.json.shippingOptions.map((o: any) => [o.name, o.cost])).toEqual([["پست", 70_000]]);
    expect(fars.json.blockers).toEqual(["shipping_unavailable"]);
  });

  it("a price sent by the page is refused, never used", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    expect((await me.call("POST", "/checkout/quote", { address, total: 1 })).status).toBe(400);
  });

  it("only owner and manager change shipping (store.settings); a stranger gets the same 404 as a missing store", async () => {
    const s = await liveStore("shop");
    const stranger = await makeUser();
    const cookie = `sb_session=${await sessions.sign({ userId: stranger.id, authVersion: 0 })}`;
    expect((await putMethods(s.storeId, cookie, [])).status).toBe(404);
    const bad = await putMethods(s.storeId, s.merchant, [{ name: "حضوری", kind: "PICKUP", price: 5 }]);
    expect(bad.status).toBe(400);
  });
});

describe("saved addresses (phase 3.3)", () => {
  async function signedIn(label: string, storeId: string, phone = "+989121112233") {
    const c = await prisma.customer.create({ data: { storeId, phone } });
    const me = shopper(label);
    me.jar.set("sb_customer", await customerSessions.issue({ customerId: c.id, storeId, authVersion: 0 }));
    return { me, customerId: c.id };
  }

  it("need a session of THIS store; a customer sees and changes only their own", async () => {
    const s = await liveStore("shop");
    const other = await liveStore("other");
    expect((await shopper("shop").call("GET", "/customer/addresses")).status).toBe(401);

    const { me } = await signedIn("shop", s.storeId);
    const created = await me.call("POST", "/customer/addresses", address);
    expect(created.status).toBe(201);
    expect(savedAddressDto.parse(created.json)).toMatchObject({ phone: "+989123456789", postalCode: "1384567891" });

    // the same token on another store's routes is no session there
    const elsewhere = shopper("other");
    elsewhere.jar.set("sb_customer", me.jar.get("sb_customer")!);
    expect((await elsewhere.call("GET", "/customer/addresses")).status).toBe(401);

    const { me: someoneElse } = await signedIn("shop", s.storeId, "+989121112244");
    expect((await someoneElse.call("GET", "/customer/addresses")).json).toEqual([]);
    expect((await someoneElse.call("PUT", `/customer/addresses/${created.json.id}`, address)).status).toBe(404);
    expect((await someoneElse.call("DELETE", `/customer/addresses/${created.json.id}`)).status).toBe(404);
    expect((await someoneElse.call("POST", "/checkout/quote", { addressId: created.json.id })).status).toBe(404);

    expect((await me.call("POST", "/checkout/quote", { addressId: created.json.id })).json.blockers).toEqual(["empty_cart", "no_shipping_for_province"]);
    expect((await me.call("DELETE", `/customer/addresses/${created.json.id}`)).status).toBe(204);
    void other;
  });

  it("at most 10 per customer", async () => {
    const s = await liveStore("shop");
    const { me } = await signedIn("shop", s.storeId);
    for (let i = 0; i < 10; i++) expect((await me.call("POST", "/customer/addresses", address)).status).toBe(201);
    expect((await me.call("POST", "/customer/addresses", address)).status).toBe(409);
  });

  it("signing in folds the device's guest cart into the customer's cart", async () => {
    const s = await liveStore("shop");
    const me = shopper("shop");
    await me.call("POST", "/cart/items", { productId: s.tea, quantity: 1 });
    const c = await prisma.customer.create({ data: { storeId: s.storeId, phone: "+989121112233" } });
    const theirs = await prisma.cart.create({ data: { storeId: s.storeId, tokenHash: "b".repeat(64), customerId: c.id } });
    await prisma.cartItem.create({ data: { storeId: s.storeId, cartId: theirs.id, productId: s.tea, lineKey: `${s.tea}|-`, quantity: 2 } });
    me.jar.set("sb_customer", await customerSessions.issue({ customerId: c.id, storeId: s.storeId, authVersion: 0 }));
    expect((await me.call("GET", "/cart")).json).toMatchObject({ count: 3, subtotal: 300_000 });
    expect(await prisma.cart.count()).toBe(1);
  });
});

describe("cleanup (phase 3.3)", () => {
  it("db-cleanup deletes carts untouched for 30 days, with their lines", async () => {
    const s = await liveStore("shop");
    const old = await prisma.cart.create({ data: { storeId: s.storeId, tokenHash: "c".repeat(64) } });
    await prisma.cartItem.create({ data: { storeId: s.storeId, cartId: old.id, productId: s.tea, lineKey: `${s.tea}|-`, quantity: 1 } });
    await prisma.$executeRaw`UPDATE "Cart" SET "updatedAt" = now() - interval '31 days' WHERE id = ${old.id}`;
    await prisma.cart.create({ data: { storeId: s.storeId, tokenHash: "d".repeat(64) } });
    expect(await purgeExpiredCarts(new Date(), 30)).toBe(1);
    expect(await prisma.cart.count()).toBe(1);
    expect(await prisma.cartItem.count()).toBe(0);
  });
});

describe("security review 3.3 regressions", () => {
  it("one cart per customer, even when two requests create it at the same time", async () => {
    const s = await liveStore("shop");
    const c = await prisma.customer.create({ data: { storeId: s.storeId, phone: "+989121112233" } });
    const token = await customerSessions.issue({ customerId: c.id, storeId: s.storeId, authVersion: 0 });
    const devices = [shopper("shop"), shopper("shop"), shopper("shop")];
    devices.forEach((d) => d.jar.set("sb_customer", token));
    const results = await Promise.all(devices.map((d) => d.call("POST", "/cart/items", { productId: s.tea, quantity: 1 })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await prisma.cart.count({ where: { customerId: c.id } })).toBe(1);
    expect((await devices[0]!.call("GET", "/cart")).json.count).toBe(3);
    await expect(prisma.cart.create({ data: { storeId: s.storeId, tokenHash: "e".repeat(64), customerId: c.id } })).rejects.toThrow();
  });

  it("the database ties a line's variant to the line's own product, and refuses NULL province entries", async () => {
    const s = await liveStore("shop");
    const cart = await prisma.cart.create({ data: { storeId: s.storeId, tokenHash: "f".repeat(64) } });
    await expect(prisma.cartItem.create({ data: { storeId: s.storeId, cartId: cart.id, productId: s.tea, variantId: s.variant, lineKey: `${s.tea}|${s.variant}`, quantity: 1 } })).rejects.toThrow();
    await expect(prisma.$executeRaw`INSERT INTO "ShippingMethod" (id, "storeId", name, kind, provinces, "updatedAt") VALUES ('m-null', ${s.storeId}, 'x', 'FLAT', ARRAY['tehran', NULL]::text[], now())`).rejects.toThrow();
  });

  it("the new-cart limit is per store and does not apply to signed-in customers", async () => {
    const a = await liveStore("shop");
    const b = await liveStore("other");
    // exhaust store A's per-network budget for guests
    const rule = 120;
    for (let i = 0; i < rule; i++) expect((await shopper("shop").call("POST", "/cart/items", { productId: a.tea, quantity: 1 })).status).toBe(200);
    expect((await shopper("shop").call("POST", "/cart/items", { productId: a.tea, quantity: 1 })).status).toBe(429);
    expect((await shopper("other").call("POST", "/cart/items", { productId: b.tea, quantity: 1 })).status).toBe(200);
    const c = await prisma.customer.create({ data: { storeId: a.storeId, phone: "+989121112233" } });
    const me = shopper("shop");
    me.jar.set("sb_customer", await customerSessions.issue({ customerId: c.id, storeId: a.storeId, authVersion: 0 }));
    expect((await me.call("POST", "/cart/items", { productId: a.tea, quantity: 1 })).status).toBe(200);
  }, 120_000);
});
