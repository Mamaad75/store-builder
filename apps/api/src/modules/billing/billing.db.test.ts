import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { hashPassword } from "../../auth/password.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** Finance on real PostgreSQL over HTTP: plans, purchases, the wallet and its ledger, referrals. Money must always add up. */
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

const cookieOf = async (userId: string) => `sb_session=${await sessions.sign({ userId, authVersion: 0 })}`;
async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, "x-forwarded-for": `10.7.0.${(++n % 250) + 1}`, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
async function owner(name = "فروشگاه") {
  const user = await makeUser();
  const store = await makeStore(user.id, name);
  return { user, storeId: store.id, cookie: await cookieOf(user.id) };
}
async function staff() {
  const u = await prisma.user.create({ data: { username: `staff_${++n}`, name: "پشتیبان", passwordHash: await hashPassword("staff-password-123") } });
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await cookieOf(u.id) };
}
const mkPlan = async (s: { cookie: string }, over: Record<string, unknown> = {}) => (await call(s.cookie, "POST", "/platform/plans", { name: "ماهانه", description: "یک ماه", priceToman: 100_000, durationDays: 30, ...over })).json;
const buy = (s: { cookie: string }, storeId: string, planId: string, over: Record<string, unknown> = {}) => call(s.cookie, "POST", `/platform/stores/${storeId}/purchases`, { planId, ...over });
const balance = async (storeId: string) => (await prisma.storeWallet.findUnique({ where: { storeId } }))?.balanceToman ?? 0;
/** The ledger always explains the balance. */
async function ledgerAdds(storeId: string) {
  const sum = await prisma.walletEntry.aggregate({ where: { storeId }, _sum: { amountToman: true } });
  expect(sum._sum.amountToman ?? 0).toBe(await balance(storeId));
}

describe("plans", () => {
  it("staff create, change and archive plans; merchants see only active ones; nobody else can touch them", async () => {
    const s = await staff();
    const m = await owner();
    const p = await mkPlan(s);
    expect(p).toMatchObject({ name: "ماهانه", priceToman: 100_000, durationDays: 30, active: true });
    const archived = await mkPlan(s, { name: "قدیمی", priceToman: 5 });
    expect((await call(s.cookie, "PUT", `/platform/plans/${archived.id}`, { name: "قدیمی", priceToman: 5, durationDays: 30, active: false })).json.active).toBe(false);
    expect((await call(s.cookie, "GET", "/platform/plans")).json).toHaveLength(2);
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.plans.map((x: any) => x.name)).toEqual(["ماهانه"]);
    for (const [method, path, body] of [["GET", "/platform/plans"], ["POST", "/platform/plans", { name: "x", priceToman: 1, durationDays: 1 }], ["PUT", `/platform/plans/${p.id}`, { name: "xx", priceToman: 1, durationDays: 1 }]] as const) {
      expect((await call(m.cookie, method, path, body)).status, path).toBe(403);
    }
    expect((await call(s.cookie, "POST", "/platform/plans", { name: "منفی", priceToman: -5, durationDays: 30 })).status).toBe(400);
    expect((await call(s.cookie, "PUT", "/platform/plans/nope", { name: "پلن", priceToman: 1, durationDays: 1 })).status).toBe(404);
    await expect.poll(() => prisma.auditEvent.count({ where: { action: { in: ["platform.plan_created", "platform.plan_updated"] } } })).toBe(3);
  });

  it("stops at 20 plans, even when created simultaneously", async () => {
    const s = await staff();
    await prisma.plan.createMany({ data: Array.from({ length: 18 }, (_, i) => ({ name: `پلن ${i}`, priceToman: i, durationDays: 30 })) });
    const r = await Promise.all(Array.from({ length: 5 }, (_, i) => call(s.cookie, "POST", "/platform/plans", { name: `همزمان ${i}`, priceToman: 1, durationDays: 30 })));
    expect(r.filter((x) => x.status === 201)).toHaveLength(2);
    expect(await prisma.plan.count()).toBe(20);
  });
});

