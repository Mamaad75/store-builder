import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import sharp from "sharp";
import { createApp } from "../app.js";
import { TokenService } from "../auth/token.js";
import { setMediaStorageForTests } from "../lib/storage/index.js";
import { createStore } from "../modules/stores/service.js";
import { publishStore } from "../modules/publishing/service.js";
import { MemoryMediaStorage } from "../test/memory-storage.js";
import { makeUser, prisma, resetDb } from "../test/db-helpers.js";
import { publishableStore } from "../test/publish-helpers.js";
import { testConfig } from "./helpers.js";

/**
 * The domain REST API on real PostgreSQL, over HTTP with real session cookies. These replace the former Server Action tests: what mattered
 * there (identity only from the session, forged fields ignored, a foreign id indistinguishable from a random one, error transport) is
 * enforced and tested here, where the data is.
 */
const ORIGIN = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const tokens = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);

let app: NestExpressApplication | undefined;
let base = "";
beforeEach(async () => {
  await resetDb();
  setMediaStorageForTests(new MemoryMediaStorage());
  app = await createApp(config);
  await app.listen(0, "127.0.0.1");
  base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

async function cookieFor(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await tokens.sign({ userId: u.id, authVersion: u.authVersion })}`;
}
type Call = (method: string, path: string, body?: unknown, extra?: { headers?: Record<string, string>; raw?: Buffer }) => Promise<{ status: number; json: any; headers: Headers }>;
async function as(userId: string | null): Promise<Call> {
  const cookie = userId ? await cookieFor(userId) : undefined;
  let n = 0;
  return async (method, path, body, extra) => {
    const headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": `10.2.0.${++n % 250}`, ...(cookie ? { cookie } : {}), ...(extra?.headers ?? {}) };
    let payload: string | Uint8Array | undefined;
    if (extra?.raw) {
      headers["content-type"] = "application/octet-stream";
      payload = new Uint8Array(extra.raw);
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}/api${path}`, { method, headers, body: payload });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };
}

async function twoOwners() {
  const a = await makeUser();
  const b = await makeUser();
  const aStore = await createStore(a.id, { name: "A shop", templateKey: "coffee" });
  const bStore = await createStore(b.id, { name: "B shop", templateKey: "general" });
  return { a, b, aId: aStore.id, bId: bStore.id };
}

/** Every owner-scoped route, with a store id placeholder. */
const STORE_ROUTES: [string, string, unknown?][] = [
  ["GET", "/stores/:id"], ["PATCH", "/stores/:id", { name: "x" }], ["POST", "/stores/:id/delete", { confirmName: "x" }],
  ["PATCH", "/stores/:id/business-category", { businessCategory: "general", expected: "general" }],
  ["GET", "/stores/:id/themes"], ["GET", "/stores/:id/themes/coffee/report"], ["POST", "/stores/:id/themes/switch", { targetKey: "coffee", expectedDraftRevision: "1" }],
  ["GET", "/stores/:id/preview"], ["GET", "/stores/:id/categories"], ["POST", "/stores/:id/categories", { name: "c" }],
  ["GET", "/stores/:id/products"], ["POST", "/stores/:id/products", { name: "p", price: 1 }],
  ["GET", "/stores/:id/pages"], ["GET", "/stores/:id/pages/HOME"], ["POST", "/stores/:id/pages/HOME/visibility", { visible: true, expectedRevision: 1 }],
  ["GET", "/stores/:id/publish"], ["POST", "/stores/:id/publish", { expectedDraftRevision: 1 }], ["POST", "/stores/:id/unpublish"],
  ["GET", "/stores/:id/versions"], ["GET", "/stores/:id/subdomain"], ["POST", "/stores/:id/subdomain", { label: "valid-label" }],
  ["POST", "/stores/:id/logo/delete"],
];

describe("authentication and CSRF on every domain route", () => {
  it("answers 401 without a session on every route (nothing is read or written)", async () => {
    const { bId } = await twoOwners();
    const anon = await as(null);
    for (const [m, p, body] of [...STORE_ROUTES, ["GET", "/stores"], ["POST", "/stores", { name: "x", templateKey: "general" }], ["GET", "/stores/templates"], ["GET", "/stores/onboarding"]] as [string, string, unknown?][]) {
      expect((await anon(m, p.replace(":id", bId), body)).status, `${m} ${p}`).toBe(401);
    }
    expect(await prisma.store.count()).toBe(2);
  });
  it("refuses state-changing calls without the platform Origin (403) even with a valid session", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    for (const [m, p, body] of STORE_ROUTES.filter(([m]) => m !== "GET")) {
      expect((await call(m, p.replace(":id", aId), body, { headers: { origin: "https://evil.example" } })).status, `${m} ${p}`).toBe(403);
    }
    expect((await prisma.store.findUniqueOrThrow({ where: { id: aId } })).name).toBe("A shop");
  });
});

