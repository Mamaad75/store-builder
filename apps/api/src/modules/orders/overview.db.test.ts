import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { storeOverviewDto } from "@store-builder/shared/api/schemas";
import { periodStarts } from "@store-builder/shared/modules/orders/overview";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/**
 * M2 on real PostgreSQL, over HTTP: GET /api/stores/:storeId/overview. The numbers are checked against hand-computed totals of seeded orders
 * (every status, every payment method, inside and outside each period), with another store's orders and products present (isolation).
 * Roles: owner and manager read it, an operator is refused (403), a stranger gets 404; a suspended store's overview stays readable (GET).
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

type Method = "COD" | "ONLINE" | "CARD_TRANSFER";
type Status = "AWAITING_PAYMENT" | "PLACED" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "EXPIRED";
const numbers = new Map<string, number>();

async function order(storeId: string, paymentMethod: Method, status: Status, total: number, createdAt: Date, receipt?: "SUBMITTED" | "REJECTED") {
  const number = (numbers.get(storeId) ?? 0) + 1;
  numbers.set(storeId, number);
  const o = await prisma.order.create({
    data: {
      storeId, number, status, paymentMethod, createdAt,
      requestKey: `ov-${randomBytes(8).toString("hex")}`,
      accessTokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
      recipientName: "مریم احمدی", phone: "+989121234567", province: "tehran", city: "تهران", addressLine: "خیابان ولیعصر، پلاک ۸", postalCode: "1384567891",
      shippingName: "پیک", shippingKind: "FLAT", shippingCost: 0n,
      ...(paymentMethod === "ONLINE" ? { paymentGateway: "ZARINPAL" } : {}),
      ...(paymentMethod !== "COD" ? { paymentDeadline: new Date(createdAt.getTime() + 3600_000) } : {}), // CHECK: prepaid orders only
      subtotal: BigInt(total), total: BigInt(total), itemCount: 1,
    },
  });
  if (receipt) {
    await prisma.transferReceipt.create({
      data: { storeId, orderId: o.id, status: receipt, ...(receipt === "REJECTED" ? { reviewNote: "مبلغ واریزی کمتر است", reviewedAt: new Date() } : {}), trackingCode: "123456", payerCardLast4: "7893", image: Buffer.from([1]), imageMime: "image/webp", imageWidth: 1, imageHeight: 1 },
    });
  }
}

let slugN = 0;
async function product(storeId: string, name: string, stock: number, status: "ACTIVE" | "DRAFT" = "ACTIVE", variantStocks: number[] = []) {
  const p = await prisma.product.create({ data: { storeId, name, slug: `p-${++slugN}`, searchKey: name, price: 1000, stockQuantity: stock, status } });
  for (const [i, s] of variantStocks.entries()) {
    await prisma.productVariant.create({ data: { storeId, productId: p.id, options: [{ name: "رنگ", value: `v${i}` }], optionsKey: `[["رنگ","v${i}"]]`, price: 1000, stockQuantity: s, position: i } });
  }
  return p.id;
}

/** Store A with a known mix of orders and products; store B with orders and products that must never show up in A's overview. */
async function seed() {
  const owner = await makeUser();
  const a = await makeStore(owner.id, "فروشگاه الف");
  const otherOwner = await makeUser();
  const b = await makeStore(otherOwner.id, "فروشگاه ب");
  const s = periodStarts(new Date());
  const today = new Date(s.today.getTime() + 1000);
  const inWeek = new Date(s.days7.getTime() + 3600_000);
  const in30 = new Date(s.days30.getTime() + 3600_000);
  const older = new Date(s.days30.getTime() - 3600_000);

  await order(a.id, "COD", "DELIVERED", 100, today); //          value + paid (COD delivered)
  await order(a.id, "COD", "SHIPPED", 200, today); //            value; COD to collect
  await order(a.id, "ONLINE", "PLACED", 300, inWeek); //         value + paid (verified); to confirm
  await order(a.id, "ONLINE", "AWAITING_PAYMENT", 400, today); // pending online only
  await order(a.id, "CARD_TRANSFER", "AWAITING_PAYMENT", 500, today, "SUBMITTED"); // receipt in review
  await order(a.id, "CARD_TRANSFER", "AWAITING_PAYMENT", 600, in30, "REJECTED"); //  awaiting the customer
  await order(a.id, "CARD_TRANSFER", "CONFIRMED", 700, in30); // value + paid (receipt approved); to ship
  await order(a.id, "COD", "CANCELLED", 800, today); //          nowhere
  await order(a.id, "ONLINE", "EXPIRED", 900, today); //         nowhere
  await order(a.id, "COD", "DELIVERED", 1000, older); //         outside every period; not pending
  await order(a.id, "COD", "CONFIRMED", 50, older); //           outside every period; COD to collect; to ship

  await order(b.id, "COD", "DELIVERED", 99_999, today);
  await order(b.id, "ONLINE", "PLACED", 88_888, today);
  await order(b.id, "CARD_TRANSFER", "AWAITING_PAYMENT", 77_777, today, "SUBMITTED");

  const p1 = await product(a.id, "قهوه", 3); //                         at the threshold
  await product(a.id, "چای", 10); //                                     enough
  await product(a.id, "پیش‌نویس", 0, "DRAFT"); //                        not on sale
  const p4 = await product(a.id, "تی‌شرت", 6, "ACTIVE", [5, 1]); //      one variant low
  const p5 = await product(a.id, "عسل", 0); //                           sold out
  await product(b.id, "محصول ب", 0);

  return { a: a.id, b: b.id, owner: owner.id, otherOwner: otherOwner.id, p1, p4, p5 };
}

