import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/** The store blog on real PostgreSQL over HTTP: CRUD, limits, isolation, draft revision, and how posts reach the storefront data. */
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

async function merchant(name = "فروشگاه یک") {
  const user = await makeUser();
  const store = await makeStore(user.id, name);
  return { user, storeId: store.id, cookie: `sb_session=${await sessions.sign({ userId: user.id, authVersion: 0 })}` };
}
async function call(m: { storeId: string; cookie: string }, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api/stores/${m.storeId}${path}`, { method, headers: { origin: PLATFORM, cookie: m.cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : null) as any };
}
const post = (over: Record<string, unknown> = {}) => ({ title: "چگونه چای دم کنیم", excerpt: "راهنمای کوتاه", body: "## آب\nآب تازه بجوشانید.\n\n## زمان\nسه دقیقه صبر کنید.", status: "PUBLISHED", ...over });
const draftPosts = async (m: { storeId: string; cookie: string }) => (await call(m, "GET", "/preview")).json?.data?.posts;
const revision = async (storeId: string) => (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).draftRevision;

describe("writing posts", () => {
  it("creates, lists (without the text), reads, edits and deletes; each change bumps the draft revision once", async () => {
    const m = await merchant();
    const r0 = await revision(m.storeId);
    const created = await call(m, "POST", "/blog", post());
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ title: "چگونه چای دم کنیم", status: "PUBLISHED", excerpt: "راهنمای کوتاه" });
    expect(created.json.slug).toBeTruthy();
    expect(created.json.publishedAt).toBeTruthy();
    expect(await revision(m.storeId)).toBe(r0 + 1);
    const list = await call(m, "GET", "/blog");
    expect(list.json).toHaveLength(1);
    expect(list.json[0].body).toBeUndefined();
    expect((await call(m, "GET", `/blog/${created.json.id}`)).json.body).toContain("آب تازه");
    const slug = created.json.slug;
    const edited = await call(m, "PUT", `/blog/${created.json.id}`, post({ title: "عنوان کاملاً تازه", status: "DRAFT" }));
    expect(edited.json).toMatchObject({ title: "عنوان کاملاً تازه", status: "DRAFT", slug }); // the link never changes
    expect(edited.json.publishedAt).toBe(created.json.publishedAt); // the first publication date is remembered
    expect((await call(m, "POST", `/blog/${created.json.id}/delete`)).status).toBe(204);
    expect((await call(m, "GET", "/blog")).json).toEqual([]);
    expect(await revision(m.storeId)).toBe(r0 + 3);
  });

  it("refuses bad input in Persian, and gives two posts with the same title different links", async () => {
    const m = await merchant();
    const bad = await call(m, "POST", "/blog", post({ title: "ab" }));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).toContain("عنوان");
    expect((await call(m, "POST", "/blog", post({ body: "کوتاه" }))).status).toBe(400);
    expect((await call(m, "POST", "/blog", { ...post(), slug: "evil" })).status).toBe(400);
    const a = await call(m, "POST", "/blog", post());
    const b = await call(m, "POST", "/blog", post());
    expect(a.json.slug).not.toBe(b.json.slug);
    expect(await prisma.blogPost.count()).toBe(2);
  });

  it("stops at 50 posts per store, even when written simultaneously", async () => {
    const m = await merchant();
    await prisma.blogPost.createMany({ data: Array.from({ length: 48 }, (_, i) => ({ storeId: m.storeId, title: `مقاله ${i}`, slug: `p-${i}`, body: "متن مقاله برای آزمون" })) });
    const r = await Promise.all(Array.from({ length: 5 }, (_, i) => call(m, "POST", "/blog", post({ title: `مقالهٔ همزمان ${i}` }))));
    expect(r.filter((x) => x.status === 201)).toHaveLength(2);
    expect(r.filter((x) => x.status === 400)).toHaveLength(3);
    expect(await prisma.blogPost.count({ where: { storeId: m.storeId } })).toBe(50);
  });

  it("is isolated per store and limited to owner and manager", async () => {
    const a = await merchant("الف");
    const b = await merchant("ب");
    const p = (await call(a, "POST", "/blog", post())).json.id;
    expect((await call(b, "GET", "/blog")).json).toEqual([]);
    expect((await call(b, "GET", `/blog/${p}`)).status).toBe(404);
    expect((await call(b, "PUT", `/blog/${p}`, post())).status).toBe(404);
    expect((await call(b, "POST", `/blog/${p}/delete`)).status).toBe(404);
    expect((await call({ storeId: a.storeId, cookie: b.cookie }, "GET", "/blog")).status).toBe(404);
    const op = await makeUser();
    await prisma.storeMember.create({ data: { storeId: a.storeId, userId: op.id, role: "OPERATOR" } });
    expect((await call({ storeId: a.storeId, cookie: `sb_session=${await sessions.sign({ userId: op.id, authVersion: 0 })}` }, "GET", "/blog")).status).toBe(403);
    expect(await prisma.blogPost.count()).toBe(1);
  });

  it("deleting the store deletes its posts; every action is audited without the text", async () => {
    const m = await merchant();
    const p = (await call(m, "POST", "/blog", post())).json.id;
    await call(m, "PUT", `/blog/${p}`, post({ title: "عنوان ویرایش‌شده" }));
    await expect.poll(() => prisma.auditEvent.count({ where: { storeId: m.storeId, action: { startsWith: "blog." } } })).toBe(2);
    expect(JSON.stringify(await prisma.auditEvent.findMany({ where: { storeId: m.storeId } }))).not.toContain("آب تازه");
    await prisma.store.delete({ where: { id: m.storeId } });
    expect(await prisma.blogPost.count()).toBe(0);
  });
});

describe("posts in the storefront data", () => {
  it("only PUBLISHED posts are included, newest first; with none the key is absent", async () => {
    const m = await merchant();
    expect(await draftPosts(m)).toBeUndefined();
    await call(m, "POST", "/blog", post({ title: "مقالهٔ اول", status: "PUBLISHED" }));
    await call(m, "POST", "/blog", post({ title: "مقالهٔ پیش‌نویس", status: "DRAFT" }));
    await new Promise((r) => setTimeout(r, 20));
    await call(m, "POST", "/blog", post({ title: "مقالهٔ سوم", excerpt: "", status: "PUBLISHED" }));
    const posts = await draftPosts(m);
    expect(posts.map((p: any) => p.title)).toEqual(["مقالهٔ سوم", "مقالهٔ اول"]);
    expect(posts[0].excerpt).toBeUndefined(); // an empty summary is absent
    expect(posts[1]).toMatchObject({ excerpt: "راهنمای کوتاه", body: expect.stringContaining("## آب") });
    expect(JSON.stringify(posts)).not.toContain("پیش‌نویس");
  });

  it("publishing puts them in the live version, and the public read serves them (a draft or an unpublished post stays out)", async () => {
    const m = await merchant();
    await prisma.domain.create({ data: { storeId: m.storeId, kind: "SUBDOMAIN", host: "blogshop", verifiedAt: new Date() } });
    await call(m, "POST", "/blog", post({ title: "مقالهٔ زنده" }));
    await call(m, "POST", "/blog", post({ title: "مقالهٔ پیش‌نویس", status: "DRAFT" }));
    const state = await call(m, "GET", "/publish");
    const pub = await call(m, "POST", "/publish", { expectedDraftRevision: state.json.draftRevision ?? state.json.draft?.revision });
    expect(pub.status).toBeLessThan(300);
    const live = await fetch(`${base}/api/public/stores/blogshop`);
    const data = ((await live.json()) as any).data;
    expect(data.posts.map((p: any) => p.title)).toEqual(["مقالهٔ زنده"]);
    // later edits stay private until the next publish
    await call(m, "POST", "/blog", post({ title: "مقالهٔ بعدی" }));
    expect((((await (await fetch(`${base}/api/public/stores/blogshop`)).json()) as any).data.posts as unknown[]).length).toBe(1);
  });
});