describe("forged requests from owner A against owner B's store", () => {
  it("every owner-scoped route answers 404 NotFoundError, identical to a random id, and B is untouched", async () => {
    const { a, bId } = await twoOwners();
    const call = await as(a.id);
    const before = JSON.stringify(await prisma.store.findUnique({ where: { id: bId } }));
    for (const [m, p, body] of STORE_ROUTES) {
      const foreign = await call(m, p.replace(":id", bId), body);
      const random = await call(m, p.replace(":id", "random-nonexistent-id"), body);
      expect(foreign.status, `${m} ${p}`).toBe(404);
      expect(foreign.json, `${m} ${p}`).toEqual(random.json);
      expect(foreign.json.errorName ?? foreign.json.error, `${m} ${p}`).toBeTruthy();
    }
    expect(JSON.stringify(await prisma.store.findUnique({ where: { id: bId } }))).toBe(before);
    expect(await prisma.page.count({ where: { storeId: bId } })).toBe(5);
  });
  it("update ignores forged ownerId/userId/status fields (strict input) and never changes the owner", async () => {
    const { a, b, aId } = await twoOwners();
    const call = await as(a.id);
    const r = await call("PATCH", `/stores/${aId}`, { name: "x", ownerId: b.id, userId: b.id, status: "PUBLISHED" });
    expect(r.status).toBe(400); // unknown keys are refused, nothing is applied
    const s = await prisma.store.findUniqueOrThrow({ where: { id: aId } });
    expect([s.ownerId, s.status, s.name]).toEqual([a.id, "DRAFT", "A shop"]);
  });
  it("create ignores a forged ownerId and always uses the session user", async () => {
    const { a, b } = await twoOwners();
    const call = await as(a.id);
    const r = await call("POST", "/stores", { name: "mine", templateKey: "fashion", ownerId: b.id, templateVersionId: "x" });
    expect([201, 400]).toContain(r.status);
    const created = await prisma.store.findFirst({ where: { name: "mine" } });
    if (created) expect(created.ownerId).toBe(a.id);
  });
});

describe("owner flows and error transport", () => {
  it("update saves; invalid input returns ValidationError with field errors and saves nothing", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    const ok = await call("PATCH", `/stores/${aId}`, { name: "Renamed", primaryColor: "#123456", contact: { phone: "09120000000", email: "", address: "x" }, social: { instagram: "a_b", telegram: "", whatsapp: "" }, description: "" });
    expect(ok.status).toBe(200);
    expect(ok.json.name).toBe("Renamed");
    const bad = await call("PATCH", `/stores/${aId}`, { name: "", primaryColor: "red", contact: { phone: "", email: "", address: "" }, social: { instagram: "", telegram: "", whatsapp: "" }, description: "" });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ errorName: "ValidationError", payload: { fieldErrors: { name: expect.any(Array) } } });
    expect(JSON.stringify(bad.json)).not.toMatch(/stack|at .*\.ts/);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: aId } })).name).toBe("Renamed");
  });
  it("delete needs the typed name, then deletes", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    const wrong = await call("POST", `/stores/${aId}/delete`, { confirmName: "wrong" });
    expect(wrong.status).toBe(400);
    expect(wrong.json.payload.fieldErrors.confirmName).toBeTruthy();
    expect(await prisma.store.count({ where: { id: aId } })).toBe(1);
    expect((await call("POST", `/stores/${aId}/delete`, { confirmName: "A shop" })).status).toBe(204);
    expect(await prisma.store.count({ where: { id: aId } })).toBe(0);
  });
  it("the store limit is a StoreLimitError (422) carrying the limit", async () => {
    const { a } = await twoOwners();
    const call = await as(a.id);
    for (let i = 0; i < 9; i++) expect((await call("POST", "/stores", { name: `s${i}`, templateKey: "general" })).status).toBe(201);
    const r = await call("POST", "/stores", { name: "eleventh", templateKey: "general" });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ errorName: "StoreLimitError", payload: { limit: 10 } });
  });
  it("catalog: category and product round trip; a category with products needs confirmation (CategoryNotEmptyError)", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    const cat = await call("POST", `/stores/${aId}/categories`, { name: "چای" });
    expect(cat.status).toBe(201);
    const prod = await call("POST", `/stores/${aId}/products`, { name: "چای سبز", price: 12500, stockQuantity: 3, categoryId: cat.json.id });
    expect(prod.status).toBe(201);
    expect((await call("GET", `/stores/${aId}/products?q=${encodeURIComponent("سبز")}`)).json.total).toBe(1);
    const refused = await call("POST", `/stores/${aId}/categories/${cat.json.id}/delete`, { moveProducts: false });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ errorName: "CategoryNotEmptyError", payload: { productCount: 1 } });
    const moved = await call("POST", `/stores/${aId}/categories/${cat.json.id}/delete`, { moveProducts: true });
    expect(moved.json).toEqual({ movedProducts: 1 });
    expect((await call("POST", `/stores/${aId}/products/${prod.json.id}/status`, { status: "ACTIVE" })).json.status).toBe("ACTIVE");
    expect((await call("POST", `/stores/${aId}/products/${prod.json.id}/delete`)).status).toBe(204);
  });
  it("a stale page revision is a ConflictError (409)", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    const editor = await call("GET", `/stores/${aId}/pages/HOME`);
    expect(editor.status).toBe(200);
    const stale = await call("POST", `/stores/${aId}/pages/HOME/visibility`, { visible: true, expectedRevision: editor.json.revision + 5 });
    expect(stale.status).toBe(409);
    expect(stale.json.errorName).toBe("ConflictError");
  });
  it("dates travel as ISO strings and the list is owner-scoped", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    const list = await call("GET", "/stores");
    expect(list.json.map((s: { id: string }) => s.id)).toEqual([aId]);
    expect(typeof list.json[0].createdAt).toBe("string");
  });
});

