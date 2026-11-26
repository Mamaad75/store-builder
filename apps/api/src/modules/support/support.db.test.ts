import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { hashPassword } from "../../auth/password.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** Support requests on real PostgreSQL over HTTP: the merchant's side, the staff's inbox, tenant isolation, limits, audit. */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);

let app: NestExpressApplication | undefined;
let base = "";
let ipN = 0;
beforeEach(async () => {
  await resetDb();
  ({ app, base } = await listenFetchable(() => createApp(config)));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, {
    method,
    headers: { origin: PLATFORM, "x-forwarded-for": `10.8.${Math.floor(++ipN / 250)}.${ipN % 250}`, cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const cookieOf = async (userId: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
};
async function merchant(name = "فروشگاه یک") {
  const user = await makeUser();
  const store = await makeStore(user.id, name);
  return { user, storeId: store.id, cookie: await cookieOf(user.id) };
}
async function staff() {
  const u = await prisma.user.create({ data: { username: `staff_${++ipN}`, name: "پشتیبان", passwordHash: await hashPassword("staff-password-123") } });
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await cookieOf(u.id) };
}
const open = (m: { storeId: string; cookie: string }, subject = "مشکل در انتشار", body = "سلام، فروشگاه من منتشر نمی‌شود.") => call(m.cookie, "POST", `/stores/${m.storeId}/tickets`, { subject, body });

describe("the merchant's side", () => {
  it("opens a request, sees it listed with its first message, writes again and closes it", async () => {
    const m = await merchant();
    const created = await open(m);
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ subject: "مشکل در انتشار", status: "OPEN", messageCount: 1 });
    const list = await call(m.cookie, "GET", `/stores/${m.storeId}/tickets`);
    expect(list.json.map((t: any) => t.id)).toEqual([created.json.id]);
    const d = await call(m.cookie, "GET", `/stores/${m.storeId}/tickets/${created.json.id}`);
    expect(d.json.messages).toMatchObject([{ from: "SELLER", authorName: expect.any(String), body: "سلام، فروشگاه من منتشر نمی‌شود." }]);
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/tickets/${created.json.id}/messages`, { body: "توضیح بیشتر دارم." })).status).toBe(201);
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/tickets/${created.json.id}/close`)).status).toBe(204);
    expect((await call(m.cookie, "GET", `/stores/${m.storeId}/tickets/${created.json.id}`)).json.status).toBe("CLOSED");
    // writing again reopens it
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/tickets/${created.json.id}/messages`, { body: "هنوز حل نشده." })).json.status).toBe("OPEN");
  });

  it("refuses bad input with a Persian message and unknown fields", async () => {
    const m = await merchant();
    const short = await call(m.cookie, "POST", `/stores/${m.storeId}/tickets`, { subject: "ab", body: "متن کافی است" });
    expect(short.status).toBe(400);
    expect(JSON.stringify(short.json)).toContain("موضوع");
    expect((await call(m.cookie, "POST", `/stores/${m.storeId}/tickets`, { subject: "موضوع", body: "متن کافی", storeId: "x" })).status).toBe(400);
    expect(await prisma.supportTicket.count()).toBe(0);
  });

  it("allows five open requests at once, even when they are sent simultaneously, and a closed one frees a place", async () => {
    const m = await merchant();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => open(m, `موضوع شماره ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(3);
    expect(await prisma.supportTicket.count({ where: { storeId: m.storeId } })).toBe(5);
    const first = results.find((r) => r.status === 201)!.json.id;
    await call(m.cookie, "POST", `/stores/${m.storeId}/tickets/${first}/close`);
    expect((await open(m, "موضوع تازه")).status).toBe(201);
  });

  it("stops at 100 messages per request", async () => {
    const m = await merchant();
    const t = (await open(m)).json.id;
    await prisma.supportTicket.update({ where: { id: t }, data: { messageCount: 100 } });
    const r = await call(m.cookie, "POST", `/stores/${m.storeId}/tickets/${t}/messages`, { body: "پیام اضافه" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain("سقف");
  });

  it("is isolated per store: another store sees nothing and gets the same 404 as for a missing id", async () => {
    const a = await merchant("الف");
    const b = await merchant("ب");
    const t = (await open(a)).json.id;
    expect((await call(b.cookie, "GET", `/stores/${b.storeId}/tickets`)).json).toEqual([]);
    const other = await call(b.cookie, "GET", `/stores/${b.storeId}/tickets/${t}`);
    const missing = await call(b.cookie, "GET", `/stores/${b.storeId}/tickets/doesnotexist`);
    expect(other.status).toBe(404);
    expect(other.json).toEqual(missing.json);
    expect((await call(b.cookie, "POST", `/stores/${b.storeId}/tickets/${t}/messages`, { body: "پیام نفوذی" })).status).toBe(404);
    expect((await call(b.cookie, "POST", `/stores/${b.storeId}/tickets/${t}/close`)).status).toBe(404);
    // the forged route (A's store id with B's session) is the access guard's 404
    expect((await call(b.cookie, "GET", `/stores/${a.storeId}/tickets`)).status).toBe(404);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t } })).status).toBe("OPEN");
  });

  it("an operator (no support permission) is refused; a suspended store can still write to support", async () => {
    const m = await merchant();
    const op = await makeUser();
    await prisma.storeMember.create({ data: { storeId: m.storeId, userId: op.id, role: "OPERATOR" } });
    expect((await call(await cookieOf(op.id), "GET", `/stores/${m.storeId}/tickets`)).status).toBe(403);
    await prisma.store.update({ where: { id: m.storeId }, data: { suspendedAt: new Date() } });
    expect((await open(m, "چرا معلق شدم؟", "لطفاً دلیل تعلیق را بگویید.")).status).toBe(201);
  });

  it("the merchant's activity log records the actions, without the message text", async () => {
    const m = await merchant();
    const t = (await open(m)).json.id;
    await call(m.cookie, "POST", `/stores/${m.storeId}/tickets/${t}/close`);
    const events = await prisma.auditEvent.findMany({ where: { storeId: m.storeId, action: { startsWith: "ticket." } }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["ticket.opened", "ticket.closed"]);
    expect(JSON.stringify(events)).not.toContain("منتشر نمی‌شود");
  });
});

