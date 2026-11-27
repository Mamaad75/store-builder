import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { hashPassword } from "../../auth/password.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import { PlatformPaymentsService } from "./application/payments.service.js";
import type { GatewayVerifyResult, PlatformGateway } from "./application/payment-ports.js";

/** A store paying the platform through the gateway (a fake Zarinpal): plans, wallet top-ups, verification, closing, late money. Money must always add up. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const MERCHANT = "1344b5d4-0048-11e8-94db-005056a205be";

class FakeZarinpal implements PlatformGateway {
  requests: Parameters<PlatformGateway["request"]>[0][] = [];
  verifies: { amountRial: number; authority: string; merchantId: string }[] = [];
  n = 0;
  requestOk = true;
  verifyResult: (v: { authority: string }) => GatewayVerifyResult = () => ({ outcome: "paid", code: 100, refId: String(500 + this.verifies.length), cardPan: "502229******5995", fee: 0 });
  inquiryStatus: "PAID" | "IN_BANK" | "FAILED" | "VERIFIED" | "REVERSED" | "unknown" = "IN_BANK";
  startUrl(_s: boolean, authority: string) {
    return `https://sandbox.zarinpal.com/pg/StartPay/${authority}`;
  }
  async request(r: Parameters<PlatformGateway["request"]>[0]) {
    this.requests.push(r);
    return this.requestOk ? { ok: true as const, authority: `S${String(++this.n).padStart(35, "0")}` } : { ok: false as const, code: -9 };
  }
  async verify(v: { amountRial: number; authority: string; merchantId: string }) {
    this.verifies.push(v);
    return this.verifyResult(v);
  }
  async inquiry() {
    return { status: this.inquiryStatus };
  }
}

let app: NestExpressApplication | undefined;
let base = "";
let n = 0;
let zp: FakeZarinpal;
beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe(`TRUNCATE "Plan" CASCADE`);
  await prisma.platformSetting.deleteMany();
  await prisma.platformSecret.deleteMany();
  zp = new FakeZarinpal();
  ({ app, base } = await listenFetchable(() => createApp(config, { paymentGateway: zp })));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

const cookieOf = async (userId: string) => `sb_session=${await sessions.sign({ userId, authVersion: 0 })}`;
async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, { method, headers: { origin: PLATFORM, "x-forwarded-for": `10.8.0.${(++n % 250) + 1}`, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
async function owner() {
  const user = await makeUser();
  const store = await makeStore(user.id, "فروشگاه");
  return { user, storeId: store.id, cookie: await cookieOf(user.id) };
}
async function staff() {
  const u = await prisma.user.create({ data: { username: `staff_${++n}`, name: "پشتیبان", passwordHash: await hashPassword("staff-password-123") } });
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await cookieOf(u.id) };
}
/** The platform's gateway switched on with its merchant id (what staff do in the settings). */
async function enableGateway(s: { cookie: string }) {
  expect((await call(s.cookie, "PATCH", "/platform/settings/payment", { zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: true })).status).toBe(200);
  expect((await call(s.cookie, "POST", "/platform/secrets/payment.zarinpal.merchant_id", { value: MERCHANT })).status).toBe(204);
}
const mkPlan = async (s: { cookie: string }, over: Record<string, unknown> = {}) => (await call(s.cookie, "POST", "/platform/plans", { name: "ماهانه", priceToman: 500_000, durationDays: 30, ...over })).json;
/** Add credit the way staff do (the balance and the ledger line that explains it). */
async function setWallet(storeId: string, amount: number) {
  const after = ((await prisma.storeWallet.findUnique({ where: { storeId } }))?.balanceToman ?? 0) + amount;
  await prisma.storeWallet.upsert({ where: { storeId }, create: { storeId, balanceToman: after, updatedAt: new Date() }, update: { balanceToman: after } });
  await prisma.walletEntry.create({ data: { storeId, amountToman: amount, balanceAfter: after, kind: "ADMIN_ADJUST", note: "test" } });
}
const balance = async (storeId: string) => (await prisma.storeWallet.findUnique({ where: { storeId } }))?.balanceToman ?? 0;
async function ledgerAdds(storeId: string) {
  const sum = await prisma.walletEntry.aggregate({ where: { storeId }, _sum: { amountToman: true } });
  expect(sum._sum.amountToman ?? 0).toBe(await balance(storeId));
}
const authorityOf = (r: { json: any }) => (r.json.url as string).split("/").pop()!;
const back = (m: { cookie: string; storeId: string }, authority: string, status: "OK" | "NOK" = "OK") => call(m.cookie, "POST", `/stores/${m.storeId}/billing/payments/verify`, { authority, status });
const age = (id: string, minutes: number) => prisma.platformPayment.update({ where: { id }, data: { createdAt: new Date(Date.now() - minutes * 60_000), nextCheckAt: new Date(Date.now() - 1000) } });

