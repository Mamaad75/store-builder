import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { merchantBankCardsDto, placedOrderDto } from "@store-builder/shared/api/schemas";
import { makeStorefront, PRODUCT_A } from "@store-builder/shared/testing/storefront-fixtures";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import type { ApiConfig } from "../../config/env.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";
import type { GatewayRequest } from "./application/ports.js";

/**
 * Item 1 of the MVP plan (payment safety), on real PostgreSQL over HTTP:
 *  - D-3 / V0-1: bank cards are created, replaced and removed by the OWNER only, audited in the SAME transaction (masked before/after);
 *  - D-22 / V0-6: managers and operators see masked card numbers; the owner sees them in full;
 *  - D-19 (ADR 0005 §17.2): with APP_ENV=production, payment sandbox mode is refused at the settings API (audited) and never applied by
 *    the payment code, even when a sandbox `true` is already stored.
 */
const PLATFORM = "http://localhost:3000";
const CARD_A = "6037991234567893";
const CARD_B = "5022291234567897";
const MERCHANT_ID = "1344b5d4-0048-11e8-94db-005056a205be";
const base = (appEnv: ApiConfig["appEnv"]) => ({ ...testConfig, appEnv, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 });
const sessions = new TokenService(testConfig.authSecret, testConfig.sessionMaxAgeSeconds);

let app: NestExpressApplication | undefined;
let url = "";
let requests: GatewayRequest[] = [];

async function start(appEnv: ApiConfig["appEnv"]) {
  await resetDb();
  await prisma.platformSetting.deleteMany({ where: { key: "payment" } }); // resetDb keeps platform settings: start from the defaults
  requests = [];
  let n = 0;
  const gateway = {
    startUrl: (sandbox: boolean, a: string) => `https://${sandbox ? "sandbox" : "payment"}.zarinpal.com/pg/StartPay/${a}`,
    // A real gateway answers a sandbox request with an "S" authority and a live one with "A" (the service checks the match).
    request: async (r: GatewayRequest) => (requests.push(r), { ok: true as const, authority: `${r.sandbox ? "S" : "A"}${String(++n).padStart(35, "0")}` }),
    verify: async () => ({ outcome: "paid" as const, code: 100, refId: "777", cardPan: null, fee: 0 }),
    inquiry: async () => ({ status: "unknown" as const }),
  };
  ({ app, base: url } = await listenFetchable(() => createApp(base(appEnv), { paymentGateway: gateway })));
}
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

async function sessionOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
}
async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${url}/api${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, text: t, json: (t ? JSON.parse(t) : null) as any };
}

/** A store with an owner, a manager and an operator. */
async function team() {
  const owner = await makeUser();
  const store = await makeStore(owner.id, "فروشگاه کارت");
  const [manager, operator, stranger] = [await makeUser(), await makeUser(), await makeUser()];
  await prisma.storeMember.createMany({ data: [{ storeId: store.id, userId: manager.id, role: "MANAGER" }, { storeId: store.id, userId: operator.id, role: "OPERATOR" }] });
  return { storeId: store.id, owner: await sessionOf(owner.id), ownerId: owner.id, manager: await sessionOf(manager.id), operator: await sessionOf(operator.id), stranger: await sessionOf(stranger.id) };
}
const cards = (...numbers: string[]) => ({ cards: numbers.map((cardNumber, i) => ({ cardNumber, holderName: `صاحب ${i + 1}`, bankName: "بانک آزمون" })) });
const stored = () => prisma.storeBankCard.findMany({ select: { cardNumber: true }, orderBy: { position: "asc" } }).then((r) => r.map((c) => c.cardNumber));
const cardAudits = (storeId: string) => prisma.auditEvent.findMany({ where: { storeId, action: "store.bank_cards_replaced" }, orderBy: { createdAt: "asc" } });