describe("M2 store overview (GET /api/stores/:storeId/overview)", () => {
  it("numbers match the seeded orders under the approved rules; the other store's data is excluded", async () => {
    const x = await seed();
    const r = await get(await sessionOf(x.owner), `/stores/${x.a}/overview`);
    expect(r.status).toBe(200);
    const o = storeOverviewDto.parse(r.json);
    expect(o.periods).toEqual({
      today: { orders: { count: 2, total: 300 }, paid: { count: 1, total: 100 } },
      days7: { orders: { count: 3, total: 600 }, paid: { count: 2, total: 400 } },
      days30: { orders: { count: 4, total: 1300 }, paid: { count: 3, total: 1100 } },
    });
    expect(o.pending).toEqual({
      codToCollect: { count: 2, total: 250 },
      onlineAwaiting: { count: 1, total: 400 },
      cardReceiptInReview: { count: 1, total: 500 },
      cardAwaitingCustomer: { count: 1, total: 600 },
    });
    expect(o.actions).toEqual({ receiptsToReview: 1, toConfirm: 1, toShip: 2 });
    expect(o.lowStock).toEqual({
      threshold: 3,
      total: 3,
      items: [
        { productId: x.p5, name: "عسل", stock: 0 },
        { productId: x.p4, name: "تی‌شرت", stock: 1 },
        { productId: x.p1, name: "قهوه", stock: 3 },
      ],
    });
  });

  it("a new store: all zeros, empty low-stock list", async () => {
    const owner = await makeUser();
    const s = await makeStore(owner.id);
    const o = storeOverviewDto.parse((await get(await sessionOf(owner.id), `/stores/${s.id}/overview`)).json);
    const zero = { count: 0, total: 0 };
    expect(o.periods.days30).toEqual({ orders: zero, paid: zero });
    expect(o.pending).toEqual({ codToCollect: zero, onlineAwaiting: zero, cardReceiptInReview: zero, cardAwaitingCustomer: zero });
    expect(o.actions).toEqual({ receiptsToReview: 0, toConfirm: 0, toShip: 0 });
    expect(o.lowStock).toEqual({ threshold: 3, total: 0, items: [] });
  });

  it("roles: manager reads it; operator 403; another store's owner 404; signed out 401", async () => {
    const x = await seed();
    const [manager, operator] = [await makeUser(), await makeUser()];
    await prisma.storeMember.createMany({ data: [{ storeId: x.a, userId: manager.id, role: "MANAGER" }, { storeId: x.a, userId: operator.id, role: "OPERATOR" }] });
    expect((await get(await sessionOf(manager.id), `/stores/${x.a}/overview`)).status).toBe(200);
    expect((await get(await sessionOf(operator.id), `/stores/${x.a}/overview`)).status).toBe(403);
    expect((await get(await sessionOf(x.otherOwner), `/stores/${x.a}/overview`)).status).toBe(404);
    expect((await get("", `/stores/${x.a}/overview`)).status).toBe(401);
  });

  it("a suspended store's overview stays readable (GET is on the suspension allow-list)", async () => {
    const x = await seed();
    await prisma.store.update({ where: { id: x.a }, data: { suspendedAt: new Date() } });
    const r = await get(await sessionOf(x.owner), `/stores/${x.a}/overview`);
    expect(r.status).toBe(200);
    expect(r.json.actions.toShip).toBe(2);
  });
});