describe("purchases", () => {
  it("record the amounts, start the subscription, and a second purchase extends it from where it ends", async () => {
    const s = await staff();
    const m = await owner();
    const p = await mkPlan(s);
    const first = await buy(s, m.storeId, p.id, { note: "کارت به کارت ۱۲۳" });
    expect(first.status).toBe(201);
    expect(first.json.quote).toEqual({ price: 100_000, discount: 0, due: 100_000, walletUsed: 0, cash: 100_000, reward: 0 });
    const sub1 = await prisma.storeSubscription.findUniqueOrThrow({ where: { storeId: m.storeId } });
    expect(sub1.endsAt.getTime() - sub1.startsAt.getTime()).toBe(30 * 86_400_000);
    await buy(s, m.storeId, p.id);
    const sub2 = await prisma.storeSubscription.findUniqueOrThrow({ where: { storeId: m.storeId } });
    expect(sub2.endsAt.getTime()).toBe(sub1.endsAt.getTime() + 30 * 86_400_000); // extended, nothing lost
    const view = (await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json;
    expect(view.state.kind).toBe("active");
    expect(view.purchases).toHaveLength(2);
    expect(view.purchases[1].note).toBe("کارت به کارت ۱۲۳");
    expect(view.purchases[0]).not.toHaveProperty("recordedById"); // staff identity is not shown to the merchant
  });

  it("refuse a missing store, a missing plan and an archived plan; a merchant cannot record a purchase", async () => {
    const s = await staff();
    const m = await owner();
    const p = await mkPlan(s);
    const old = await mkPlan(s, { name: "قدیمی" });
    await call(s.cookie, "PUT", `/platform/plans/${old.id}`, { name: "قدیمی", priceToman: 100_000, durationDays: 30, active: false });
    expect((await buy(s, "nostore", p.id)).status).toBe(404);
    expect((await buy(s, m.storeId, "noplan")).status).toBe(400);
    const r = await buy(s, m.storeId, old.id);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain("غیرفعال");
    expect((await buy(m, m.storeId, p.id)).status).toBe(403);
    expect(await prisma.subscriptionPurchase.count()).toBe(0);
  });

  it("only the owner sees the finance pages: a manager, an operator and another store's owner are refused", async () => {
    const a = await owner("الف");
    const b = await owner("ب");
    const mgr = await makeUser();
    await prisma.storeMember.create({ data: { storeId: a.storeId, userId: mgr.id, role: "MANAGER" } });
    for (const path of ["billing", "wallet", "referral"]) {
      expect((await call(a.cookie, "GET", `/stores/${a.storeId}/${path}`)).status, path).toBe(200);
      expect((await call(await cookieOf(mgr.id), "GET", `/stores/${a.storeId}/${path}`)).status, `manager ${path}`).toBe(403);
      expect((await call(b.cookie, "GET", `/stores/${a.storeId}/${path}`)).status, `other ${path}`).toBe(404);
    }
  });
});

describe("the wallet", () => {
  it("staff add and remove credit with a reason; it never goes below zero or above the ceiling; the ledger explains the balance", async () => {
    const s = await staff();
    const m = await owner();
    const adj = (amountToman: number, reason = "هدیهٔ پشتیبانی") => call(s.cookie, "POST", `/platform/stores/${m.storeId}/wallet-adjust`, { amountToman, reason });
    expect((await adj(50_000)).json).toEqual({ balanceToman: 50_000 });
    expect((await adj(-20_000)).json).toEqual({ balanceToman: 30_000 });
    const over = await adj(-30_001);
    expect(over.status).toBe(400);
    expect(JSON.stringify(over.json)).toContain("کافی");
    expect((await adj(0)).status).toBe(400);
    expect((await adj(10, "")).status).toBe(400);
    expect((await adj(1_000_000_000)).status).toBe(200);
    const full = await adj(1_000_000_000);
    expect(full.status).toBe(400); // 1,000,030,000 + 1,000,000,000 is over the 2,000,000,000 ceiling
    expect(JSON.stringify(full.json)).toContain("سقف");
    expect(await balance(m.storeId)).toBe(1_000_030_000);
    await ledgerAdds(m.storeId);
    const view = (await call(m.cookie, "GET", `/stores/${m.storeId}/wallet`)).json;
    expect(view.balanceToman).toBe(await balance(m.storeId));
    expect(view.entries[0].balanceAfter).toBe(view.balanceToman);
    expect((await call(m.cookie, "POST", `/platform/stores/${m.storeId}/wallet-adjust`, { amountToman: 5, reason: "جعلی" })).status).toBe(403);
  });

  it("many simultaneous adjustments and purchases never lose or invent money", async () => {
    const s = await staff();
    const m = await owner();
    const p = await mkPlan(s, { priceToman: 10_000 });
    await call(s.cookie, "POST", `/platform/stores/${m.storeId}/wallet-adjust`, { amountToman: 35_000, reason: "اعتبار اولیه" });
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () => buy(s, m.storeId, p.id, { useWallet: true })),
      ...Array.from({ length: 4 }, () => call(s.cookie, "POST", `/platform/stores/${m.storeId}/wallet-adjust`, { amountToman: 1_000, reason: "افزایش همزمان" })),
    ]);
    expect(results.every((r) => r.status < 300)).toBe(true);
    expect(await balance(m.storeId)).toBeGreaterThanOrEqual(0);
    await ledgerAdds(m.storeId);
    const purchases = await prisma.subscriptionPurchase.findMany({ where: { storeId: m.storeId } });
    expect(purchases).toHaveLength(6);
    for (const x of purchases) expect(x.walletUsedToman + x.cashToman).toBe(x.priceToman - x.discountToman);
    expect(purchases.reduce((t, x) => t + x.walletUsedToman, 0)).toBe(35_000 + 4_000 - (await balance(m.storeId)));
  });
});