describe("bank cards: owner-only changes, transactional audit, masked reads (D-3, D-22)", () => {
  it("only the owner creates, replaces and removes cards; manager and operator get 403, a stranger 404, and nothing changes", async () => {
    await start("test");
    const t = await team();
    const path = `/stores/${t.storeId}/bank-cards`;
    for (const who of [t.manager, t.operator]) {
      const r = await call(who, "PUT", path, cards(CARD_B));
      expect([r.status, r.json.errorName]).toEqual([403, "PermissionDeniedError"]);
    }
    expect((await call(t.stranger, "PUT", path, cards(CARD_B))).status).toBe(404);
    expect(await stored()).toEqual([]);
    expect(await cardAudits(t.storeId)).toEqual([]); // a refused change writes no change audit

    const created = await call(t.owner, "PUT", path, cards(CARD_A));
    expect(created.status).toBe(200);
    expect(merchantBankCardsDto.parse(created.json)).toEqual({ canManage: true, cards: [{ cardNumber: CARD_A, holderName: "صاحب 1", bankName: "بانک آزمون" }] });
    expect((await call(t.owner, "PUT", path, cards(CARD_B, CARD_A))).status).toBe(200); // replace
    expect(await stored()).toEqual([CARD_B, CARD_A]);
    for (const who of [t.manager, t.operator]) expect((await call(who, "PUT", path, cards())).status).toBe(403); // removal is a change too
    expect(await stored()).toEqual([CARD_B, CARD_A]);
    expect((await call(t.owner, "PUT", path, cards())).status).toBe(200); // remove
    expect(await stored()).toEqual([]);
  });

  it("every change is audited with actor, role and masked before/after; no full card number reaches the audit log", async () => {
    await start("test");
    const t = await team();
    const path = `/stores/${t.storeId}/bank-cards`;
    await call(t.owner, "PUT", path, cards(CARD_A));
    await call(t.owner, "PUT", path, cards(CARD_B));
    await call(t.owner, "PUT", path, cards());
    const rows = await cardAudits(t.storeId);
    expect(rows.map((r) => [r.actorId, r.targetType, r.metadata])).toEqual([
      [t.ownerId, "bank_cards", { role: "OWNER", before: [], after: [{ last4: "7893", bankName: "بانک آزمون", holderName: "صاحب 1" }] }],
      [t.ownerId, "bank_cards", { role: "OWNER", before: [{ last4: "7893", bankName: "بانک آزمون", holderName: "صاحب 1" }], after: [{ last4: "7897", bankName: "بانک آزمون", holderName: "صاحب 1" }] }],
      [t.ownerId, "bank_cards", { role: "OWNER", before: [{ last4: "7897", bankName: "بانک آزمون", holderName: "صاحب 1" }], after: [] }],
    ]);
    const everything = JSON.stringify(await prisma.auditEvent.findMany());
    expect(everything).not.toContain(CARD_A);
    expect(everything).not.toContain(CARD_B);
    expect(everything).not.toMatch(/\d{12,}/);
  });

  it("the audit entry commits with the change or not at all: a failing audit write rolls the card change back", async () => {
    await start("test");
    const t = await team();
    const path = `/stores/${t.storeId}/bank-cards`;
    expect((await call(t.owner, "PUT", path, cards(CARD_A))).status).toBe(200);
    // Make the audit insert fail inside the transaction (test-only trigger, dropped below).
    await prisma.$executeRawUnsafe(`CREATE FUNCTION sb_test_fail_card_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = 'store.bank_cards_replaced' THEN RAISE EXCEPTION 'audit down'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "sb_test_fail_card_audit" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION sb_test_fail_card_audit()`);
    try {
      expect((await call(t.owner, "PUT", path, cards(CARD_B))).status).toBe(500);
      expect(await stored()).toEqual([CARD_A]); // unchanged
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "sb_test_fail_card_audit" ON "AuditEvent"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION sb_test_fail_card_audit()`);
    }
    expect((await cardAudits(t.storeId)).length).toBe(1);
  });

  it("reads: the owner sees full numbers; managers and operators see 603799******7893 and cannot manage", async () => {
    await start("test");
    const t = await team();
    const path = `/stores/${t.storeId}/bank-cards`;
    await call(t.owner, "PUT", path, cards(CARD_A, CARD_B));
    expect(merchantBankCardsDto.parse((await call(t.owner, "GET", path)).json)).toMatchObject({ canManage: true, cards: [{ cardNumber: CARD_A }, { cardNumber: CARD_B }] });
    for (const who of [t.manager, t.operator]) {
      const r = await call(who, "GET", path);
      expect(r.status).toBe(200);
      expect(merchantBankCardsDto.parse(r.json)).toMatchObject({ canManage: false, cards: [{ cardNumber: "603799******7893", holderName: "صاحب 1" }, { cardNumber: "502229******7897" }] });
      expect(r.text).not.toContain(CARD_A);
      expect(r.text).not.toContain(CARD_B);
    }
    expect((await call(t.stranger, "GET", path)).status).toBe(404);
  });

  it("a suspended store's owner still cannot change cards (unchanged: not on the suspension allow-list); reading stays allowed", async () => {
    await start("test");
    const t = await team();
    await call(t.owner, "PUT", `/stores/${t.storeId}/bank-cards`, cards(CARD_A));
    await prisma.store.update({ where: { id: t.storeId }, data: { suspendedAt: new Date() } });
    const r = await call(t.owner, "PUT", `/stores/${t.storeId}/bank-cards`, cards(CARD_B));
    expect([r.status, r.json.errorName]).toEqual([403, "StoreSuspendedError"]);
    expect((await call(t.owner, "GET", `/stores/${t.storeId}/bank-cards`)).status).toBe(200);
  });
});

// ---------- D-19: payment sandbox mode in production ----------

async function superAdmin() {
  const u = await makeUser();
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await sessionOf(u.id) };
}
const paymentSetting = (sandbox: boolean) => ({ zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox });

/** A published store with Zarinpal, and one placed online order; returns the gateway session the payment opened. */
async function payOnline() {
  const owner = await makeUser();
  const store = await makeStore(owner.id, "فروشگاه آنلاین");
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: "tea", searchKey: "چای", price: 1, stockQuantity: 5, status: "ACTIVE" } });
  const products: StorefrontProduct[] = [{ ...PRODUCT_A, id: tea.id, slug: tea.slug, name: "چای", price: 100_000, stockQuantity: 5, categoryId: null }];
  const version = await prisma.storeVersion.create({ data: { storeId: store.id, number: 1, draftRevision: 1, snapshot: makeStorefront({ products, categories: [] }) as never } });
  await prisma.store.update({ where: { id: store.id }, data: { status: "PUBLISHED", publishedVersionId: version.id, publishedAt: new Date() } });
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: "online", verifiedAt: new Date() } });
  const method = await prisma.shippingMethod.create({ data: { storeId: store.id, name: "پیک", kind: "FLAT", price: 30_000, codEnabled: false, codFee: 0 } });
  expect((await call(await sessionOf(owner.id), "PUT", `/stores/${store.id}/secrets/payment.zarinpal.merchant_id`, { value: MERCHANT_ID })).status).toBe(204);
  const jar = new Map<string, string>();
  const shop = async (method: string, path: string, body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(`${url}/api/public/stores/online${path}`, { method, headers: { origin: "http://online.localhost:3000", ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    const t = await r.text();
    return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
  };
  await shop("POST", "/cart/items", { productId: tea.id, quantity: 1 });
  const address = { recipientName: "علی رضایی", phone: "09123456789", province: "tehran", city: "تهران", line: "خیابان آزادی، کوچه‌ی ۱۲، پلاک ۳", postalCode: "1384567891" };
  const placed = await shop("POST", "/checkout/orders", { requestKey: `safety-${Date.now()}`.padEnd(20, "x"), address, shippingMethodId: method.id, paymentMethod: "ONLINE", gateway: "ZARINPAL" });
  expect(placed.status).toBe(201);
  const pay = await shop("POST", `/checkout/orders/${placedOrderDto.parse(placed.json).accessToken}/pay`);
  expect(pay.status).toBe(200);
  return { url: pay.json.url as string, attempt: await prisma.payment.findFirstOrThrow() };
}

describe("payment sandbox mode (D-19, ADR 0005 §17.2)", () => {
  it("production: the settings API refuses sandbox:true (400 VALIDATION_FAILED, audited, nothing stored) and reports sandboxAllowed=false; other payment settings still save", async () => {
    await start("production");
    const admin = await superAdmin();
    const r = await call(admin.cookie, "PATCH", "/v1/platform/settings/payment", paymentSetting(true));
    // The codebase's validation status (400) with the v1 code VALIDATION_FAILED and a field error on `sandbox`.
    expect([r.status, r.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect(r.json.error.fieldErrors.sandbox).toBeDefined();
    expect(await prisma.platformSetting.findUnique({ where: { key: "payment" } })).toBeNull();
    expect(await prisma.auditEvent.findMany({ where: { action: "security.sandbox_refused" }, select: { actorId: true, targetId: true, metadata: true } })).toEqual([{ actorId: admin.id, targetId: "payment", metadata: null }]);
    expect((await call(admin.cookie, "PATCH", "/v1/platform/settings/payment", paymentSetting(false))).status).toBe(200);
    expect((await call(admin.cookie, "GET", "/v1/platform/settings")).json.sandboxAllowed).toBe(false);
  });

  it("production: a sandbox `true` already stored (old default, manual edit) is ignored: payments go to the LIVE gateway", async () => {
    await start("production");
    await prisma.platformSetting.upsert({ where: { key: "payment" }, create: { key: "payment", value: paymentSetting(true) }, update: { value: paymentSetting(true) } });
    const p = await payOnline();
    expect(requests.map((q) => q.sandbox)).toEqual([false]);
    expect(p.attempt.sandbox).toBe(false);
    expect(p.url).toMatch(/^https:\/\/payment\.zarinpal\.com\/pg\/StartPay\/A/);
  });

  it("staging (and test): sandbox can be switched on and is applied", async () => {
    await start("staging");
    const admin = await superAdmin();
    expect((await call(admin.cookie, "PATCH", "/v1/platform/settings/payment", paymentSetting(true))).status).toBe(200);
    expect((await call(admin.cookie, "GET", "/v1/platform/settings")).json.sandboxAllowed).toBe(true);
    const p = await payOnline();
    expect(requests.map((q) => q.sandbox)).toEqual([true]);
    expect(p.url).toMatch(/^https:\/\/sandbox\.zarinpal\.com\//);
  });
});
