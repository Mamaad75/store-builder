import { createHash, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { storeAnalyticsDto } from "@store-builder/shared/api/schemas";
import { tehranDayKey } from "@store-builder/shared/modules/analytics/analytics";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, publishStore, resetDb } from "../../test/db-helpers.js";
import { purgeAnalytics } from "./analytics.api.js";

/**
 * Store trend charts on real PostgreSQL, over HTTP: the storefront beacon (POST /api/public/stores/:label/visit) and the merchant's report
 * (GET /api/stores/:storeId/analytics). Visitors are counted once per day, bots / Do-Not-Track / unlisted stores are not counted, the Tehran
 * day boundary decides which day an order or customer falls in, another store's data never mixes in, and roles are enforced.
 */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

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
async function report(cookie: string, storeId: string, days: string | null = "7") {
  const r = await fetch(`${base}/api/stores/${storeId}/analytics${days === null ? "" : `?days=${days}`}`, { headers: { origin: PLATFORM, cookie } });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
/** The shopper's beacon from the store's own origin. `ip` is forwarded through the trusted proxy header. */
async function visit(label: string, o: { ip?: string; ua?: string; dnt?: boolean; origin?: string } = {}) {
  const headers: Record<string, string> = { origin: o.origin ?? `http://${label}.localhost:3000`, "x-forwarded-for": o.ip ?? "203.0.113.5", "user-agent": o.ua ?? BROWSER };
  if (o.dnt) headers.dnt = "1";
  const r = await fetch(`${base}/api/public/stores/${label}/visit`, { method: "POST", headers });
  return { status: r.status, body: await r.text() };
}

async function liveStore(name: string, label: string) {
  const owner = await makeUser();
  const store = await makeStore(owner.id, name);
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label } });
  await publishStore(store.id);
  return { owner, store };
}
const todayKey = () => tehranDayKey(new Date());
const statOf = (storeId: string) => prisma.storeDailyStat.findMany({ where: { storeId }, select: { views: true, visitors: true, day: true } });