describe("paying for a plan", () => {
  it("without a working gateway only a purchase the wallet covers goes through", async () => {
    const s = await staff();
    const m = await owner();
    const plan = await mkPlan(s);
    const noWallet = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id });
    expect(noWallet.status).toBe(400);
    expect(noWallet.json.payload.fieldErrors.form[0]).toContain("پرداخت آنلاین فعلاً");
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.gatewayReady).toBe(false);
    await setWallet(m.storeId, 600_000);
    const ok = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ status: "activated", quote: { price: 500_000, walletUsed: 500_000, cash: 0 }, purchase: { cashToman: 0, walletUsedToman: 500_000 } });
    expect(await balance(m.storeId)).toBe(100_000);
    await ledgerAdds(m.storeId);
    expect(zp.requests).toHaveLength(0);
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.state.kind).toBe("active");
  });

  it("wallet credit first, the rest from the gateway: held when it opens, granted once when verified", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const plan = await mkPlan(s);
    await setWallet(m.storeId, 100_000);
    const start = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id });
    expect(start.status).toBe(200);
    expect(start.json).toMatchObject({ status: "redirect", payment: { purpose: "PURCHASE", amountToman: 400_000, walletHeldToman: 100_000, status: "CREATED" } });
    expect(zp.requests[0]).toMatchObject({ amountRial: 4_000_000, merchantId: MERCHANT, sandbox: true, callbackUrl: expect.stringContaining(`/dashboard/stores/${m.storeId}/billing/return`) });
    expect(await balance(m.storeId)).toBe(0); // held
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.state.kind).toBe("none"); // nothing is granted on the buyer's word
    const authority = authorityOf(start);

    const paid = await back(m, authority);
    expect(paid.json).toMatchObject({ outcome: "paid", payment: { status: "PAID", refId: "501" } });
    expect(zp.verifies[0]).toMatchObject({ amountRial: 4_000_000, merchantId: MERCHANT, authority });
    const billing = (await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json;
    expect(billing.state.kind).toBe("active");
    expect(billing.purchases[0]).toMatchObject({ priceToman: 500_000, walletUsedToman: 100_000, cashToman: 400_000 });
    expect(await prisma.subscriptionPurchase.count({ where: { storeId: m.storeId } })).toBe(1);

    // coming back again (reload, back button) grants nothing twice and does not ask the gateway again
    const again = await back(m, authority);
    expect(again.json.outcome).toBe("paid");
    expect(await prisma.subscriptionPurchase.count({ where: { storeId: m.storeId } })).toBe(1);
    expect(zp.verifies).toHaveLength(1);
    await ledgerAdds(m.storeId);
  });

  it("a failed or cancelled payment gives the held credit back; a forged cancel on a really paid payment is not believed", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const plan = await mkPlan(s);
    await setWallet(m.storeId, 100_000);
    // the buyer cancelled at the gateway ("NOK") and the gateway does not say paid: closed, the held credit is back
    zp.inquiryStatus = "IN_BANK";
    const a1 = authorityOf(await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id }));
    expect(await balance(m.storeId)).toBe(0);
    expect((await back(m, a1, "NOK")).json).toMatchObject({ outcome: "failed", payment: { status: "FAILED" } });
    expect(await balance(m.storeId)).toBe(100_000);
    await ledgerAdds(m.storeId);
    // the gateway itself says it failed
    const a2 = authorityOf(await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id }));
    zp.inquiryStatus = "FAILED";
    expect((await back(m, a2, "NOK")).json.outcome).toBe("failed");
    expect(await balance(m.storeId)).toBe(100_000);
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.state.kind).toBe("none");
    // a forged NOK on a payment that was really paid: the gateway says PAID, so it is verified and granted
    zp.inquiryStatus = "IN_BANK";
    const a3 = authorityOf(await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id }));
    zp.inquiryStatus = "PAID";
    expect((await back(m, a3, "NOK")).json.outcome).toBe("paid");
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.state.kind).toBe("active");
    await ledgerAdds(m.storeId);
  });

  it("a verify the gateway refuses grants nothing; 'not paid yet' leaves the payment open; a gateway that cannot be reached opens nothing", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const plan = await mkPlan(s);
    zp.requestOk = false;
    await setWallet(m.storeId, 50_000);
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id })).status).toBe(502);
    expect(await balance(m.storeId)).toBe(50_000); // the hold was returned
    expect(await prisma.platformPayment.findFirstOrThrow({ where: { storeId: m.storeId } })).toMatchObject({ status: "FAILED" });
    zp.requestOk = true;
    const a = authorityOf(await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id }));
    zp.verifyResult = () => ({ outcome: "pending", code: -51 });
    expect((await back(m, a)).json.outcome).toBe("pending");
    zp.verifyResult = () => ({ outcome: "unknown", code: null });
    expect((await back(m, a)).json.outcome).toBe("pending");
    expect(await prisma.platformPayment.findFirstOrThrow({ where: { authority: a } })).toMatchObject({ status: "CREATED" });
    zp.verifyResult = () => ({ outcome: "failed", code: -50 }); // the amount does not match: definite
    expect((await back(m, a)).json.outcome).toBe("failed");
    expect(await balance(m.storeId)).toBe(50_000);
    await ledgerAdds(m.storeId);
  });

  it("one open payment per store: a second start waits, an old one is settled or closed first; simultaneous starts open exactly one", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const plan = await mkPlan(s);
    const first = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id, useWallet: false });
    expect(first.status).toBe(200);
    const second = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id, useWallet: false });
    expect(second.status).toBe(400);
    expect(second.json.payload.fieldErrors.form[0]).toContain("هنوز باز است");
    const id = (await prisma.platformPayment.findFirstOrThrow({ where: { storeId: m.storeId } })).id;
    await age(id, 3);
    zp.inquiryStatus = "FAILED";
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id, useWallet: false })).status).toBe(200);
    expect(await prisma.platformPayment.count({ where: { storeId: m.storeId, status: "CREATED" } })).toBe(1);

    const m2 = await owner();
    const r = await Promise.all(Array.from({ length: 5 }, () => call(m2.cookie, "POST", `/stores/${m2.storeId}/billing/pay`, { planId: plan.id, useWallet: false })));
    expect(r.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await prisma.platformPayment.count({ where: { storeId: m2.storeId } })).toBe(1);
  });

  it("two simultaneous returns grant the plan once", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const plan = await mkPlan(s);
    await setWallet(m.storeId, 20_000);
    const a = authorityOf(await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id }));
    const r = await Promise.all(Array.from({ length: 4 }, () => back(m, a)));
    expect(r.every((x) => x.json.outcome === "paid")).toBe(true);
    expect(await prisma.subscriptionPurchase.count({ where: { storeId: m.storeId } })).toBe(1);
    const sub = await prisma.storeSubscription.findUniqueOrThrow({ where: { storeId: m.storeId } });
    expect(Math.round((sub.endsAt.getTime() - sub.startsAt.getTime()) / 86_400_000)).toBe(30);
    await ledgerAdds(m.storeId);
  });

  it("an invited store pays 10% less on its first purchase and its inviter earns 10% of what it paid, once", async () => {
    const s = await staff();
    await enableGateway(s);
    const inviter = await owner();
    const friend = await owner();
    const code = (await call(inviter.cookie, "GET", `/stores/${inviter.storeId}/referral`)).json.code;
    expect((await call(friend.cookie, "POST", `/stores/${friend.storeId}/referral/redeem`, { code })).status).toBe(204);
    const plan = await mkPlan(s);
    const start = await call(friend.cookie, "POST", `/stores/${friend.storeId}/billing/pay`, { planId: plan.id, useWallet: false });
    expect(start.json.payment).toMatchObject({ priceToman: 500_000, discountToman: 50_000, amountToman: 450_000 });
    const a = authorityOf(start);
    await back(friend, a);
    await back(friend, a);
    expect(await balance(inviter.storeId)).toBe(45_000);
    expect(await prisma.referral.findFirstOrThrow({ where: { referredStoreId: friend.storeId } })).toMatchObject({ status: "REWARDED", rewardToman: 45_000 });
    await ledgerAdds(inviter.storeId);
    // the second purchase has no discount any more
    const second = await call(friend.cookie, "POST", `/stores/${friend.storeId}/billing/pay`, { planId: plan.id, useWallet: false });
    expect(second.json.payment).toMatchObject({ discountToman: 0, amountToman: 500_000 });
  });

  it("a plan whose gateway part is out of the gateway's range is refused before anything is held", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const cheap = await mkPlan(s, { name: "ارزان", priceToman: 500 });
    const huge = await mkPlan(s, { name: "گران", priceToman: 150_000_000 });
    await setWallet(m.storeId, 10_000);
    for (const p of [cheap, huge]) expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: p.id, useWallet: false })).status).toBe(400);
    expect(await balance(m.storeId)).toBe(10_000);
    expect(await prisma.platformPayment.count()).toBe(0);
  });
});

