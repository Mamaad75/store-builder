import { afterEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.js";
import { capture, fakeDb, testConfig } from "./helpers.js";
import { MemoryRateLimiter, MemoryUsers } from "./memory.js";

let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ORIGIN = "http://localhost:3000";
const valid = { name: "Ali", username: "ali_test", password: "password123" };

async function boot(over: { config?: Partial<typeof testConfig>; limiter?: MemoryRateLimiter } = {}) {
  const users = new MemoryUsers();
  const cap = capture();
  app = await createApp({ ...testConfig, trustProxyHops: 1, ...over.config }, { database: fakeDb(), users, rateLimiter: over.limiter ?? new MemoryRateLimiter(), logger: cap.logger });
  await app.listen(0, "127.0.0.1");
  const base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  let n = 0;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/auth/${path}`, {
      method,
      headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.0.0.${++n % 250}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { call, users, cap };
}
const cookieOf = (res: Response) => (res.headers.getSetCookie()[0] ?? "").split(";")[0]!;

async function registerAndLogin(call: Awaited<ReturnType<typeof boot>>["call"]) {
  expect((await call("POST", "register", valid)).status).toBe(201);
  const res = await call("POST", "login", { username: valid.username, password: valid.password });
  expect(res.status).toBe(200);
  return { res, cookie: cookieOf(res) };
}

describe("registration", () => {
  it("creates an account, stores an Argon2id hash and returns nothing sensitive", async () => {
    const { call, users } = await boot();
    const res = await call("POST", "register", valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const u = [...users.rows.values()][0]!;
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain(valid.password);
  });
  it("reports a taken username (409) and never modifies the existing account", async () => {
    const { call, users } = await boot();
    await call("POST", "register", valid);
    const r = await call("POST", "register", { ...valid, name: "Attacker", password: "attackerpass1" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "username_taken", fieldErrors: { username: expect.any(Array) } });
    expect(users.rows.size).toBe(1);
    expect([...users.rows.values()][0]!.name).toBe("Ali");
  });
  it("normalises look-alike names into the same account", async () => {
    const { call, users } = await boot();
    await call("POST", "register", { ...valid, username: "ali_۱۲" });
    expect((await call("POST", "register", { ...valid, username: "  ALI_12 " })).status).toBe(409);
    expect([...users.rows.values()].map((u) => u.username)).toEqual(["ali_12"]);
  });
  it("answers 400 with field errors for invalid or reserved usernames and creates nothing", async () => {
    const { call, users } = await boot();
    for (const username of ["ab", "1abc", "ali-x", "علی", "a".repeat(31), "admin", "API"]) {
      const r = await call("POST", "register", { ...valid, username });
      expect(r.status, username).toBe(400);
      expect(((await r.json()) as { fieldErrors: { username: unknown } }).fieldErrors.username).toEqual(expect.any(Array));
    }
    expect((await call("POST", "register", { name: "", username: "ok_name", password: "x" })).status).toBe(400);
    expect((await call("POST", "register")).status).toBe(400);
    expect(users.rows.size).toBe(0);
  });
  it("is rate limited per client IP (the address the proxy appended)", async () => {
    const { call, users } = await boot();
    for (let i = 0; i < 5; i++) await call("POST", "register", { ...valid, username: `user_${i}` }, { "x-forwarded-for": "203.0.113.9" });
    const r = await call("POST", "register", { ...valid, username: "user_9" }, { "x-forwarded-for": "203.0.113.9" });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await r.json()).toMatchObject({ code: "rate_limited", retryAfterSeconds: expect.any(Number) });
    expect(users.rows.size).toBe(5);
    // a spoofed first entry does not choose the bucket
    expect((await call("POST", "register", { ...valid, username: "user_8" }, { "x-forwarded-for": "6.6.6.6, 203.0.113.9" })).status).toBe(429);
  });
});

describe("login, session cookie and /me", () => {
  it("sets a httpOnly SameSite=Lax cookie (not Secure over http) and returns only safe fields", async () => {
    const { call } = await boot();
    const { res } = await registerAndLogin(call);
    const sc = res.headers.getSetCookie()[0]!;
    expect(sc).toMatch(/^sb_session=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    expect(sc).toMatch(/Max-Age=604800/);
    expect(sc).not.toMatch(/Secure/i);
    expect(sc).not.toMatch(/Domain=/i);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(Object.keys(body.user).sort()).toEqual(["id", "name", "username"]);
    expect(JSON.stringify(body)).not.toMatch(/argon2/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("uses the __Host- prefix and Secure over https", async () => {
    const { call } = await boot({ config: { secureCookies: true, protocol: "https", allowedOrigins: [ORIGIN] } });
    const { res } = await registerAndLogin(call);
    const sc = res.headers.getSetCookie()[0]!;
    expect(sc).toMatch(/^__Host-sb_session=/);
    expect(sc).toMatch(/Secure/i);
  });
  it("accepts username case and spaces", async () => {
    const { call } = await boot();
    await call("POST", "register", valid);
    expect((await call("POST", "login", { username: " ALI_Test ", password: valid.password })).status).toBe(200);
  });
  it("gives the identical 401 for wrong password, unknown user and malformed input", async () => {
    const { call } = await boot();
    await call("POST", "register", valid);
    const bodies = [];
    for (const b of [{ username: valid.username, password: "nope-nope" }, { username: "ghost_user", password: "password123" }, { username: 5, password: null }, undefined]) {
      const r = await call("POST", "login", b);
      expect(r.status).toBe(401);
      expect(r.headers.getSetCookie()).toEqual([]);
      bodies.push(await r.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
  it("rate limits repeated attempts on one username across different IPs, and one IP across many usernames", async () => {
    const { call } = await boot();
    await call("POST", "register", valid);
    for (let i = 0; i < 10; i++) expect((await call("POST", "login", { username: valid.username, password: "bad-bad-bad" }, { "x-forwarded-for": `9.9.9.${i}` })).status).toBe(401);
    expect((await call("POST", "login", { username: valid.username, password: valid.password }, { "x-forwarded-for": "9.9.9.99" })).status).toBe(429);
    for (let i = 0; i < 30; i++) await call("POST", "login", { username: `x_user_${i}`, password: "whatever1" }, { "x-forwarded-for": "8.8.8.8" });
    expect((await call("POST", "login", { username: "fresh_user", password: "whatever1" }, { "x-forwarded-for": "8.8.8.8" })).status).toBe(429);
  });
  it("/me returns the user for a valid cookie and 401 without, with garbage, or with a forged token", async () => {
    const { call } = await boot();
    const { cookie } = await registerAndLogin(call);
    const me = await call("GET", "me", undefined, { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: unknown }).user).toMatchObject({ username: valid.username, name: "Ali" });
    expect((await call("GET", "me")).status).toBe(401);
    expect((await call("GET", "me", undefined, { cookie: "sb_session=garbage" })).status).toBe(401);
    expect((await call("GET", "me", undefined, { cookie: "sb_session=" })).status).toBe(401);
  });
  it("a token for a deleted user is rejected", async () => {
    const { call, users } = await boot();
    const { cookie } = await registerAndLogin(call);
    users.rows.clear();
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(401);
  });
});

describe("logout, password change and sign out everywhere", () => {
  it("logout clears the cookie", async () => {
    const { call } = await boot();
    const { cookie } = await registerAndLogin(call);
    const r = await call("POST", "logout", undefined, { cookie });
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie()[0]).toMatch(/^sb_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });
  it("change-password needs the current password, ends every session and the new password works", async () => {
    const { call, users } = await boot();
    const { cookie } = await registerAndLogin(call);
    const before = [...users.rows.values()][0]!.authVersion;
    const bad = await call("POST", "change-password", { currentPassword: "wrong-password", newPassword: "brand-new-pass-2" }, { cookie });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "wrong_password", fieldErrors: { currentPassword: expect.any(Array) } });
    expect([...users.rows.values()][0]!.authVersion).toBe(before);

    const ok = await call("POST", "change-password", { currentPassword: valid.password, newPassword: "brand-new-pass-2" }, { cookie });
    expect(ok.status).toBe(204);
    expect(ok.headers.getSetCookie()[0]).toMatch(/^sb_session=;/);
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(401); // the old token is revoked
    expect((await call("POST", "login", { username: valid.username, password: valid.password })).status).toBe(401);
    expect((await call("POST", "login", { username: valid.username, password: "brand-new-pass-2" })).status).toBe(200);
  });
  it("change-password validates input and is rate limited per user", async () => {
    const { call } = await boot();
    const { cookie } = await registerAndLogin(call);
    expect((await call("POST", "change-password", { currentPassword: valid.password, newPassword: valid.password }, { cookie })).status).toBe(400);
    expect((await call("POST", "change-password", { currentPassword: valid.password, newPassword: "short" }, { cookie })).status).toBe(400);
    for (let i = 0; i < 8; i++) await call("POST", "change-password", { currentPassword: "nope-nope-1", newPassword: "brand-new-pass-2" }, { cookie });
    expect((await call("POST", "change-password", { currentPassword: valid.password, newPassword: "brand-new-pass-2" }, { cookie })).status).toBe(429);
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(200); // nothing changed
  });
  it("logout-all revokes every issued token without touching the password", async () => {
    const { call } = await boot();
    const { cookie } = await registerAndLogin(call);
    const second = cookieOf(await call("POST", "login", { username: valid.username, password: valid.password }));
    expect((await call("POST", "logout-all", undefined, { cookie })).status).toBe(204);
    expect((await call("GET", "me", undefined, { cookie })).status).toBe(401);
    expect((await call("GET", "me", undefined, { cookie: second })).status).toBe(401);
    expect((await call("POST", "login", { username: valid.username, password: valid.password })).status).toBe(200);
  });
  it("protected routes answer 401 without a session", async () => {
    const { call } = await boot();
    for (const p of ["change-password", "logout-all"]) expect((await call("POST", p, {})).status).toBe(401);
  });
});

describe("CSRF and logging", () => {
  it("every state-changing auth route refuses a missing, foreign or cross-site Origin", async () => {
    const { call } = await boot();
    for (const p of ["register", "login", "logout", "change-password", "logout-all"]) {
      expect((await call("POST", p, {}, { origin: "https://evil.example" })).status, p).toBe(403);
      expect((await call("POST", p, {}, { origin: "null" })).status, p).toBe(403);
      expect((await call("POST", p, {}, { origin: ORIGIN, "sec-fetch-site": "cross-site" })).status, p).toBe(403);
    }
    const noOrigin = await fetch(`${(await app!.getUrl()).replace("[::1]", "127.0.0.1")}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(noOrigin.status).toBe(403);
  });
  it("no credential, token or cookie value reaches the logs", async () => {
    const { call, cap } = await boot();
    const { cookie } = await registerAndLogin(call);
    await call("POST", "login", { username: valid.username, password: "wrong-wrong-1" });
    await call("POST", "change-password", { currentPassword: "wrong-wrong-1", newPassword: "brand-new-pass-2" }, { cookie });
    const all = cap.lines.join("\n");
    for (const secret of [valid.password, "wrong-wrong-1", "brand-new-pass-2", cookie.split("=")[1]!, testConfig.authSecret]) expect(all).not.toContain(secret);
  });
  it("a malformed JSON body is a fixed 400", async () => {
    const { call } = await boot();
    const res = await fetch(`${(await app!.getUrl()).replace("[::1]", "127.0.0.1")}/api/auth/login`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ statusCode: 400, error: "Bad Request" });
    void call;
  });
});