describe("POST /public/stores/:label/visit", () => {
  it("counts every page view and each visitor once per day; the response is always an empty 204", async () => {
    const { store } = await liveStore("الف", "shopa");
    expect(await visit("shopa", { ip: "203.0.113.1" })).toEqual({ status: 204, body: "" });
    await visit("shopa", { ip: "203.0.113.1" }); // the same visitor again
    await visit("shopa", { ip: "203.0.113.1", ua: BROWSER + " other" }); // another browser = another visitor
    await visit("shopa", { ip: "203.0.113.2" });
    const [s] = await statOf(store.id);
    expect([s!.views, s!.visitors, s!.day.toISOString().slice(0, 10)]).toEqual([4, 3, todayKey()]);
    expect(await prisma.storeDailyVisitor.count({ where: { storeId: store.id } })).toBe(3);
  });

  it("stores only one-way hashes: no address or browser string anywhere in the tables", async () => {
    const { store } = await liveStore("الف", "shopa");
    await visit("shopa", { ip: "198.51.100.77", ua: "UniqueBrowser/9.9 (marker)" });
    const rows = JSON.stringify(await prisma.storeDailyVisitor.findMany({ where: { storeId: store.id } }));
    expect(rows).not.toContain("198.51.100.77");
    expect(rows).not.toContain("UniqueBrowser");
    expect((await prisma.storeDailyVisitor.findFirstOrThrow()).hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not count bots, Do-Not-Track, an empty browser string, unknown or unpublished stores (still 204)", async () => {
    const { store } = await liveStore("الف", "shopa");
    const draftOwner = await makeUser();
    const draft = await makeStore(draftOwner.id, "پیش‌نویس");
    await prisma.domain.create({ data: { storeId: draft.id, kind: "SUBDOMAIN", host: "draftshop" } });
    for (const r of [
      await visit("shopa", { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
      await visit("shopa", { ua: "curl/8.0" }),
      await visit("shopa", { ua: "" }),
      await visit("shopa", { dnt: true }),
      await visit("nosuchstore"),
      await visit("draftshop"),
    ]) expect(r).toEqual({ status: 204, body: "" });
    expect(await statOf(store.id)).toEqual([]);
    expect(await statOf(draft.id)).toEqual([]);
  });

  it("a suspended store is not counted", async () => {
    const { store } = await liveStore("الف", "shopa");
    await prisma.store.update({ where: { id: store.id }, data: { suspendedAt: new Date() } });
    await visit("shopa");
    expect(await statOf(store.id)).toEqual([]);
  });

  it("only the store's own origin or the platform may post; another store's origin is refused", async () => {
    await liveStore("الف", "shopa");
    await liveStore("ب", "shopb");
    expect((await visit("shopa", { origin: "http://shopb.localhost:3000" })).status).toBe(403);
    expect((await visit("shopa", { origin: "https://evil.example" })).status).toBe(403);
  });

  it("concurrent views lose no increment", async () => {
    const { store } = await liveStore("الف", "shopa");
    await Promise.all(Array.from({ length: 20 }, (_, i) => visit("shopa", { ip: `203.0.113.${(i % 4) + 10}` })));
    const [s] = await statOf(store.id);
    expect([s!.views, s!.visitors]).toEqual([20, 4]);
  });
});

describe("GET /stores/:id/analytics", () => {
  let n = 0;
  const order = (storeId: string, status: "PLACED" | "DELIVERED" | "CANCELLED" | "AWAITING_PAYMENT" | "EXPIRED", total: number, createdAt: Date) =>
    prisma.order.create({
      data: {
        storeId, number: ++n, status, paymentMethod: status === "AWAITING_PAYMENT" ? "ONLINE" : "COD", ...(status === "AWAITING_PAYMENT" ? { paymentGateway: "ZARINPAL", paymentDeadline: new Date(createdAt.getTime() + 3_600_000) } : {}), createdAt,
        requestKey: `an-${randomBytes(8).toString("hex")}`,
        accessTokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"),
        recipientName: "مریم احمدی", phone: "+989121234567", province: "tehran", city: "تهران", addressLine: "خیابان ولیعصر، پلاک ۸", postalCode: "1384567891",
        shippingName: "پیک", shippingKind: "FLAT", shippingCost: 0n, subtotal: BigInt(total), itemCount: 1, total: BigInt(total),
      },
    });
  const customer = (storeId: string, createdAt: Date, i: number) => prisma.customer.create({ data: { storeId, phone: `+98912000${String(i).padStart(4, "0")}`, createdAt } });
  const daysAgo = (d: number, h = 9) => new Date(Date.now() - d * 86_400_000 + (h - 9) * 3_600_000);

  it("lines up views, visitors, valid orders and sales, and new customers per day, with the previous period", async () => {
    const { owner, store } = await liveStore("الف", "shopa");
    const other = await liveStore("ب", "shopb");
    const today = todayKey();
    await prisma.storeDailyStat.createMany({ data: [{ storeId: store.id, day: new Date(`${today}T00:00:00Z`), views: 30, visitors: 10 }, { storeId: store.id, day: new Date(`${tehranDayKey(daysAgo(10))}T00:00:00Z`), views: 8, visitors: 4 }] });
    await prisma.storeDailyStat.create({ data: { storeId: other.store.id, day: new Date(`${today}T00:00:00Z`), views: 999, visitors: 99 } });
    await order(store.id, "PLACED", 1_000, daysAgo(0));
    await order(store.id, "DELIVERED", 2_500, daysAgo(0));
    await order(store.id, "CANCELLED", 7_000, daysAgo(0)); // not counted
    await order(store.id, "AWAITING_PAYMENT", 8_000, daysAgo(0)); // not counted
    await order(store.id, "EXPIRED", 9_000, daysAgo(0)); // not counted
    await order(store.id, "PLACED", 400, daysAgo(3));
    await order(store.id, "PLACED", 300, daysAgo(10)); // previous period of a 7-day range
    await order(store.id, "PLACED", 555_555, daysAgo(40)); // outside both periods
    await order(other.store.id, "PLACED", 123_456, daysAgo(0)); // another store
    await customer(store.id, daysAgo(0), 1);
    await customer(store.id, daysAgo(2), 2);
    await customer(store.id, daysAgo(9), 3);
    await customer(other.store.id, daysAgo(0), 4);

    const r = await report(await sessionOf(owner.id), store.id, "7");
    expect(r.status).toBe(200);
    const a = storeAnalyticsDto.parse(r.json);
    expect(a.series).toHaveLength(7);
    expect(a.series.at(-1)).toEqual({ day: today, views: 30, visitors: 10, orders: 2, sales: 3_500, customers: 1 });
    expect(a.series.find((d) => d.day === tehranDayKey(daysAgo(3)))).toMatchObject({ orders: 1, sales: 400, views: 0 });
    expect(a.totals.current).toEqual({ views: 30, visitors: 10, orders: 3, sales: 3_900, customers: 2 });
    expect(a.totals.previous).toEqual({ views: 8, visitors: 4, orders: 1, sales: 300, customers: 1 });
    expect([a.conversionPercent, a.trackingSince, a.to]).toEqual([30, tehranDayKey(daysAgo(10)), today]);
  });

  it("an order just after Tehran midnight belongs to the new Tehran day (UTC+03:30), not the UTC day", async () => {
    const { owner, store } = await liveStore("الف", "shopa");
    const today = todayKey();
    // 00:10 Tehran today = 20:40 UTC yesterday
    const justAfterMidnight = new Date(Date.parse(`${today}T00:10:00Z`) - 210 * 60_000);
    const justBefore = new Date(justAfterMidnight.getTime() - 20 * 60_000); // 23:50 Tehran yesterday
    await order(store.id, "PLACED", 100, justAfterMidnight);
    await order(store.id, "PLACED", 50, justBefore);
    const a = storeAnalyticsDto.parse((await report(await sessionOf(owner.id), store.id, "7")).json);
    expect(a.series.at(-1)).toMatchObject({ day: today, orders: 1, sales: 100 });
    expect(a.series.at(-2)).toMatchObject({ orders: 1, sales: 50 });
  });

  it("a store with no data returns zeros and no tracking date; days defaults to 30; other ranges are refused", async () => {
    const { owner, store } = await liveStore("الف", "shopa");
    const cookie = await sessionOf(owner.id);
    const a = storeAnalyticsDto.parse((await report(cookie, store.id, null)).json);
    expect([a.days, a.series.length, a.trackingSince, a.conversionPercent, a.totals.current]).toEqual([30, 30, null, null, { views: 0, visitors: 0, orders: 0, sales: 0, customers: 0 }]);
    expect((await report(cookie, store.id, "90")).json.series).toHaveLength(90);
    for (const bad of ["8", "0", "abc", "1000"]) expect((await report(cookie, store.id, bad)).status).toBe(400);
  });

  it("roles: owner and manager read it, an operator is refused, a stranger gets 404, no session 401", async () => {
    const { owner, store } = await liveStore("الف", "shopa");
    const manager = await makeUser();
    const operator = await makeUser();
    const stranger = await makeUser();
    await prisma.storeMember.createMany({ data: [{ storeId: store.id, userId: manager.id, role: "MANAGER" }, { storeId: store.id, userId: operator.id, role: "OPERATOR" }] });
    expect((await report(await sessionOf(owner.id), store.id)).status).toBe(200);
    expect((await report(await sessionOf(manager.id), store.id)).status).toBe(200);
    expect((await report(await sessionOf(operator.id), store.id)).status).toBe(403);
    expect((await report(await sessionOf(stranger.id), store.id)).status).toBe(404);
    expect((await report("", store.id)).status).toBe(401);
  });
});

describe("db-cleanup", () => {
  it("deletes visitor hashes older than two days and counters older than 400 days, and nothing newer", async () => {
    const { store } = await liveStore("الف", "shopa");
    const d = (ago: number) => new Date(`${tehranDayKey(new Date(Date.now() - ago * 86_400_000))}T00:00:00Z`);
    const h = (c: string) => c.repeat(64);
    await prisma.storeDailyVisitor.createMany({ data: [{ storeId: store.id, day: d(0), hash: h("a") }, { storeId: store.id, day: d(1), hash: h("b") }, { storeId: store.id, day: d(5), hash: h("c") }] });
    await prisma.storeDailyStat.createMany({ data: [{ storeId: store.id, day: d(5), views: 1, visitors: 1 }, { storeId: store.id, day: d(500), views: 1, visitors: 1 }] });
    expect(await purgeAnalytics()).toEqual({ visitors: 1, stats: 1 });
    expect((await prisma.storeDailyVisitor.findMany({ orderBy: { hash: "asc" } })).map((v) => v.hash[0])).toEqual(["a", "b"]);
    expect(await prisma.storeDailyStat.count()).toBe(1);
  });
});