describe("wallet top-up", () => {
  it("is credited once when verified; the amount must be sensible and fit the wallet", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    for (const amountToman of [5_000, 60_000_000, 12_345.5, -1]) expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/topup`, { amountToman })).status, String(amountToman)).toBe(400);
    const start = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/topup`, { amountToman: 150_000 });
    expect(start.json).toMatchObject({ status: "redirect", payment: { purpose: "TOPUP", amountToman: 150_000, walletHeldToman: 0 } });
    expect(zp.requests[0]!.amountRial).toBe(1_500_000);
    expect(await balance(m.storeId)).toBe(0);
    const a = authorityOf(start);
    expect((await back(m, a)).json.outcome).toBe("paid");
    await back(m, a);
    expect(await balance(m.storeId)).toBe(150_000);
    expect(await prisma.walletEntry.count({ where: { storeId: m.storeId, kind: "TOPUP" } })).toBe(1);
    await ledgerAdds(m.storeId);
    await setWallet(m.storeId, 1_990_000_000 - (await balance(m.storeId)));
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/topup`, { amountToman: 20_000_000 })).status).toBe(400);
  });

  it("a gateway that is switched off refuses it", async () => {
    const m = await owner();
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/topup`, { amountToman: 20_000 })).status).toBe(400);
  });
});

