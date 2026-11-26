import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { customerTokens } from "../customers/infrastructure/crypto.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, publishStore, resetDb } from "../../test/db-helpers.js";

/** Product reviews on real PostgreSQL over HTTP: customer submit, approval, public display, answers, isolation, limits. */
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

async function liveStore(label: string) {
  const owner = await makeUser();
  const store = await makeStore(owner.id, `فروشگاه ${label}`);
  await publishStore(store.id);
  await prisma.domain.create({ data: { storeId: store.id, kind: "SUBDOMAIN", host: label, verifiedAt: new Date() } });
  const tea = await prisma.product.create({ data: { storeId: store.id, name: "چای", slug: `tea-${label}`, searchKey: "چای", price: 1, stockQuantity: 10, status: "ACTIVE" } });
  const draft = await prisma.product.create({ data: { storeId: store.id, name: "پیش‌نویس", slug: `draft-${label}`, searchKey: "پیش‌نویس", price: 1, stockQuantity: 1, status: "DRAFT" } });
  const merchant = `sb_session=${await sessions.sign({ userId: owner.id, authVersion: 0 })}`;
  return { storeId: store.id, label, tea, draft, merchant, owner };
}
async function customer(s: { storeId: string; label: string }, phone: string, name: string | null = "علی رضایی") {
  const c = await prisma.customer.create({ data: { storeId: s.storeId, phone, name } });
  return `sb_customer=${await customerSessions.issue({ customerId: c.id, storeId: s.storeId, authVersion: 0 })}`;
}
async function shop(label: string, method: string, path: string, cookie = "", body?: unknown, origin = storeOrigin(label)) {
  const r = await fetch(`${base}/api/public/stores/${label}${path}`, { method, headers: { origin, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
async function merchantCall(storeId: string, cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api/stores/${storeId}${path}`, { method, headers: { origin: PLATFORM, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const review = (slug: string, rating = 5, body = "چای عالی و خوش‌عطری بود.") => ({ productSlug: slug, rating, body });

describe("customer submits, merchant approves, the public sees", () => {
  it("a review waits for approval, then shows with the summary and the merchant's answer; the phone number never appears", async () => {
    const s = await liveStore("shop");
    const cookie = await customer(s, "+989121112233");
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug))).status).toBe(204);
    // not public yet
    expect((await shop("shop", "GET", `/reviews?product=${s.tea.slug}`)).json).toEqual({ summary: { count: 0, average: null }, reviews: [] });
    const queue = await merchantCall(s.storeId, s.merchant, "GET", "/reviews?status=PENDING");
    expect(queue.json).toHaveLength(1);
    expect(queue.json[0]).toMatchObject({ productName: "چای", authorName: "علی رضایی", rating: 5, status: "PENDING" });
    const id = queue.json[0].id;
    expect((await merchantCall(s.storeId, s.merchant, "POST", `/reviews/${id}/status`, { status: "APPROVED" })).status).toBe(204);
    expect((await merchantCall(s.storeId, s.merchant, "POST", `/reviews/${id}/reply`, { reply: "ممنون از اعتماد شما" })).status).toBe(204);
    const pub = await shop("shop", "GET", `/reviews?product=${s.tea.slug}`);
    expect(pub.json.summary).toEqual({ count: 1, average: 5 });
    expect(pub.json.reviews[0]).toMatchObject({ authorName: "علی رضایی", body: "چای عالی و خوش‌عطری بود.", reply: "ممنون از اعتماد شما" });
    expect(JSON.stringify(pub.json)).not.toContain("9121112233");
    // rejecting hides it again; an empty reply removes the answer
    await merchantCall(s.storeId, s.merchant, "POST", `/reviews/${id}/status`, { status: "REJECTED" });
    expect((await shop("shop", "GET", `/reviews?product=${s.tea.slug}`)).json.reviews).toEqual([]);
    await merchantCall(s.storeId, s.merchant, "POST", `/reviews/${id}/reply`, { reply: "" });
    expect((await prisma.productReview.findUniqueOrThrow({ where: { id } })).reply).toBeNull();
  });

  it("averages ratings with one decimal", async () => {
    const s = await liveStore("shop");
    for (const [i, rating] of [5, 4, 4].entries()) {
      const cookie = await customer(s, `+98912000000${i}`, `خریدار ${i}`);
      await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug, rating));
    }
    await prisma.productReview.updateMany({ data: { status: "APPROVED" } });
    expect((await shop("shop", "GET", `/reviews?product=${s.tea.slug}`)).json.summary).toEqual({ count: 3, average: 4.3 });
  });
});

describe("who may write, and what", () => {
  it("needs a customer session of THIS store; refuses bad input, a draft product, a second review and a long backlog", async () => {
    const s = await liveStore("shop");
    const other = await liveStore("other");
    expect((await shop("shop", "POST", "/reviews", "", review(s.tea.slug))).status).toBe(401);
    const foreign = await customer(other, "+989121112233");
    expect((await shop("shop", "POST", "/reviews", foreign, review(s.tea.slug))).status).toBe(401); // a session of another store is no session here
    const cookie = await customer(s, "+989121112244");
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug, 6))).status).toBe(400);
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug, 5, "کم"))).status).toBe(400);
    expect((await shop("shop", "POST", "/reviews", cookie, { ...review(s.tea.slug), extra: 1 })).status).toBe(400);
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.draft.slug))).status).toBe(404);
    expect((await shop("shop", "POST", "/reviews", cookie, review("no-such-product"))).status).toBe(404);
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug))).status).toBe(204);
    const dup = await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug));
    expect(dup.status).toBe(400);
    expect(JSON.stringify(dup.json)).toContain("قبلاً");
    // five waiting reviews is the limit
    for (let i = 0; i < 5; i++) await prisma.product.create({ data: { storeId: s.storeId, name: `کالا ${i}`, slug: `p${i}`, searchKey: "x", price: 1, stockQuantity: 1, status: "ACTIVE" } });
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await shop("shop", "POST", "/reviews", cookie, review(`p${i}`))).status);
    expect(results).toEqual([204, 204, 204, 204, 400]);
    expect(await prisma.productReview.count({ where: { storeId: s.storeId } })).toBe(5);
  });

  it("simultaneous submissions of the same customer for one product create one review", async () => {
    const s = await liveStore("shop");
    const cookie = await customer(s, "+989121112255");
    const r = await Promise.all(Array.from({ length: 6 }, () => shop("shop", "POST", "/reviews", cookie, review(s.tea.slug))));
    expect(r.filter((x) => x.status === 204)).toHaveLength(1);
    expect(await prisma.productReview.count()).toBe(1);
  });

  it("a store that is not live answers the same 404 as a missing one, and a foreign origin cannot post", async () => {
    const s = await liveStore("shop");
    await prisma.store.update({ where: { id: s.storeId }, data: { suspendedAt: new Date() } });
    const cookie = await customer(s, "+989121112266");
    expect((await shop("shop", "GET", `/reviews?product=${s.tea.slug}`)).status).toBe(404);
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug))).status).toBe(404);
    expect((await shop("nope", "GET", "/reviews?product=x")).status).toBe(404);
    await prisma.store.update({ where: { id: s.storeId }, data: { suspendedAt: null } });
    expect((await shop("shop", "POST", "/reviews", cookie, review(s.tea.slug), "http://evil.example")).status).toBe(403);
    expect(await prisma.productReview.count()).toBe(0);
  });
});

describe("the merchant's side", () => {
  it("is for owner and manager; another store's merchant sees nothing and cannot touch it", async () => {
    const a = await liveStore("shop");
    const b = await liveStore("other");
    await shop("shop", "POST", "/reviews", await customer(a, "+989121112277"), review(a.tea.slug));
    const id = (await prisma.productReview.findFirstOrThrow()).id;
    expect((await merchantCall(b.storeId, b.merchant, "GET", "/reviews")).json).toEqual([]);
    expect((await merchantCall(b.storeId, b.merchant, "POST", `/reviews/${id}/status`, { status: "APPROVED" })).status).toBe(404);
    expect((await merchantCall(b.storeId, b.merchant, "POST", `/reviews/${id}/reply`, { reply: "نفوذ" })).status).toBe(404);
    expect((await merchantCall(a.storeId, b.merchant, "GET", "/reviews")).status).toBe(404);
    const op = await makeUser();
    await prisma.storeMember.create({ data: { storeId: a.storeId, userId: op.id, role: "OPERATOR" } });
    const opCookie = `sb_session=${await sessions.sign({ userId: op.id, authVersion: 0 })}`;
    expect((await merchantCall(a.storeId, opCookie, "GET", "/reviews")).status).toBe(403);
    expect((await merchantCall(a.storeId, a.merchant, "POST", `/reviews/${id}/status`, { status: "BOGUS" })).status).toBe(400);
    expect((await prisma.productReview.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    // audited, without the review text
    await merchantCall(a.storeId, a.merchant, "POST", `/reviews/${id}/status`, { status: "APPROVED" });
    await expect.poll(() => prisma.auditEvent.count({ where: { storeId: a.storeId, action: "review.moderated" } })).toBe(1);
    const ev = await prisma.auditEvent.findMany({ where: { storeId: a.storeId, action: "review.moderated" } });
    expect(JSON.stringify(ev)).not.toContain("عالی");
  });

  it("deleting a product or a customer deletes their reviews", async () => {
    const s = await liveStore("shop");
    await shop("shop", "POST", "/reviews", await customer(s, "+989121112288"), review(s.tea.slug));
    await prisma.product.delete({ where: { id: s.tea.id } });
    expect(await prisma.productReview.count()).toBe(0);
  });
});
