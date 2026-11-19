import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { jwtCallback } from "./callbacks";
import { MemoryRateLimiter, PostgresRateLimiter } from "./rate-limit";
import { authenticate, invalidateUserSessions, registerUser } from "./service";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

beforeEach(async () => {
  await resetDb();
  authMock.mockReset();
});
afterAll(() => prisma.$disconnect());

const valid = { name: "Ali", username: "ali_test", password: "password123" };
const ctx = () => ({ ip: "1.1.1.1", limiter: new MemoryRateLimiter() });

describe("registration (username, ADR 0001 U1)", () => {
  it("creates a user with an Argon2id hash and no raw password, and without any e-mail", async () => {
    expect(await registerUser(valid, ctx())).toEqual({ ok: true });
    const u = await prisma.user.findUniqueOrThrow({ where: { username: valid.username } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain(valid.password);
    expect(u.authVersion).toBe(0);
    expect(u.email).toBeNull();
  });
  it("reports a taken username (it must be chosen again) and never modifies the existing account", async () => {
    await registerUser(valid, ctx());
    const second = await registerUser({ ...valid, name: "Attacker", password: "attackerpass1" }, ctx());
    expect(second).toMatchObject({ ok: false, error: "username_taken", fieldErrors: { username: expect.any(Array) } });
    expect(await prisma.user.count()).toBe(1);
    const u = await prisma.user.findUniqueOrThrow({ where: { username: valid.username } });
    expect(u.name).toBe("Ali");
    expect((await authenticate({ username: valid.username, password: valid.password }, ctx())).ok).toBe(true);
    expect((await authenticate({ username: valid.username, password: "attackerpass1" }, ctx())).ok).toBe(false);
  });
  it("normalises case, spaces and Persian digits, so look-alike names are the same account", async () => {
    await registerUser({ ...valid, username: "ali_۱۲" }, ctx());
    expect(await registerUser({ ...valid, username: "  ALI_12 " }, ctx())).toMatchObject({ ok: false, error: "username_taken" });
    expect(await prisma.user.findMany({ select: { username: true } })).toEqual([{ username: "ali_12" }]);
  });
  it("returns field errors for invalid or reserved usernames and creates nothing", async () => {
    for (const username of ["ab", "1abc", "ali-x", "علی", "a".repeat(31), "admin", "API"]) {
      const r = await registerUser({ ...valid, username }, ctx());
      expect(r, username).toMatchObject({ ok: false, error: "invalid", fieldErrors: { username: expect.any(Array) } });
    }
    expect(await registerUser({ name: "", username: "ok_name", password: "x" }, ctx())).toMatchObject({ ok: false, error: "invalid" });
    expect(await prisma.user.count()).toBe(0);
  });
  it("is rate limited per IP", async () => {
    const c = ctx();
    for (let i = 0; i < 5; i++) await registerUser({ ...valid, username: `user_${i}` }, c);
    const r = await registerUser({ ...valid, username: "user_9" }, c);
    expect(r).toMatchObject({ ok: false, error: "rate_limited" });
    expect(await prisma.user.count()).toBe(5);
  });
});

describe("login", () => {
  beforeEach(async () => {
    await registerUser(valid, ctx());
  });
  it("succeeds with correct credentials (case and spaces normalised) and returns only safe fields", async () => {
    const r = await authenticate({ username: " ALI_Test ", password: valid.password }, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.user).sort()).toEqual(["id", "name", "username"]);
      expect(JSON.stringify(r)).not.toContain("argon2");
    }
  });
  it("returns the identical outcome for wrong password, unknown username and malformed input", async () => {
    const wrongPw = await authenticate({ username: valid.username, password: "nope-nope" }, ctx());
    const unknown = await authenticate({ username: "ghost_user", password: "password123" }, ctx());
    const malformed = await authenticate({ username: 5, password: null }, ctx());
    expect(wrongPw).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual(wrongPw);
    expect(malformed).toEqual(wrongPw);
  });
  it("rate limits repeated attempts on one username even from different IPs", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 10; i++) {
      const r = await authenticate({ username: valid.username, password: "bad-bad-bad" }, { ip: `9.9.9.${i}`, limiter });
      expect(r).toEqual({ ok: false, reason: "invalid" });
    }
    const blocked = await authenticate({ username: valid.username, password: valid.password }, { ip: "9.9.9.99", limiter });
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
  });
  it("rate limits one IP across many usernames", async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 30; i++) await authenticate({ username: `x_user_${i}`, password: "whatever1" }, { ip: "8.8.8.8", limiter });
    const r = await authenticate({ username: valid.username, password: valid.password }, { ip: "8.8.8.8", limiter });
    expect(r).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("session invalidation via authVersion", () => {
  it("accepts a current token, rejects after authVersion bump, rejects deleted users and malformed tokens", async () => {
    await registerUser(valid, ctx());
    const login = await authenticate(valid, ctx());
    if (!login.ok) throw new Error("login failed");
    const { id } = login.user;

    const issued = await jwtCallback({ token: {}, user: { id, authVersion: login.authVersion } });
    expect(issued).toMatchObject({ sub: id, authVersion: 0 });
    expect(await jwtCallback({ token: { ...issued! } })).not.toBeNull();

    await invalidateUserSessions(id);
    expect(await jwtCallback({ token: { ...issued! } })).toBeNull(); // old JWT revoked

    const fresh = await authenticate(valid, ctx());
    if (!fresh.ok) throw new Error("login failed");
    const newToken = await jwtCallback({ token: {}, user: { id, authVersion: fresh.authVersion } });
    expect(newToken).toMatchObject({ authVersion: 1 });
    expect(await jwtCallback({ token: { ...newToken! } })).not.toBeNull(); // new JWT works

    expect(await jwtCallback({ token: { sub: id } })).toBeNull(); // missing authVersion
    expect(await jwtCallback({ token: { sub: id, authVersion: "1" as unknown as number } })).toBeNull();
    expect(await jwtCallback({ token: {} })).toBeNull(); // no subject

    await prisma.user.delete({ where: { id } });
    expect(await jwtCallback({ token: { ...newToken! } })).toBeNull();
  });
});

describe("unauthorized dashboard access (requireUser)", () => {
  it("redirects to /login when there is no session", async () => {
    const { requireUser } = await import("./session");
    authMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("redirects when the session user no longer exists", async () => {
    const { requireUser } = await import("./session");
    authMock.mockResolvedValue({ user: { id: "missing" } });
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
  it("returns only safe user fields for a valid session", async () => {
    const { requireUser } = await import("./session");
    await registerUser(valid, ctx());
    const u = await prisma.user.findUniqueOrThrow({ where: { username: valid.username } });
    authMock.mockResolvedValue({ user: { id: u.id } });
    const user = await requireUser();
    expect(user).toEqual({ id: u.id, username: valid.username, name: "Ali" });
  });
});

describe("PostgresRateLimiter (shared backend)", () => {
  it("counts across limiter instances, blocks, and resets after the window", async () => {
    const a = new PostgresRateLimiter();
    const b = new PostgresRateLimiter(); // simulates a second app instance
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await a.consume("k1", rule)).allowed).toBe(true);
    expect((await b.consume("k1", rule)).allowed).toBe(true);
    const blocked = await a.consume("k1", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await a.consume("k2", rule)).allowed).toBe(true);
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "resetAt" = now() - interval '1 second' WHERE "key" = 'k1'`;
    expect((await b.consume("k1", rule)).allowed).toBe(true);
  });
  it("is atomic under concurrency", async () => {
    const l = new PostgresRateLimiter();
    const rule = { limit: 5, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 20 }, () => l.consume("burst", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
