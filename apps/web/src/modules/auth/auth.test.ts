import { describe, expect, it } from "vitest";
import { decode, encode } from "next-auth/jwt";
import { hashPassword, verifyPassword, verifyDummyPassword } from "./password";
import { MemoryRateLimiter, getClientIp, rateLimitKey } from "./rate-limit";
import { RESERVED_USERNAMES, USERNAME_PATTERN, loginSchema, normalizeUsername, registerSchema } from "./schemas";

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
  it("the pattern matches the database CHECK and every reserved name is itself a valid pattern (so only the list rejects it)", () => {
    expect(USERNAME_PATTERN.source).toBe("^[a-z][a-z0-9_]{2,29}$"); // same as CHECK "User_username_format" in the U1 migration
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
    expect(rateLimitKey("login:username", "victim_user")).not.toContain("victim");
  });
  it("ignores forwarding headers unless the proxy is explicitly trusted", () => {
    const h = { get: (n: string) => (n === "x-forwarded-for" ? "6.6.6.6" : null) };
    expect(getClientIp(h, {})).toBe("unknown");
    expect(getClientIp(h, { TRUST_PROXY_HEADERS: "false" })).toBe("unknown");
  });
  it("counts X-Forwarded-For from the right so client-supplied entries cannot pick the bucket", () => {
    const h = (v: string | null) => ({ get: (n: string) => (n === "x-forwarded-for" ? v : null) });
    const on = { TRUST_PROXY_HEADERS: "true" };
    // client spoofed 6.6.6.6; the trusted proxy appended the real address
    expect(getClientIp(h("6.6.6.6, 203.0.113.7"), on)).toBe("203.0.113.7");
    expect(getClientIp(h("203.0.113.7"), on)).toBe("203.0.113.7");
    // two trusted proxies (e.g. CDN + load balancer)
    expect(getClientIp(h("6.6.6.6, 203.0.113.7, 10.0.0.2"), { ...on, TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.7");
    expect(getClientIp(h("2001:db8::1"), on)).toBe("2001:db8::1");
  });
  it("falls back to unknown for missing, malformed or too-short headers", () => {
    const h = (v: string | null) => ({ get: (n: string) => (n === "x-forwarded-for" ? v : null) });
    const on = { TRUST_PROXY_HEADERS: "true" };
    expect(getClientIp(h(null), on)).toBe("unknown");
    expect(getClientIp(h("not-an-ip"), on)).toBe("unknown");
    expect(getClientIp(h("1.2.3.4"), { ...on, TRUSTED_PROXY_HOPS: "2" })).toBe("unknown");
    expect(getClientIp(h("1.2.3.4"), { ...on, TRUSTED_PROXY_HOPS: "0" })).toBe("unknown");
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
