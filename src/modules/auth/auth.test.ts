import { describe, expect, it } from "vitest";
import { decode, encode } from "next-auth/jwt";
import { hashPassword, verifyPassword, verifyDummyPassword } from "./password";
import { MemoryRateLimiter, getClientIp, rateLimitKey } from "./rate-limit";
import { loginSchema, registerSchema } from "./schemas";

describe("schemas (server-side validation)", () => {
  it("normalises email and accepts valid registration", () => {
    const r = registerSchema.parse({ name: " Ali ", email: " ALI@Example.COM ", password: "12345678" });
    expect(r).toEqual({ name: "Ali", email: "ali@example.com", password: "12345678" });
  });
  it.each([
    [{ name: "", email: "a@b.co", password: "12345678" }],
    [{ name: "x", email: "not-an-email", password: "12345678" }],
    [{ name: "x", email: "a@b.co", password: "short" }],
    [{ name: "x", email: "a@b.co", password: "x".repeat(129) }],
    [{ name: "x", email: "a@b.co" }],
    [null],
  ])("rejects invalid registration %j", (input) => {
    expect(registerSchema.safeParse(input).success).toBe(false);
  });
  it("rejects malformed login input", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: ["a@b.co"], password: "x" }).success).toBe(false);
  });
});

describe("password hashing", () => {
  it("uses Argon2id, salts hashes and verifies correctly", async () => {
    const h1 = await hashPassword("correct horse");
    const h2 = await hashPassword("correct horse");
    expect(h1).toMatch(/^\$argon2id\$/);
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain("correct horse");
    expect(await verifyPassword(h1, "correct horse")).toBe(true);
    expect(await verifyPassword(h1, "wrong")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
    expect(await verifyDummyPassword("x")).toBe(false);
  });
});

describe("MemoryRateLimiter", () => {
  it("blocks after the limit and recovers after the window", async () => {
    let now = 0;
    const l = new MemoryRateLimiter(() => now);
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await l.consume("k", rule)).allowed).toBe(true);
    expect((await l.consume("k", rule)).allowed).toBe(true);
    const blocked = await l.consume("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await l.consume("other", rule)).allowed).toBe(true);
    now = 61_000;
    expect((await l.consume("k", rule)).allowed).toBe(true);
  });
  it("keys do not contain raw values", () => {
    expect(rateLimitKey("login:email", "victim@example.com")).not.toContain("victim");
  });
  it("extracts client IP", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    expect(getClientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(getClientIp(h({}))).toBe("unknown");
  });
});

describe("JWT expiry", () => {
  const secret = "test-secret-test-secret-test-secret-123";
  const salt = "authjs.session-token";
  it("decodes a valid token and rejects an expired one", async () => {
    const good = await encode({ token: { sub: "u1", authVersion: 0 }, secret, salt, maxAge: 60 });
    expect((await decode({ token: good, secret, salt }))?.sub).toBe("u1");
    const expired = await encode({ token: { sub: "u1" }, secret, salt, maxAge: -120 });
    await expect(decode({ token: expired, secret, salt })).rejects.toThrow();
  });
  it("rejects a token signed with another secret", async () => {
    const t = await encode({ token: { sub: "u1" }, secret: "other-secret-other-secret-other-secret", salt, maxAge: 60 });
    await expect(decode({ token: t, secret, salt })).rejects.toThrow();
  });
});