describe("the staff's inbox", () => {
  it("lists every store's requests, filters by status, answers and closes; the merchant sees the answer without the staff member's name", async () => {
    const a = await merchant("الف");
    const b = await merchant("ب");
    const s = await staff();
    const ta = (await open(a)).json.id;
    await open(b, "سؤال درباره دامنه", "چگونه دامنه بگیرم؟");
    const all = await call(s.cookie, "GET", "/platform/tickets");
    expect(all.json).toHaveLength(2);
    expect(all.json.map((t: any) => t.storeName).sort()).toEqual(["الف", "ب"]);
    expect((await call(s.cookie, "GET", "/platform/tickets?status=ANSWERED")).json).toEqual([]);
    expect((await call(s.cookie, "GET", "/platform/tickets?status=BOGUS")).status).toBe(400);

    const reply = await call(s.cookie, "POST", `/platform/tickets/${ta}/messages`, { body: "سلام، بررسی می‌کنیم." });
    expect(reply.status).toBe(201);
    expect(reply.json.status).toBe("ANSWERED");
    const seen = await call(a.cookie, "GET", `/stores/${a.storeId}/tickets/${ta}`);
    expect(seen.json.status).toBe("ANSWERED");
    expect(seen.json.messages[1]).toMatchObject({ from: "STAFF", authorName: null, body: "سلام، بررسی می‌کنیم." });
    expect(JSON.stringify(seen.json)).not.toContain(s.id);
    expect(JSON.stringify(seen.json)).not.toContain("پشتیبان");

    // the merchant's answer puts it back in the inbox
    await call(a.cookie, "POST", `/stores/${a.storeId}/tickets/${ta}/messages`, { body: "ممنون." });
    expect((await call(s.cookie, "GET", "/platform/tickets?status=OPEN")).json.map((t: any) => t.id)).toContain(ta);

    // closed: staff cannot reply until it is reopened
    expect((await call(s.cookie, "POST", `/platform/tickets/${ta}/status`, { status: "CLOSED" })).status).toBe(204);
    const refused = await call(s.cookie, "POST", `/platform/tickets/${ta}/messages`, { body: "پاسخ دیرهنگام" });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.json)).toContain("بسته");
    expect((await call(s.cookie, "POST", `/platform/tickets/${ta}/status`, { status: "OPEN" })).status).toBe(204);
    expect((await call(s.cookie, "POST", `/platform/tickets/${ta}/messages`, { body: "اکنون پاسخ می‌دهیم." })).status).toBe(201);
    expect((await call(s.cookie, "POST", "/platform/tickets/nope/status", { status: "OPEN" })).status).toBe(404);
  });

  it("is for platform admins only, and its actions are audited without the store's log", async () => {
    const m = await merchant();
    const t = (await open(m)).json.id;
    for (const [method, path, body] of [["GET", "/platform/tickets"], ["GET", `/platform/tickets/${t}`], ["POST", `/platform/tickets/${t}/messages`, { body: "پاسخ جعلی" }], ["POST", `/platform/tickets/${t}/status`, { status: "CLOSED" }]] as const) {
      expect((await call(m.cookie, method, path, body)).status, `${method} ${path}`).toBe(403);
      expect((await call("", method, path, body)).status, `${method} ${path} anonymous`).toBe(401);
    }
    const s = await staff();
    await call(s.cookie, "POST", `/platform/tickets/${t}/messages`, { body: "پاسخ واقعی" });
    await call(s.cookie, "POST", `/platform/tickets/${t}/status`, { status: "CLOSED" });
    const events = await prisma.auditEvent.findMany({ where: { action: { startsWith: "platform.ticket_" } }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.action, e.actorId, e.storeId, e.targetId])).toEqual([["platform.ticket_replied", s.id, null, t], ["platform.ticket_status", s.id, null, t]]);
    expect(JSON.stringify(events)).not.toContain("پاسخ واقعی");
    expect(await prisma.supportTicket.findUniqueOrThrow({ where: { id: t } })).toMatchObject({ status: "CLOSED", messageCount: 2 });
  });

  it("deleting the store deletes its requests", async () => {
    const m = await merchant();
    await open(m);
    await prisma.store.delete({ where: { id: m.storeId } });
    expect(await prisma.supportTicket.count()).toBe(0);
    expect(await prisma.supportTicketMessage.count()).toBe(0);
  });
});
