import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { orderDto } from "@store-builder/shared/api/schemas";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/**
 * The carrier's tracking code on real PostgreSQL over HTTP: entered when the order is shipped (or later), changed, cleared, audited, shown on
 * the order; refused for orders that were not shipped; the database's own CHECKs hold even for direct writes; roles and stores are respected.
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

const cookieOf = async (userId: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
};
async function post(cookie: string, path: string, body: unknown) {
  const r = await fetch(`${base}/api${path}`, { method: "POST", headers: { origin: PLATFORM, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const get = async (cookie: string, path: string) => {
  const r = await fetch(`${base}/api${path}`, { headers: { origin: PLATFORM, cookie } });
  return { status: r.status, json: (await r.json()) as any };
};
let n = 0;
const newOrder = (storeId: string) =>
  prisma.order.create({
    data: {
      storeId, number: ++n, status: "PLACED", paymentMethod: "COD", requestKey: `t-${n}-${randomBytes(6).toString("hex")}`,
      accessTokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
      recipientName: "مریم احمدی", phone: "+989121234567", province: "tehran", city: "تهران", addressLine: "خیابان ولیعصر", postalCode: "1384567891",
      shippingName: "پیک", shippingKind: "FLAT", shippingCost: 0n, subtotal: 1000n, itemCount: 1, total: 1000n,
    },
  });
async function setup() {
  const owner = await makeUser();
  const store = await makeStore(owner.id);
  const o = await newOrder(store.id);
  return { owner, store, o, cookie: await cookieOf(owner.id), status: (to: string, extra: object = {}) => async () => post(await cookieOf(owner.id), `/stores/${store.id}/orders/${o.id}/status`, { to, note: "", ...extra }) };
}

describe("tracking code", () => {
  it("entered when shipping, shown on the order (merchant and shopper DTO), changed and cleared later, each change audited", async () => {
    const { store, o, cookie } = await setup();
    const base = `/stores/${store.id}/orders/${o.id}`;
    expect((await post(cookie, `${base}/status`, { to: "CONFIRMED", note: "" })).status).toBe(200);
    const shipped = await post(cookie, `${base}/status`, { to: "SHIPPED", note: "", trackingCode: " ۱۲۳۴ ۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹۰۱۲ " });
    expect(shipped.status).toBe(200);
    expect(orderDto.parse(shipped.json).trackingCode).toBe("12345678901234567890" + "12");
    expect((await get(cookie, base)).json.trackingCode).toBe("1234567890123456789012");

    expect((await post(cookie, `${base}/tracking`, { trackingCode: "RR123456789IR" })).json.trackingCode).toBe("RR123456789IR");
    expect((await post(cookie, `${base}/tracking`, { trackingCode: "" })).json.trackingCode).toBeNull();
    expect((await post(cookie, `${base}/tracking`, { trackingCode: "AB-12.x_3" })).json.trackingCode).toBe("AB-12.x_3");
    const audits = await prisma.auditEvent.findMany({ where: { storeId: store.id, action: "order.tracking_set" } });
    expect(audits).toHaveLength(3);
    // the tracking code stays after delivery, and can still be corrected
    expect((await post(cookie, `${base}/status`, { to: "DELIVERED", note: "" })).json.trackingCode).toBe("AB-12.x_3");
    expect((await post(cookie, `${base}/tracking`, { trackingCode: "FIXED123" })).json.trackingCode).toBe("FIXED123");
  });

  it("refused: an order that was not shipped, a bad code, a code on a move that is not shipping; nothing is stored", async () => {
    const { store, o, cookie } = await setup();
    const base = `/stores/${store.id}/orders/${o.id}`;
    const early = await post(cookie, `${base}/tracking`, { trackingCode: "ABC123" });
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.json)).toContain("کد رهگیری فقط برای سفارش ارسال‌شده");
    const withCode = await post(cookie, `${base}/status`, { to: "CONFIRMED", note: "", trackingCode: "ABC123" });
    expect(withCode.status).toBe(400);
    await post(cookie, `${base}/status`, { to: "CONFIRMED", note: "" });
    for (const bad of ["ab", "has space-inside#", "<b>x</b>", "x".repeat(41)]) {
      expect((await post(cookie, `${base}/status`, { to: "SHIPPED", note: "", trackingCode: bad })).status, bad).toBe(400);
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CONFIRMED"); // a refused code does not ship the order
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).trackingCode).toBeNull();
  });

  it("the database refuses a code on an order that is not shipped or one with a bad shape, whatever the application does", async () => {
    const { o } = await setup();
    await expect(prisma.order.update({ where: { id: o.id }, data: { trackingCode: "ABC123" } })).rejects.toThrow(); // PLACED
    await prisma.order.update({ where: { id: o.id }, data: { status: "SHIPPED" } });
    await expect(prisma.order.update({ where: { id: o.id }, data: { trackingCode: "bad code!" } })).rejects.toThrow();
    await expect(prisma.order.update({ where: { id: o.id }, data: { trackingCode: "ab" } })).rejects.toThrow();
    await prisma.order.update({ where: { id: o.id }, data: { trackingCode: "GOOD-123" } });
  });

  it("roles and stores: a manager may, an operator may not, another store's order is a 404", async () => {
    const { owner, store, o, cookie } = await setup();
    const manager = await makeUser();
    const operator = await makeUser();
    const other = await makeUser();
    await prisma.storeMember.createMany({ data: [{ storeId: store.id, userId: manager.id, role: "MANAGER" }, { storeId: store.id, userId: operator.id, role: "OPERATOR" }] });
    const path = `/stores/${store.id}/orders/${o.id}`;
    await post(cookie, `${path}/status`, { to: "CONFIRMED", note: "" });
    await post(cookie, `${path}/status`, { to: "SHIPPED", note: "" });
    expect((await post(await cookieOf(manager.id), `${path}/tracking`, { trackingCode: "MGR12345" })).status).toBe(200);
    expect((await post(await cookieOf(operator.id), `${path}/tracking`, { trackingCode: "OPR12345" })).status).toBe(403);
    expect((await post(await cookieOf(other.id), `${path}/tracking`, { trackingCode: "OTH12345" })).status).toBe(404);
    const store2 = await makeStore(other.id, "دیگر");
    expect((await post(await cookieOf(other.id), `/stores/${store2.id}/orders/${o.id}/tracking`, { trackingCode: "OTH12345" })).status).toBe(404); // the order id of ANOTHER store
    void owner;
  });
});
