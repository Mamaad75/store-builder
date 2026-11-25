import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.js";
import { PostgresRateLimiter } from "../database/rate-limiter.js";
import { createPrismaClient } from "../database/prisma-client.js";
import { testConfig } from "./helpers.js";

/** The auth REST API on real PostgreSQL (isolated test database): constraints, atomic limiter and token revocation for real. */
const url = process.env.DATABASE_URL!;
const prisma = createPrismaClient(url);
let app: NestExpressApplication | undefined;

beforeEach(async () => {
  await app?.close();
  app = undefined;
  await prisma.$executeRawUnsafe(`TRUNCATE "RateLimitBucket","User" RESTART IDENTITY CASCADE`);
  // MVP item 2: registration is invite-only by default; these tests are about the session lifecycle, so this TEST database is opened.
  // The invite-only rules are covered by modules/platform/pilot-access.db.test.ts.
  await prisma.platformSetting.upsert({ where: { key: "registration" }, create: { key: "registration", value: { mode: "open" } }, update: { value: { mode: "open" } } });
});
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const ORIGIN = "http://localhost:3000";
async function boot() {
  app = await createApp({ ...testConfig, databaseUrl: url, trustProxyHops: 1 });
  await app.listen(0, "127.0.0.1");
  const base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  let n = 0;
  return (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/auth/${path}`, {
      method,
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.1.0.${++n % 250}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}
const valid = { name: "Ali", username: "ali_test", password: "password123" };

describe("auth REST API on PostgreSQL", () => {
  it("registers (Argon2id, no e-mail, authVersion 0), rejects a duplicate by the unique index and keeps the original", async () => {
    const call = await boot();
    expect((await call("POST", "register", valid)).status).toBe(201);
    const u = await prisma.user.findUniqueOrThrow({ where: { username: valid.username } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.authVersion).toBe(0);
    expect(u.email).toBeNull();
    // simultaneous duplicates: exactly one wins
    const results = await Promise.all(Array.from({ length: 5 }, () => call("POST", "register", { ...valid, username: "race_user" })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.user.count()).toBe(2);
    expect((await call("POST", "register", { ...valid, name: "Attacker", password: "attackerpass1" })).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: valid.username } })).name).toBe("Ali");
  });

  it("full session lifecycle: login, /me, password change revokes the token, logout-all revokes it too", async () => {
    const call = await boot();
    await call("POST", "register", valid);
    const login = await call("POST", "login", { username: valid.username, password: valid.password });
    const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(200);

    expect((await call("POST", "change-password", { currentPassword: valid.password, newPassword: "brand-new-pass-2" }, { cookie })).status).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: valid.username } })).authVersion).toBe(1);
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(401);

    const again = await call("POST", "login", { username: valid.username, password: "brand-new-pass-2" });
    const cookie2 = again.headers.getSetCookie()[0]!.split(";")[0]!;
    expect((await call("GET", "me", undefined, { cookie: cookie2 })).status).toBe(200);
    expect((await call("POST", "logout-all", undefined, { cookie: cookie2 })).status).toBe(204);
    expect((await call("GET", "me", undefined, { cookie: cookie2 })).status).toBe(401);
    expect((await call("POST", "login", { username: valid.username, password: "brand-new-pass-2" })).status).toBe(200);
  });

  it("a token for a user deleted from the database is rejected", async () => {
    const call = await boot();
    await call("POST", "register", valid);
    const login = await call("POST", "login", { username: valid.username, password: valid.password });
    const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;
    await prisma.user.delete({ where: { username: valid.username } });
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(401);
  });

  it("the database refuses malformed usernames even if the application were bypassed", async () => {
    await expect(prisma.user.create({ data: { name: "x", username: "Bad Name", passwordHash: "x" } })).rejects.toThrow();
  });
});

describe("PostgresRateLimiter (shared backend)", () => {
  it("counts across instances, blocks, resets after the window and is atomic under concurrency", async () => {
    const a = new PostgresRateLimiter(prisma);
    const b = new PostgresRateLimiter(prisma);
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await a.consume("k1", rule)).allowed).toBe(true);
    expect((await b.consume("k1", rule)).allowed).toBe(true);
    const blocked = await a.consume("k1", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "resetAt" = now() - interval '1 second' WHERE "key" = 'k1'`;
    expect((await b.consume("k1", rule)).allowed).toBe(true);
    const results = await Promise.all(Array.from({ length: 20 }, () => a.consume("burst", { limit: 5, windowSeconds: 60 })));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