describe("referrals", () => {
  it("each store has one stable code; a link is just that code", async () => {
    const m = await owner();
    const a = (await call(m.cookie, "GET", `/stores/${m.storeId}/referral`)).json;
    const b = (await call(m.cookie, "GET", `/stores/${m.storeId}/referral`)).json;
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(b.code).toBe(a.code);
    expect(a).toMatchObject({ percent: 10, referrals: [], referredBy: null });
    const sims = await Promise.all(Array.from({ length: 5 }, async () => (await call((await owner()).cookie, "GET", "/billing-never")).status)); // unrelated route: 404, no effect
    expect(sims.every((x) => x === 404)).toBe(true);
    const fresh = await owner();
    const codes = await Promise.all(Array.from({ length: 6 }, () => call(fresh.cookie, "GET", `/stores/${fresh.storeId}/referral`)));
    expect(new Set(codes.map((c) => c.json.code)).size).toBe(1); // simultaneous first requests share one code
    expect(await prisma.storeReferralCode.count({ where: { storeId: fresh.storeId } })).toBe(1);
  });

  it("the invited store gets 10% off its first paid purchase and the inviter earns 10% of it as credit, once", async () => {
    const s = await staff();
    const inviter = await owner("دعوت‌کننده");
    const invited = await owner("دعوت‌شده");
    const p = await mkPlan(s, { priceToman: 500_000 });
    const code = (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/referral`)).json.code;
    const redeem = await call(invited.cookie, "POST", `/stores/${invited.storeId}/referral/redeem`, { code: ` ${code.toLowerCase()} ` });
    expect(redeem.status).toBe(204);
    expect((await call(invited.cookie, "GET", `/stores/${invited.storeId}/billing`)).json.referralDiscountPercent).toBe(10);

    const first = await buy(s, invited.storeId, p.id);
    expect(first.json.quote).toEqual({ price: 500_000, discount: 50_000, due: 450_000, walletUsed: 0, cash: 450_000, reward: 45_000 });
    expect(await balance(inviter.storeId)).toBe(45_000);
    const ref = (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/referral`)).json;
    expect(ref.referrals[0]).toMatchObject({ status: "REWARDED", rewardToman: 45_000 });
    expect((await call(invited.cookie, "GET", `/stores/${invited.storeId}/billing`)).json.referralDiscountPercent).toBe(0);
    const entry = (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/wallet`)).json.entries[0];
    expect(entry).toMatchObject({ amountToman: 45_000, kind: "REFERRAL_REWARD", balanceAfter: 45_000 });

    // the second purchase is at full price and earns nothing
    const second = await buy(s, invited.storeId, p.id);
    expect(second.json.quote).toMatchObject({ discount: 0, due: 500_000, reward: 0 });
    expect(await balance(inviter.storeId)).toBe(45_000);
    await ledgerAdds(inviter.storeId);
    // the inviter can spend the credit on their own subscription
    const own = await buy(s, inviter.storeId, p.id, { useWallet: true });
    expect(own.json.quote).toMatchObject({ walletUsed: 45_000, cash: 455_000 });
    expect(await balance(inviter.storeId)).toBe(0);
    await ledgerAdds(inviter.storeId);
  });

  it("a free plan does not use up the invitation; the reward counts a purchase paid from the wallet too", async () => {
    const s = await staff();
    const inviter = await owner();
    const invited = await owner();
    const free = await mkPlan(s, { name: "آزمایشی", priceToman: 0, durationDays: 7 });
    const paid = await mkPlan(s, { priceToman: 200_000 });
    await call(invited.cookie, "POST", `/stores/${invited.storeId}/referral/redeem`, { code: (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/referral`)).json.code });
    expect((await buy(s, invited.storeId, free.id)).json.quote).toMatchObject({ discount: 0, reward: 0 });
    expect((await prisma.referral.findFirstOrThrow()).status).toBe("PENDING");
    await call(s.cookie, "POST", `/platform/stores/${invited.storeId}/wallet-adjust`, { amountToman: 1_000_000, reason: "اعتبار" });
    const r = await buy(s, invited.storeId, paid.id, { useWallet: true });
    expect(r.json.quote).toEqual({ price: 200_000, discount: 20_000, due: 180_000, walletUsed: 180_000, cash: 0, reward: 18_000 });
    expect(await balance(inviter.storeId)).toBe(18_000);
    expect(await balance(invited.storeId)).toBe(820_000);
    await ledgerAdds(invited.storeId);
  });

  it("refuses your own code, a sibling store's code, an unknown code, a second code, and a code after a paid purchase", async () => {
    const s = await staff();
    const a = await owner();
    const b = await owner();
    const sibling = await makeStore(a.user.id, "فروشگاه دوم");
    const p = await mkPlan(s);
    const codeA = (await call(a.cookie, "GET", `/stores/${a.storeId}/referral`)).json.code;
    const codeB = (await call(b.cookie, "GET", `/stores/${b.storeId}/referral`)).json.code;
    const redeem = (c: { cookie: string }, storeId: string, code: string) => call(c.cookie, "POST", `/stores/${storeId}/referral/redeem`, { code });
    const own = await redeem(a, a.storeId, codeA);
    expect(own.status).toBe(400);
    expect(JSON.stringify(own.json)).toContain("خودتان");
    expect(JSON.stringify((await redeem(a, sibling.id, codeA)).json)).toContain("دیگرِ خودتان");
    expect((await redeem(a, a.storeId, "ZZZZZZZZ")).status).toBe(400);
    expect((await redeem(a, a.storeId, "کوتاه")).status).toBe(400);
    expect((await redeem(a, a.storeId, codeB)).status).toBe(204);
    expect(JSON.stringify((await redeem(a, a.storeId, codeB)).json)).toContain("قبلاً");
    // b already paid once: too late
    await buy(s, b.storeId, p.id);
    expect(JSON.stringify((await redeem(b, b.storeId, codeA)).json)).toContain("پیش از اولین خرید");
    expect(await prisma.referral.count()).toBe(1);
    // another store's owner cannot enter a code for a store that is not theirs
    expect((await redeem(b, a.storeId, codeB)).status).toBe(404);
  });

  it("an invitation and a first purchase happening together end consistently", async () => {
    const s = await staff();
    const inviter = await owner();
    const invited = await owner();
    const p = await mkPlan(s, { priceToman: 100_000 });
    const code = (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/referral`)).json.code;
    const [r, b] = await Promise.all([call(invited.cookie, "POST", `/stores/${invited.storeId}/referral/redeem`, { code }), buy(s, invited.storeId, p.id)]);
    expect(b.status).toBe(201);
    const refs = await prisma.referral.findMany();
    if (r.status === 204) {
      // the code won the race: then the purchase got the discount and paid the reward, or the purchase came first and the code was refused
      expect(refs).toHaveLength(1);
      expect(refs[0]!.status === "REWARDED" ? await balance(inviter.storeId) : 0).toBe(refs[0]!.rewardToman);
    } else {
      expect(refs).toHaveLength(0);
      expect(await balance(inviter.storeId)).toBe(0);
    }
    await ledgerAdds(inviter.storeId);
    await ledgerAdds(invited.storeId);
  });

  it("two stores that invited each other cannot deadlock the money", async () => {
    const s = await staff();
    const a = await owner();
    const b = await owner();
    const p = await mkPlan(s, { priceToman: 100_000 });
    const codeA = (await call(a.cookie, "GET", `/stores/${a.storeId}/referral`)).json.code;
    const codeB = (await call(b.cookie, "GET", `/stores/${b.storeId}/referral`)).json.code;
    await call(a.cookie, "POST", `/stores/${a.storeId}/referral/redeem`, { code: codeB });
    await call(b.cookie, "POST", `/stores/${b.storeId}/referral/redeem`, { code: codeA });
    const r = await Promise.all([buy(s, a.storeId, p.id), buy(s, b.storeId, p.id), buy(s, a.storeId, p.id, { useWallet: true }), buy(s, b.storeId, p.id, { useWallet: true })]);
    expect(r.every((x) => x.status === 201)).toBe(true);
    await ledgerAdds(a.storeId);
    await ledgerAdds(b.storeId);
    expect(await balance(a.storeId)).toBeGreaterThanOrEqual(0);
    expect(await balance(b.storeId)).toBeGreaterThanOrEqual(0);
  });
});

describe("audit and cleanup", () => {
  it("every money action is audited without the merchant's notes; the merchant's own redeem is in their log; deleting a store deletes its finance rows", async () => {
    const s = await staff();
    const inviter = await owner();
    const invited = await owner();
    const p = await mkPlan(s, { priceToman: 100_000 });
    await call(invited.cookie, "POST", `/stores/${invited.storeId}/referral/redeem`, { code: (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/referral`)).json.code });
    await buy(s, invited.storeId, p.id, { note: "شمارهٔ پیگیری محرمانه ۹۹۹" });
    await call(s.cookie, "POST", `/platform/stores/${invited.storeId}/wallet-adjust`, { amountToman: 1000, reason: "دلیل محرمانهٔ ۷۷۷" });
    await expect.poll(() => prisma.auditEvent.count({ where: { action: { in: ["platform.purchase_recorded", "platform.wallet_adjusted"] } } })).toBe(2);
    const purchase = await prisma.auditEvent.findFirstOrThrow({ where: { action: "platform.purchase_recorded" } });
    expect(purchase).toMatchObject({ actorId: s.id, storeId: null, targetId: invited.storeId });
    expect(purchase.metadata).toMatchObject({ priceToman: 100_000, discountToman: 10_000, cashToman: 90_000, rewardToman: 9_000, rewardedStoreId: inviter.storeId });
    expect(JSON.stringify(await prisma.auditEvent.findMany())).not.toContain("محرمانه");
    await expect.poll(() => prisma.auditEvent.count({ where: { storeId: invited.storeId, action: "referral.redeemed" } })).toBe(1);
    await prisma.store.delete({ where: { id: invited.storeId } });
    expect(await prisma.storeSubscription.count({ where: { storeId: invited.storeId } })).toBe(0);
    expect(await prisma.subscriptionPurchase.count({ where: { storeId: invited.storeId } })).toBe(0);
    expect(await prisma.referral.count()).toBe(0);
  });

  it("the database refuses what the code never does: a negative balance, a purchase whose parts do not add up, a self-referral", async () => {
    const m = await owner();
    await prisma.storeWallet.create({ data: { storeId: m.storeId, balanceToman: 0 } });
    await expect(prisma.storeWallet.update({ where: { storeId: m.storeId }, data: { balanceToman: -1 } })).rejects.toThrow();
    const p = await prisma.plan.create({ data: { name: "پلن", priceToman: 100, durationDays: 30 } });
    await expect(prisma.subscriptionPurchase.create({ data: { storeId: m.storeId, planId: p.id, planName: "پلن", priceToman: 100, discountToman: 0, walletUsedToman: 10, cashToman: 10, periodStart: new Date(), periodEnd: new Date(), recordedById: "x" } })).rejects.toThrow();
    await expect(prisma.referral.create({ data: { referrerStoreId: m.storeId, referredStoreId: m.storeId } })).rejects.toThrow();
    await expect(prisma.plan.create({ data: { name: "بد", priceToman: -1, durationDays: 30 } })).rejects.toThrow();
  });
});

