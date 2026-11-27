import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** The store's information pages and announcement bar on real PostgreSQL over HTTP: saving, merging, publishing, limits, isolation. */
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

/** A store made through the real API, so its settings are the valid ones a real store has (the bare row helper stores `{}`). */
async function merchant(name = "فروشگاه") {
  const user = await makeUser();
  const cookie = `sb_session=${await sessions.sign({ userId: user.id, authVersion: 0 })}`;
  const r = await fetch(`${base}/api/stores`, { method: "POST", headers: { origin: PLATFORM, cookie, "content-type": "application/json" }, body: JSON.stringify({ name, templateKey: "general" }) });
  expect(r.status).toBe(201);
  return { user, storeId: ((await r.json()) as { id: string }).id, cookie };
}
async function call(m: { storeId: string; cookie: string }, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api/stores/${m.storeId}${path}`, { method, headers: { origin: PLATFORM, cookie: m.cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const draft = async (m: { storeId: string; cookie: string }) => (await call(m, "GET", "/preview")).json.data.store;
const revision = async (id: string) => (await prisma.store.findUniqueOrThrow({ where: { id } })).draftRevision;

describe("information pages", () => {
  it("are saved page by page, merged with the others, removed by an empty text, and absent from the data when there are none", async () => {
    const m = await merchant();
    expect((await draft(m)).infoPages).toBeUndefined();
    expect((await call(m, "PATCH", "", { infoPages: { terms: "## قوانین\nمتن قوانین فروشگاه." } })).status).toBe(200);
    expect((await call(m, "PATCH", "", { infoPages: { faq: "## سؤال؟\nپاسخ." } })).status).toBe(200);
    expect((await draft(m)).infoPages).toEqual({ terms: "## قوانین\nمتن قوانین فروشگاه.", faq: "## سؤال؟\nپاسخ." });
    expect((await call(m, "PATCH", "", { infoPages: { terms: "   " } })).status).toBe(200); // an empty text removes the page
    expect((await draft(m)).infoPages).toEqual({ faq: "## سؤال؟\nپاسخ." });
    const stored = (await prisma.store.findUniqueOrThrow({ where: { id: m.storeId } })).settings as any;
    expect(Object.keys(stored.infoPages)).toEqual(["faq"]); // no blank page is ever stored
    await call(m, "PATCH", "", { infoPages: { faq: "" } });
    expect((await draft(m)).infoPages).toBeUndefined();
  });

  it("a save that changes nothing does not bump the draft revision", async () => {
    const m = await merchant();
    await call(m, "PATCH", "", { infoPages: { terms: "## قوانین\nمتن." } });
    const r = await revision(m.storeId);
    await call(m, "PATCH", "", { infoPages: { terms: "## قوانین\nمتن." } });
    expect(await revision(m.storeId)).toBe(r);
    await call(m, "PATCH", "", { infoPages: { terms: "## قوانین\nمتن تازه." } });
    expect(await revision(m.storeId)).toBe(r + 1);
  });

  it("refuses an unknown page, too long a text, and unknown fields; nothing is saved", async () => {
    const m = await merchant();
    const r0 = await revision(m.storeId);
    expect((await call(m, "PATCH", "", { infoPages: { cookies: "x" } })).status).toBe(400);
    const long = await call(m, "PATCH", "", { infoPages: { terms: "x".repeat(8001) } });
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.json)).toContain("طولانی");
    expect((await call(m, "PATCH", "", { infoPages: { terms: "متن", extra: 1 } })).status).toBe(400);
    expect(await revision(m.storeId)).toBe(r0);
  });

  it("go live with the next publish and not before", async () => {
    const m = await merchant();
    await prisma.domain.create({ data: { storeId: m.storeId, kind: "SUBDOMAIN", host: "infoshop", verifiedAt: new Date() } });
    const publish = async () => {
      const st = await call(m, "GET", "/publish");
      return call(m, "POST", "/publish", { expectedDraftRevision: st.json.draftRevision ?? st.json.draft?.revision });
    };
    expect((await publish()).status).toBeLessThan(300);
    const live = async () => ((await (await fetch(`${base}/api/public/stores/infoshop`)).json()) as any).data.store;
    expect((await live()).infoPages).toBeUndefined();
    await call(m, "PATCH", "", { infoPages: { returns: "## بازگشت\nتا هفت روز." }, announcement: { text: "ارسال رایگان", link: "products" } });
    expect((await live()).infoPages).toBeUndefined(); // still private
    expect((await live()).announcement).toBeUndefined();
    expect((await publish()).status).toBeLessThan(300);
    expect((await live()).infoPages).toEqual({ returns: "## بازگشت\nتا هفت روز." });
    expect((await live()).announcement).toEqual({ text: "ارسال رایگان", link: "products" });
  });
});

describe("announcement", () => {
  it("is one short line with a link to one of the store's own pages; null removes it", async () => {
    const m = await merchant();
    expect((await call(m, "PATCH", "", { announcement: { text: "  ارسال رایگان  برای همه ", link: "blog" } })).status).toBe(200);
    expect((await draft(m)).announcement).toEqual({ text: "ارسال رایگان برای همه", link: "blog" });
    expect((await call(m, "PATCH", "", { announcement: { text: "x".repeat(121) } })).status).toBe(400);
    expect((await call(m, "PATCH", "", { announcement: { text: "سلام", link: "https://evil.example" } })).status).toBe(400);
    expect((await call(m, "PATCH", "", { announcement: null })).status).toBe(200);
    expect((await draft(m)).announcement).toBeUndefined();
  });
});

describe("who may change them", () => {
  it("is limited to the store's own owner and manager; another store's owner gets 404 and changes nothing", async () => {
    const a = await merchant("الف");
    const b = await merchant("ب");
    expect((await call({ storeId: a.storeId, cookie: b.cookie }, "PATCH", "", { infoPages: { terms: "نفوذ به فروشگاه دیگر" } })).status).toBe(404);
    const op = await makeUser();
    await prisma.storeMember.create({ data: { storeId: a.storeId, userId: op.id, role: "OPERATOR" } });
    expect((await call({ storeId: a.storeId, cookie: `sb_session=${await sessions.sign({ userId: op.id, authVersion: 0 })}` }, "PATCH", "", { infoPages: { terms: "اپراتور" } })).status).toBe(403);
    expect(((await prisma.store.findUniqueOrThrow({ where: { id: a.storeId } })).settings as any).infoPages ?? {}).toEqual({});
  });
});
