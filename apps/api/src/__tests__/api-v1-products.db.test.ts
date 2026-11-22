import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { productCursorListDto } from "@store-builder/shared/api/schemas";
import { createApp } from "../app.js";
import { TokenService } from "../auth/token.js";
import { createStore } from "../modules/stores/service.js";
import { makeUser, prisma, resetDb } from "../test/db-helpers.js";
import { listenFetchable, testConfig } from "./helpers.js";

/** Phase 2.5 on real PostgreSQL: the v1 product list pages by keyset; the unversioned path keeps page numbers. */
const ORIGIN = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const tokens = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
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

async function setup(n: number) {
  const user = await makeUser();
  const { id: storeId } = await createStore(user.id, { name: "فروشگاه صفحه‌بندی", templateKey: "bazaar", businessCategory: "general" });
  const t0 = Date.UTC(2026, 0, 1);
  // Several rows share a createdAt on purpose: the id breaks the tie, so no row is skipped or repeated across pages.
  await prisma.product.createMany({
    data: Array.from({ length: n }, (_, i) => ({ storeId, name: `کالا ${i}`, slug: `kala-${i}`, searchKey: `کالا ${i}`, price: 1000 + i, stockQuantity: 1, status: "ACTIVE" as const, createdAt: new Date(t0 + Math.floor(i / 3) * 1000) })),
  });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const cookie = `sb_session=${await tokens.sign({ userId: u.id, authVersion: u.authVersion })}`;
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { origin: ORIGIN, cookie } });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { storeId, get };
}

describe("v1 product list: keyset pages (phase 2.5)", () => {
  it("walks every product exactly once, newest first, and ends with a null cursor", async () => {
    const { storeId, get } = await setup(25);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await get(`/api/v1/admin/stores/${storeId}/products?limit=10${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      expect(productCursorListDto.safeParse(r.json).success).toBe(true);
      expect(r.json.total).toBe(25);
      seen.push(...r.json.items.map((p: { name: string }) => p.name));
      cursor = r.json.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(25);
    expect(seen[0]).toBe("کالا 24");
  });

  it("filters combine with the cursor; a malformed or forged cursor and a bad limit are validation errors in the v1 shape", async () => {
    const { storeId, get } = await setup(5);
    const first = await get(`/api/v1/admin/stores/${storeId}/products?limit=2&q=${encodeURIComponent("کالا")}`);
    expect(first.json.items).toHaveLength(2);
    for (const bad of ["cursor=***", `cursor=${Buffer.from("not-a-date|x").toString("base64url")}`, `cursor=${Buffer.from("2026-01-01T00:00:00.000Z|id|extra").toString("base64url")}`, "limit=0", "limit=101", "limit=abc"]) {
      const r = await get(`/api/v1/admin/stores/${storeId}/products?${bad}`);
      expect(r.status, bad).toBe(400); // the status ValidationError has always had
      expect(r.json.error.code, bad).toBe("VALIDATION_FAILED");
    }
  });

  it("the unversioned path keeps page numbers (the web app reads them)", async () => {
    const { storeId, get } = await setup(25);
    const r = await get(`/api/stores/${storeId}/products?page=2&pageSize=10`);
    expect(r.json).toMatchObject({ total: 25, page: 2, pageSize: 10, totalPages: 3 });
    expect(r.json.items).toHaveLength(10);
  });

  it("another user's store is a 404 in v1 too (the access rule does not change)", async () => {
    const { storeId } = await setup(1);
    const other = await makeUser();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    const r = await fetch(`${base}/api/v1/admin/stores/${storeId}/products`, { headers: { origin: ORIGIN, cookie: `sb_session=${await tokens.sign({ userId: u.id, authVersion: u.authVersion })}` } });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