describe("plan limits", () => {
  const product = (m: { cookie: string; storeId: string }, i: number) => call(m.cookie, "POST", `/stores/${m.storeId}/products`, { name: `کالا ${i}`, price: 1000 });
  const fill = (storeId: string, count: number) => prisma.product.createMany({ data: Array.from({ length: count }, (_, i) => ({ storeId, name: `p${i}`, slug: `p${i}`, price: 1000, searchKey: `p${i}` })) });

  it("without a running subscription the free limit stops new products (existing ones stay); a plan raises it; an ended plan returns to the free limit", async () => {
    const s = await staff();
    const m = await owner();
    await fill(m.storeId, 30);
    const refused = await product(m, 31);
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ errorName: "PlanLimitError", payload: { kind: "product", limit: 30, free: true } });
    expect(await prisma.product.count({ where: { storeId: m.storeId } })).toBe(30);

    const plan = await mkPlan(s, { maxProducts: 35, maxStaff: 2 });
    expect((await buy(s, m.storeId, plan.id)).status).toBe(201);
    for (let i = 31; i <= 35; i++) expect((await product(m, i)).status, `product ${i}`).toBe(201);
    const full = await product(m, 36);
    expect(full.status).toBe(409);
    expect(full.json).toMatchObject({ errorName: "PlanLimitError", payload: { limit: 35, free: false } });

    // the period ends: back to the free limit (35 products are kept, none can be added)
    await prisma.storeSubscription.update({ where: { storeId: m.storeId }, data: { startsAt: new Date(Date.now() - 40 * 86_400_000), endsAt: new Date(Date.now() - 86_400_000) } });
    const after = await product(m, 36);
    expect(after.status).toBe(409);
    expect(after.json).toMatchObject({ errorName: "PlanLimitError", payload: { limit: 30, free: true } });
    expect(await prisma.product.count({ where: { storeId: m.storeId } })).toBe(35);
  });

  it("simultaneous product creation cannot pass the limit", async () => {
    const m = await owner();
    await fill(m.storeId, 28);
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => product(m, 100 + i)));
    expect(r.filter((x) => x.status === 201)).toHaveLength(2);
    expect(await prisma.product.count({ where: { storeId: m.storeId } })).toBe(30);
  });

  it("staff invitations follow the plan too: one on the free limit, more with a plan", async () => {
    const s = await staff();
    const m = await owner();
    const a = await makeUser();
    const b = await makeUser();
    const invite = (username: string) => call(m.cookie, "POST", `/stores/${m.storeId}/team/invitations`, { username, role: "OPERATOR" });
    expect((await invite(a.username)).status).toBe(201);
    const refused = await invite(b.username);
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ errorName: "PlanLimitError", payload: { kind: "staff", limit: 1, free: true } });
    const plan = await mkPlan(s, { maxStaff: 2 });
    await buy(s, m.storeId, plan.id);
    expect((await invite(b.username)).status).toBe(201);
  });

  it("the billing page reports the limits and what is used; plans carry their limits; bad limits are refused", async () => {
    const s = await staff();
    const m = await owner();
    await fill(m.storeId, 4);
    const free = (await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json;
    expect(free).toMatchObject({ free: true, limits: { maxProducts: 30, maxStaff: 1 }, usage: { products: 4, staff: 0 } });
    const plan = await mkPlan(s, { maxProducts: 100, maxStaff: 0 });
    expect(plan).toMatchObject({ maxProducts: 100, maxStaff: 0 });
    await buy(s, m.storeId, plan.id);
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json).toMatchObject({ free: false, limits: { maxProducts: 100, maxStaff: 0 } });
    for (const bad of [{ maxProducts: 0 }, { maxProducts: 501 }, { maxStaff: -1 }, { maxStaff: 21 }, { maxProducts: 1.5 }]) expect((await mkPlan(s, bad)).error ?? (await call(s.cookie, "POST", "/platform/plans", { name: "بد", priceToman: 1, durationDays: 30, ...bad })).status, JSON.stringify(bad)).toBeTruthy();
  });
});
