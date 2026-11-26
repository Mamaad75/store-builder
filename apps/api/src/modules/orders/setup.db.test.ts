import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { storeSetupDto } from "@store-builder/shared/api/schemas";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, publishStore, resetDb } from "../../test/db-helpers.js";

/**
 * MVP item 3 on real PostgreSQL, over HTTP: GET /api/stores/:storeId/setup. Every item flips only on its own data, another store's data
 * never counts, and the roles are enforced (owner and manager read it; an operator is refused; a stranger gets 404).
 */
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

async function sessionOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
}
async function get(cookie: string, path: string) {
  const r = await fetch(`${base}/api${path}`, { headers: { origin: PLATFORM, cookie } });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const state = async (cookie: string, storeId: string) => {
  const r = await get(cookie, `/stores/${storeId}/setup`);
  expect(r.status).toBe(200);
  const body = storeSetupDto.parse(r.json);
  return { done: Object.fromEntries(body.items.map((i) => [i.key, i.done])), methods: body.paymentMethods, complete: body.complete };
};

let slugN = 0;
const product = (storeId: string, status: "DRAFT" | "ACTIVE" | "ARCHIVED") =>
  prisma.product.create({ data: { storeId, name: "کالا", slug: `s-${++slugN}`, searchKey: "کالا", price: 1000, stockQuantity: 5, status } });
const shipping = (storeId: string, over: { enabled?: boolean; codEnabled?: boolean } = {}) =>
  prisma.shippingMethod.create({ data: { storeId, name: "پیک", kind: "FLAT", enabled: over.enabled ?? true, codEnabled: over.codEnabled ?? false } });

describe("GET /stores/:id/setup", () => {
  it("walks from empty to complete, one item at a time", async () => {
    const owner = await makeUser();
    const store = await makeStore(owner.id);
    const cookie = await sessionOf(owner.id);

    expect(await state(cookie, store.id)).toEqual({ done: { product: false, shipping: false, payment: false, subdomain: false, publish: false }, methods: [], complete: false });

    await product(store.id, "DRAFT");
    await product(store.id, "ARCHIVED");
    expect((await state(cookie, store.id)).done.product).toBe(false); // only ACTIVE products count
    await product(store.id, "ACTIVE");
    expect((await state(cookie, store.id)).done.product).toBe(true);

    const off = await shipping(store.id, { enabled: false, codEnabled: true });
    let s = await state(cookie, store.id);
    expect([s.done.shipping, s.done.payment]).toEqual([false, false]); // a disabled method counts for neither shipping nor cash on delivery
    await prisma.shippingMethod.update({ where: { id: off.id }, data: { enabled: true, codEnabled: false } });
    s = await state(cookie, store.id);
    expect([s.done.shipping, s.done.payment]).toEqual([true, false]); // shipping alone is not a payment method

    await prisma.shippingMethod.update({ where: { id: off.id }, data: { codEnabled: true } });
    s = await state(cookie, store.id);
    expect([s.done.payment, s.methods]).toEqual([true, ["cod"]]);

    await prisma.shippingMethod.update({ where: { id: off.id }, data: { codEnabled: false } });
    await prisma.storeBankCard.create({ data: { storeId: store.id, cardNumber: "6037997000000001", holderName: "علی رضایی", bankName: "ملی", position: 0 } });
    s = await state(cookie, store.id);
    expect([s.done.payment, s.methods]).toEqual([true, ["cardTransfer"]]);

    await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: "my-shop" } });
    expect((await state(cookie, store.id)).done.subdomain).toBe(true);
    expect((await state(cookie, store.id)).complete).toBe(false);

    await publishStore(store.id);
    expect(await state(cookie, store.id)).toMatchObject({ complete: true, done: { product: true, shipping: true, payment: true, subdomain: true, publish: true } });
  });

  it("another store's products, shipping, cards and domain never count", async () => {
    const o1 = await makeUser();
    const o2 = await makeUser();
    const a = await makeStore(o1.id, "الف");
    const b = await makeStore(o2.id, "ب");
    await product(b.id, "ACTIVE");
    await shipping(b.id, { codEnabled: true });
    await prisma.storeBankCard.create({ data: { storeId: b.id, cardNumber: "6037997000000002", holderName: "علی رضایی", bankName: "ملی", position: 0 } });
    await prisma.domain.create({ data: { storeId: b.id, kind: "SUBDOMAIN", host: "other-shop" } });
    await publishStore(b.id);
    expect(await state(await sessionOf(o1.id), a.id)).toEqual({ done: { product: false, shipping: false, payment: false, subdomain: false, publish: false }, methods: [], complete: false });
  });

  it("roles: owner and manager read it, an operator is refused, a stranger gets 404, no session 401", async () => {
    const owner = await makeUser();
    const manager = await makeUser();
    const operator = await makeUser();
    const stranger = await makeUser();
    const store = await makeStore(owner.id);
    await prisma.storeMember.createMany({ data: [{ storeId: store.id, userId: manager.id, role: "MANAGER" }, { storeId: store.id, userId: operator.id, role: "OPERATOR" }] });
    const path = `/stores/${store.id}/setup`;
    expect((await get(await sessionOf(owner.id), path)).status).toBe(200);
    expect((await get(await sessionOf(manager.id), path)).status).toBe(200);
    expect((await get(await sessionOf(operator.id), path)).status).toBe(403);
    expect((await get(await sessionOf(stranger.id), path)).status).toBe(404);
    expect((await get("", path)).status).toBe(401);
  });
});