describe("closing what nobody finished, and money that arrives late", () => {
  it("the job grants what the gateway says is paid, closes the failed and the too old, and returns the held credit", async () => {
    const s = await staff();
    await enableGateway(s);
    const plan = await mkPlan(s);
    const [paid, failed, stale, young] = [await owner(), await owner(), await owner(), await owner()];
    const ids: string[] = [];
    for (const m of [paid, failed, stale, young]) {
      await setWallet(m.storeId, 30_000);
      expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id })).status).toBe(200);
      ids.push((await prisma.platformPayment.findFirstOrThrow({ where: { storeId: m.storeId } })).id);
    }
    await age(ids[0]!, 5);
    await age(ids[1]!, 5);
    await age(ids[2]!, 45);
    const svc = app!.get(PlatformPaymentsService);
    const by = (id: string) => ({ where: { id } });
    // a different answer per payment, keyed by the authority
    const auth = new Map((await prisma.platformPayment.findMany()).map((p) => [p.authority!, p.id]));
    zp.inquiry = (async (q: { authority: string }) => {
      const id = auth.get(q.authority);
      return { status: id === ids[0] ? ("PAID" as const) : id === ids[1] ? ("FAILED" as const) : ("IN_BANK" as const) };
    }) as never;
    zp.verifyResult = (v) => (auth.get(v.authority) === ids[0] ? { outcome: "paid", code: 100, refId: "900", cardPan: null, fee: 0 } : { outcome: "pending", code: -51 }); // the stale one: nothing captured
    const report = await svc.reconcile();
    expect(report).toMatchObject({ checked: 3, paid: 1, closed: 2 });
    expect((await prisma.platformPayment.findUniqueOrThrow(by(ids[0]!))).status).toBe("PAID");
    expect((await prisma.platformPayment.findUniqueOrThrow(by(ids[1]!))).status).toBe("FAILED");
    expect((await prisma.platformPayment.findUniqueOrThrow(by(ids[2]!))).status).toBe("EXPIRED");
    expect((await prisma.platformPayment.findUniqueOrThrow(by(ids[3]!))).status).toBe("CREATED"); // too young to judge
    expect(await balance(failed.storeId)).toBe(30_000);
    expect(await balance(stale.storeId)).toBe(30_000);
    expect(await balance(paid.storeId)).toBe(0);
    expect(await balance(young.storeId)).toBe(0);
    for (const m of [paid, failed, stale, young]) await ledgerAdds(m.storeId);
    expect((await call(paid.cookie, "GET", `/stores/${paid.storeId}/billing`)).json.state.kind).toBe("active");
  });

  it("money that arrives after the payment was closed becomes wallet credit, never lost", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const plan = await mkPlan(s);
    await setWallet(m.storeId, 100_000);
    const a = authorityOf(await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id }));
    const p = await prisma.platformPayment.findFirstOrThrow({ where: { storeId: m.storeId } });
    await age(p.id, 45);
    zp.inquiryStatus = "IN_BANK";
    zp.verifyResult = () => ({ outcome: "pending", code: -51 });
    await app!.get(PlatformPaymentsService).reconcile();
    expect((await prisma.platformPayment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("EXPIRED");
    expect(await balance(m.storeId)).toBe(100_000);
    zp.verifyResult = () => ({ outcome: "paid", code: 100, refId: "777", cardPan: null, fee: 0 });
    expect((await back(m, a)).json).toMatchObject({ outcome: "paid", payment: { status: "LATE_CREDITED" } });
    expect(await balance(m.storeId)).toBe(500_000); // the 100,000 held and returned + the 400,000 that was paid
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/billing`)).json.state.kind).toBe("none"); // no plan is granted late
    await back(m, a);
    expect(await balance(m.storeId)).toBe(500_000);
    await ledgerAdds(m.storeId);
  });
});

describe("who may do this", () => {
  it("only the owner; another store's authority is simply not found; junk is refused", async () => {
    const s = await staff();
    await enableGateway(s);
    const m = await owner();
    const other = await owner();
    const plan = await mkPlan(s);
    const start = await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id, useWallet: false });
    const a = authorityOf(start);
    // a manager of the store: 403 everywhere
    const mgr = await makeUser();
    await prisma.storeMember.create({ data: { storeId: m.storeId, userId: mgr.id, role: "MANAGER" } });
    const mc = await cookieOf(mgr.id);
    for (const [path, body] of [["billing/pay", { planId: plan.id }], ["billing/topup", { amountToman: 20_000 }], ["billing/payments/verify", { authority: a, status: "OK" }]] as const) {
      expect((await call(mc, "POST", `/stores/${m.storeId}/${path}`, body)).status, path).toBe(403);
    }
    // another store's owner cannot use this store, nor settle this authority from theirs
    expect((await call(other.cookie, "POST", `/stores/${m.storeId}/billing/payments/verify`, { authority: a, status: "OK" })).status).toBe(404);
    expect((await call(other.cookie, "POST", `/stores/${other.storeId}/billing/payments/verify`, { authority: a, status: "OK" })).status).toBe(404);
    expect(zp.verifies).toHaveLength(0);
    for (const body of [{ authority: "nope", status: "OK" }, { authority: a, status: "MAYBE" }, { authority: a }, { authority: a, status: "OK", extra: 1 }]) expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/payments/verify`, body)).status).toBe(400);
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/payments/verify`, { authority: `S${"9".repeat(35)}`, status: "OK" })).status).toBe(404);
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: "nope" })).status).toBe(400);
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/billing/pay`, { planId: plan.id, price: 1 })).status).toBe(400); // no client price exists
  });

  it("the database refuses a payment whose parts do not add up and a second open one", async () => {
    const m = await owner();
    const base = { storeId: m.storeId, userId: m.user.id, sandbox: true };
    await expect(prisma.platformPayment.create({ data: { ...base, purpose: "TOPUP", amountToman: 1000, heldToman: 5 } })).rejects.toThrow();
    await expect(prisma.platformPayment.create({ data: { ...base, purpose: "PURCHASE", amountToman: 1000 } })).rejects.toThrow();
    await prisma.platformPayment.create({ data: { ...base, purpose: "TOPUP", amountToman: 1000 } });
    await expect(prisma.platformPayment.create({ data: { ...base, purpose: "TOPUP", amountToman: 2000 } })).rejects.toThrow();
  });
});
