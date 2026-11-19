import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../auth/password.js";
import { RESERVED_USERNAMES, USERNAME_PATTERN, loginSchema, normalizeUsername, registerSchema } from "../auth/schemas.js";
import { rateLimitKey } from "../auth/rate-limit.js";
import { readCookie } from "../auth/cookie.js";
import { TokenService } from "../auth/token.js";
import { MemoryRateLimiter } from "./memory.js";

describe("schemas (server-side validation, username: ADR 0001 U1)", () => {
  it("normalises the username (spaces, case, Persian and Arabic digits) and accepts a valid registration", () => {
    const r = registerSchema.parse({ name: " Ali ", username: " ALI_Shop۱۲٣ ", password: "12345678" });
    expect(r).toEqual({ name: "Ali", username: "ali_shop123", password: "12345678" });
    expect(normalizeUsername("  Zahra_۹ ")).toBe("zahra_9");
  });
  it.each([
    [{ name: "", username: "ali_ok", password: "12345678" }],
    [{ name: "x", username: "ab", password: "12345678" }],
    [{ name: "x", username: "1abc", password: "12345678" }],
    [{ name: "x", username: "ali.x", password: "12345678" }],
    [{ name: "x", username: "ali x", password: "12345678" }],
    [{ name: "x", username: "علی_رضا", password: "12345678" }],
    [{ name: "x", username: "a".repeat(31), password: "12345678" }],
    [{ name: "x", username: "admin", password: "12345678" }],
    [{ name: "x", username: "ali_ok", password: "short" }],
    [{ name: "x", username: "ali_ok", password: "x".repeat(129) }],
    [{ name: "x", username: "ali_ok" }],
    [{ name: "x", email: "a@b.co", password: "12345678" }],
    [null],
  ])("rejects invalid registration %j", (input) => {
    expect(registerSchema.safeParse(input).success).toBe(false);
  });
  it("the pattern matches the database CHECK and every reserved name is itself a valid pattern", () => {
    expect(USERNAME_PATTERN.source).toBe("^[a-z][a-z0-9_]{2,29}$"); // same as CHECK "User_username_format"
    for (const r of RESERVED_USERNAMES) expect(USERNAME_PATTERN.test(r), r).toBe(true);
  });
  it("rejects malformed login input", () => {
    expect(loginSchema.safeParse({ username: "ali_ok", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: ["ali_ok"], password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(false);
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

describe("MemoryRateLimiter and keys", () => {
  it("blocks after the limit and recovers after the window", async () => {
    let now = 0;
    const l = new MemoryRateLimiter(() => now);
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await l.consume("k", rule)).allowed).toBe(true);
    expect((await l.consume("k", rule)).allowed).toBe(true);
    expect((await l.consume("k", rule)).allowed).toBe(false);
    now = 61_000;
    expect((await l.consume("k", rule)).allowed).toBe(true);
  });
  it("keys do not contain raw values", () => {
    expect(rateLimitKey("login:username", "victim_user")).not.toContain("victim");
  });
});

describe("session token (HS256 JWT)", () => {
  const secret = "test-secret-test-secret-test-secret-123";
  const key = new TextEncoder().encode(secret);
  it("round-trips the claims", async () => {
    const t = new TokenService(secret, 60);
    expect(await t.verify(await t.sign({ userId: "u1", authVersion: 3 }))).toEqual({ userId: "u1", authVersion: 3 });
  });
  it("rejects an expired token", async () => {
    const t = new TokenService(secret, 60);
    const old = await new SignJWT({ av: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setIssuer("store-builder-api").setAudience("store-builder").setIssuedAt(1).setExpirationTime(2).sign(key);
    expect(await t.verify(old)).toBeNull();
  });
  it("rejects another secret, wrong issuer/audience, a missing or non-integer authVersion, alg none and garbage", async () => {
    const t = new TokenService(secret, 60);
    const other = new TokenService("another-secret-another-secret-0123456789", 60);
    expect(await t.verify(await other.sign({ userId: "u1", authVersion: 0 }))).toBeNull();
    const base = () => new SignJWT({ av: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setExpirationTime("60s");
    expect(await t.verify(await base().setIssuer("x").setAudience("store-builder").sign(key))).toBeNull();
    expect(await t.verify(await base().setIssuer("store-builder-api").setAudience("x").sign(key))).toBeNull();
    const ok = () => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setIssuer("store-builder-api").setAudience("store-builder").setExpirationTime("60s");
    expect(await t.verify(await ok().sign(key))).toBeNull();
    expect(await t.verify(await new SignJWT({ av: "0" }).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setIssuer("store-builder-api").setAudience("store-builder").setExpirationTime("60s").sign(key))).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"u1","av":0}').toString("base64url")}.`;
    expect(await t.verify(none)).toBeNull();
    expect(await t.verify("not-a-jwt")).toBeNull();
  });
});

describe("cookie parsing", () => {
  it("finds a cookie by exact name", () => {
    expect(readCookie("a=1; sb_session=tok; b=2", "sb_session")).toBe("tok");
    expect(readCookie("xsb_session=tok", "sb_session")).toBeNull();
    expect(readCookie("sb_session=", "sb_session")).toBeNull();
    expect(readCookie(undefined, "sb_session")).toBeNull();
  });
});
