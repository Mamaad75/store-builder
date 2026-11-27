import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { hashPassword } from "../../auth/password.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, publishStore, resetDb } from "../../test/db-helpers.js";

/** The super admin's read-only views on real PostgreSQL over HTTP: the dashboard figures, accounts, one store in detail, the activity log. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
let app: NestExpressApplication | undefined;
let base = "";
let n = 0;
beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe(`TRUNCATE "Plan" CASCADE`);
  ({ app, base } = await listenFetchable(() => createApp(config)));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

async function call(cookie: string, path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, "x-forwarded-for": `10.6.0.${(++n % 250) + 1}`, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const cookieOf = async (userId: string) => `sb_session=${await sessions.sign({ userId, authVersion: 0 })}`;
async function staff() {
  const u = await prisma.user.create({ data: { username: `staff_${++n}`, name: "پشتیبان", passwordHash: await hashPassword("staff-password-123") } });
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await cookieOf(u.id) };
}
async function merchant(name = "فروشگاه") {
  const user = await makeUser();
  const store = await makeStore(user.id, name);
  return { user, storeId: store.id, cookie: await cookieOf(user.id) };
}

describe("access", () => {
  it("every view is for super admins only", async () => {
    const m = await merchant();
    for (const path of ["/platform/dashboard", "/platform/accounts", `/platform/accounts/${m.user.id}`, `/platform/stores/${m.storeId}/detail`, "/platform/activity"]) {
      expect((await call(m.cookie, path)).status, path).toBe(403);
      expect((await call("", path)).status, `${path} anonymous`).toBe(401);
    }
  });
});

describe("dashboard", () => {
  it("counts new stores, users, tickets and cash per Tehran day, with today's figures", async () => {
    const s = await staff();
    const a = await merchant("الف");
    const b = await merchant("ب");
    await prisma.supportTicket.create({ data: { storeId: a.storeId, createdById: a.user.id, subject: "مشکل", messageCount: 1 } });
    const answered = await prisma.supportTicket.create({ data: { storeId: b.storeId, createdById: b.user.id, subject: "پرسش", status: "ANSWERED", messageCount: 1 } });
    void answered;
    const plan = await prisma.plan.create({ data: { name: "ماهانه", priceToman: 500_000, durationDays: 30 } });
    const now = new Date();
    await prisma.subscriptionPurchase.create({ data: { storeId: a.storeId, planId: plan.id, planName: "ماهانه", priceToman: 500_000, discountToman: 50_000, walletUsedToman: 0, cashToman: 450_000, periodStart: now, periodEnd: new Date(now.getTime() + 30 * 86_400_000), recordedById: s.id } });
    await prisma.storeSubscription.create({ data: { storeId: a.storeId, planId: plan.id, planName: "ماهانه", startsAt: now, endsAt: new Date(now.getTime() + 3 * 86_400_000) } });
    await prisma.storeSubscription.create({ data: { storeId: b.storeId, planId: plan.id, planName: "ماهانه", startsAt: now, endsAt: new Date(now.getTime() + 60 * 86_400_000) } });
    await prisma.storeWallet.create({ data: { storeId: a.storeId, balanceToman: 45_000 } });
    await publishStore(b.storeId);
    await prisma.store.update({ where: { id: b.storeId }, data: { suspendedAt: now } });

    const d = (await call(s.cookie, "/platform/dashboard?days=7")).json;
    expect(d.days).toBe(7);
    expect(d.series).toHaveLength(7);
    expect(d.totals.current).toMatchObject({ newStores: 2, newUsers: 3, tickets: 2, revenue: 450_000, purchases: 1 }); // 2 merchants + the staff account
    const today = d.series.at(-1);
    expect(today).toMatchObject({ newStores: 2, tickets: 2, revenue: 450_000, purchases: 1 });
    expect(d.totals.previous).toMatchObject({ newStores: 0, revenue: 0 });
    expect(d.figures).toMatchObject({ users: 3, stores: 2, publishedStores: 1, suspendedStores: 1, openTickets: 1, answeredTickets: 1, activeSubscriptions: 2, expiringSoon: 1, walletOutstandingToman: 45_000 });
    expect((await call(s.cookie, "/platform/dashboard")).json.days).toBe(30);
    expect((await call(s.cookie, "/platform/dashboard?days=14")).status).toBe(400);
  });

  it("puts an event at 23:30 Tehran time on the Tehran day it belongs to, not the UTC one", async () => {
    const s = await staff();
    const a = await merchant("الف");
    const plan = await prisma.plan.create({ data: { name: "ماهانه", priceToman: 100, durationDays: 30 } });
    // yesterday 23:30 Tehran = yesterday 20:00 UTC; and today 00:10 Tehran = yesterday 20:40 UTC (a different Tehran day, the same UTC day)
    const todayTehran = new Date(Date.now() + 210 * 60_000).toISOString().slice(0, 10);
    const startOfToday = new Date(Date.parse(`${todayTehran}T00:00:00Z`) - 210 * 60_000);
    const mk = (at: Date, cash: number) => prisma.subscriptionPurchase.create({ data: { storeId: a.storeId, planId: plan.id, planName: "ماهانه", priceToman: cash, discountToman: 0, walletUsedToman: 0, cashToman: cash, periodStart: at, periodEnd: new Date(at.getTime() + 86_400_000), recordedById: s.id, createdAt: at } });
    await mk(new Date(startOfToday.getTime() - 30 * 60_000), 1_000); // 23:30 yesterday (Tehran)
    await mk(new Date(startOfToday.getTime() + 10 * 60_000), 7); // 00:10 today (Tehran)
    const d = (await call(s.cookie, "/platform/dashboard?days=7")).json;
    expect(d.series.at(-1)).toMatchObject({ revenue: 7, purchases: 1 });
    expect(d.series.at(-2)).toMatchObject({ revenue: 1_000, purchases: 1 });
  });
});

describe("accounts and stores", () => {
  it("lists accounts newest first, searches by username or name (wildcards are plain characters), and shows one with its stores", async () => {
    const s = await staff();
    await prisma.user.create({ data: { username: "ali_shop", name: "علی رضایی", passwordHash: "x" } });
    const sara = await prisma.user.create({ data: { username: "sara_100", name: "سارا", passwordHash: "x" } });
    const store = await makeStore(sara.id, "گل‌فروشی سارا");
    expect((await call(s.cookie, "/platform/accounts")).json.length).toBe(3);
    expect((await call(s.cookie, "/platform/accounts?q=ALI")).json.map((a: any) => a.username)).toEqual(["ali_shop"]);
    expect((await call(s.cookie, `/platform/accounts?q=${encodeURIComponent("رضایی")}`)).json).toHaveLength(1);
    expect((await call(s.cookie, "/platform/accounts?q=%25")).json).toEqual([]); // "%" matches nothing, not everything
    expect((await call(s.cookie, "/platform/accounts?q=_")).json.map((a: any) => a.username)).toEqual(expect.arrayContaining(["ali_shop", "sara_100"])); // "_" is in real names
    expect((await call(s.cookie, "/platform/accounts?q=s%5Fr")).json).toEqual([]); // an escaped "_" does not stand for any character
    const row = (await call(s.cookie, "/platform/accounts?q=sara")).json[0];
    expect(row).toMatchObject({ stores: 1, isPlatformAdmin: false });
    expect(row).not.toHaveProperty("passwordHash");
    expect((await call(s.cookie, "/platform/accounts?q=staff_")).json[0].isPlatformAdmin).toBe(true);
    const detail = (await call(s.cookie, `/platform/accounts/${sara.id}`)).json;
    expect(detail.ownedStores).toMatchObject([{ id: store.id, name: "گل‌فروشی سارا" }]);
    expect(JSON.stringify(detail)).not.toContain("passwordHash");
    expect((await call(s.cookie, "/platform/accounts/nope")).status).toBe(404);
    expect((await call(s.cookie, "/platform/accounts?limit=1000")).status).toBe(400);
  });

  it("shows a store's counts and subscription, but never an order value or a customer's data", async () => {
    const s = await staff();
    const m = await merchant("گل‌فروشی");
    await prisma.product.createMany({ data: [
      { storeId: m.storeId, name: "الف", slug: "a", searchKey: "الف", price: 5, stockQuantity: 1, status: "ACTIVE" },
      { storeId: m.storeId, name: "ب", slug: "b", searchKey: "ب", price: 5, stockQuantity: 1, status: "DRAFT" },
    ] });
    await prisma.customer.create({ data: { storeId: m.storeId, phone: "+989121112233", name: "مشتری محرمانه" } });
    await prisma.blogPost.create({ data: { storeId: m.storeId, title: "مقاله", slug: "m", body: "متن مقاله برای آزمون", status: "PUBLISHED", publishedAt: new Date() } });
    const plan = await prisma.plan.create({ data: { name: "ماهانه", priceToman: 1, durationDays: 30 } });
    await prisma.storeSubscription.create({ data: { storeId: m.storeId, planId: plan.id, planName: "ماهانه", startsAt: new Date(), endsAt: new Date(Date.now() + 5 * 86_400_000) } });
    const d = (await call(s.cookie, `/platform/stores/${m.storeId}/detail`)).json;
    expect(d).toMatchObject({ name: "گل‌فروشی", suspended: false, owner: { id: m.user.id }, subscription: { planName: "ماهانه" }, walletBalanceToman: 0, theme: { key: "general" } });
    expect(d.counts).toMatchObject({ productsActive: 1, productsOther: 1, orders: 0, customers: 1, publishedPosts: 1, pendingReviews: 0, openTickets: 0 });
    const text = JSON.stringify(d);
    expect(text).not.toContain("9121112233");
    expect(text).not.toContain("مشتری محرمانه");
    expect((await call(s.cookie, "/platform/stores/nope/detail")).status).toBe(404);
  });
});

describe("the platform activity log", () => {
  it("shows what super admins did, with their username, a group filter and only safe details; never a store's own log", async () => {
    const s = await staff();
    const m = await merchant();
    await call(s.cookie, "/platform/plans", "POST", { name: "ماهانه", priceToman: 100_000, durationDays: 30 });
    const plan = (await call(s.cookie, "/platform/plans")).json[0];
    await call(s.cookie, `/platform/stores/${m.storeId}/purchases`, "POST", { planId: plan.id, note: "یادداشت محرمانه ۹۹۹" });
    await call(s.cookie, `/platform/stores/${m.storeId}/wallet-adjust`, "POST", { amountToman: 500, reason: "دلیل محرمانه ۷۷۷" });
    await prisma.auditEvent.create({ data: { storeId: m.storeId, actorId: m.user.id, action: "product.created" } }); // a store's own event
    await expect.poll(async () => (await call(s.cookie, "/platform/activity")).json.length).toBe(3);
    const all = (await call(s.cookie, "/platform/activity")).json;
    expect(all[0]).toMatchObject({ action: "platform.wallet_adjusted", actor: s.cookie ? expect.stringMatching(/^staff_/) : "", group: "money" });
    expect(all.map((a: any) => a.action)).not.toContain("product.created");
    expect(JSON.stringify(all)).not.toContain("passwordHash");
    const money = (await call(s.cookie, "/platform/activity?group=money")).json;
    expect(money).toHaveLength(3);
    expect((await call(s.cookie, "/platform/activity?group=support")).json).toEqual([]);
    expect((await call(s.cookie, "/platform/activity?group=bogus")).status).toBe(400);
    const page = (await call(s.cookie, `/platform/activity?limit=1&before=${encodeURIComponent(all[0].createdAt)}`)).json;
    expect(page).toHaveLength(1);
    expect(page[0].id).not.toBe(all[0].id);
  });
});