describe("media upload (raw bytes)", () => {
  const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } }).png().toBuffer();
  it("uploads and attaches a product image; rolls back on failure; refuses foreign, empty and non-image input", async () => {
    const { a, b, aId } = await twoOwners();
    const call = await as(a.id);
    const prod = await call("POST", `/stores/${aId}/products`, { name: "p", price: 1000 });
    const okRes = await call("POST", `/stores/${aId}/products/${prod.json.id}/image`, undefined, { raw: await png() });
    expect(okRes.status).toBe(200);
    expect(okRes.json).toMatchObject({ mimeType: "image/webp" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: prod.json.id } })).imageId).toBe(okRes.json.id);
    // foreign owner: 404 and nothing stored
    const mediaBefore = await prisma.media.count();
    const other = await as(b.id);
    expect((await other("POST", `/stores/${aId}/products/${prod.json.id}/image`, undefined, { raw: await png() })).status).toBe(404);
    expect(await prisma.media.count()).toBe(mediaBefore);
    // attaching to a product that does not exist releases the uploaded image again
    const missing = await call("POST", `/stores/${aId}/products/no-such-product/image`, undefined, { raw: await png() });
    expect(missing.status).toBe(404);
    expect(await prisma.media.count({ where: { status: "READY", storeId: aId } })).toBe(1);
    // empty body and a non-image
    expect((await call("POST", `/stores/${aId}/logo`, undefined, { raw: Buffer.alloc(0) })).status).toBe(400);
    const notImage = await call("POST", `/stores/${aId}/logo`, undefined, { raw: Buffer.from("not an image at all") });
    expect(notImage.status).toBe(422);
    expect(notImage.json).toMatchObject({ errorName: "MediaValidationError", payload: { code: "unsupported_format" } });
  });
  it("rejects a JSON body on an upload route and an oversized body", async () => {
    const { a, aId } = await twoOwners();
    const call = await as(a.id);
    expect((await call("POST", `/stores/${aId}/logo`, { not: "bytes" })).status).toBe(400);
    expect((await call("POST", `/stores/${aId}/logo`, undefined, { raw: Buffer.alloc(7 * 1024 * 1024, 1) })).status).toBe(413);
  });
});

describe("public read of published stores (no session)", () => {
  it("returns the live store and snapshot, and the same 404 for unknown, unpublished and malformed labels", async () => {
    const s = await publishableStore({ products: 1 });
    expect((await as(null).then((c) => c("GET", `/public/stores/${s.label}`))).status).toBe(404); // not published yet
    await publishStore(s.owner.id, s.storeId, { expectedDraftRevision: (await prisma.store.findUniqueOrThrow({ where: { id: s.storeId } })).draftRevision });
    const anon = await as(null);
    const ok = await anon("GET", `/public/stores/${s.label}`);
    expect(ok.status).toBe(200);
    expect(ok.json.data.store.name).toBe("فروشگاه");
    expect(typeof ok.json.live.liveSince).toBe("string");
    const bodies = new Set<string>();
    for (const label of ["no-such-store", "BAD_LABEL", "a".repeat(80)]) {
      const r = await anon("GET", `/public/stores/${label}`);
      expect(r.status, label).toBe(404);
      bodies.add(JSON.stringify(r.json));
    }
    expect(bodies.size).toBe(1);
    expect((await anon("GET", `/public/stores/${s.label}/product-redirect?slug=unknown`)).status).toBe(404);
    expect((await anon("GET", `/public/stores/${s.label}/product-redirect`)).status).toBe(404);
  });
});
