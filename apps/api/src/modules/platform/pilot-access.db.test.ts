import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../../app.js";
import { hashPassword } from "../../auth/password.js";
import { TokenService } from "../../auth/token.js";
import { listenFetchable, testConfig } from "../../__tests__/helpers.js";
import { makeStore, makeUser, prisma, resetDb } from "../../test/db-helpers.js";

/**
 * MVP item 2 (pilot access controls, roadmap §12.3) on real PostgreSQL over HTTP:
 *  - invite-only registration (the fail-closed default): single-use codes, redeemed atomically with the account, expiry, revocation;
 *  - admin-assisted recovery: SUPER_ADMIN only, own password re-entered (rate-limited, failures audited), reason + out-of-band identity
 *    attestation, never another admin or oneself; every session ends, the old password stops working, a single-use 24 h link.
 */
const PLATFORM = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const sessions = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const ADMIN_PW = "admin-password-123";
const OWNER_PW = "owner-password-123";

let app: NestExpressApplication | undefined;
let base = "";
let ipN = 0;

beforeEach(async () => {
  await resetDb();
  await prisma.platformSetting.deleteMany({ where: { key: "registration" } }); // resetDb keeps platform settings: start from the default
  ({ app, base } = await listenFetchable(() => createApp(config)));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => prisma.$disconnect());

/** Each call from its own client address (registration is rate-limited per IP). */
async function call(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}/api${path}`, {
    method,
    headers: { origin: PLATFORM, "x-forwarded-for": `10.9.${Math.floor(++ipN / 250)}.${ipN % 250}`, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  return { status: r.status, text: t, json: (t ? JSON.parse(t) : null) as any };
}
async function sessionOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return `sb_session=${await sessions.sign({ userId: u.id, authVersion: u.authVersion })}`;
}
async function admin() {
  const u = await prisma.user.create({ data: { username: `admin_${++ipN}`, name: "مدیر", passwordHash: await hashPassword(ADMIN_PW) } });
  await prisma.platformAdmin.create({ data: { userId: u.id } });
  return { id: u.id, cookie: await sessionOf(u.id) };
}
const register = (username: string, inviteCode?: string) => call("", "POST", "/auth/register", { name: "فروشنده", username, password: OWNER_PW, ...(inviteCode !== undefined ? { inviteCode } : {}) });
const login = (username: string, password: string) => call("", "POST", "/auth/login", { username, password });

describe("invite-only registration (MVP item 2)", () => {
  it("is the default: sign-up without a code is refused; GET /auth/registration says so", async () => {
    expect((await call("", "GET", "/auth/registration")).json).toEqual({ mode: "invite" });
    const r = await register("newshop");
    expect(r.status).toBe(400);
    expect(r.json.fieldErrors.inviteCode).toBeDefined();
    expect(await prisma.user.count({ where: { username: "newshop" } })).toBe(0);
  });

  it("a super admin issues a code (shown once, only its hash stored, audited); it creates exactly one account", async () => {
    const a = await admin();
    const issued = await call(a.cookie, "POST", "/platform/invites", { note: "فروشگاه پایلوت ۱", days: 3 });
    expect(issued.status).toBe(201);
    const { code, url, id } = issued.json;
    expect(url).toBe(`http://localhost:3000/register?invite=${code}`);
    const row = await prisma.registrationInvite.findUniqueOrThrow({ where: { id } });
    expect(row.codeHash).toBe(sha256(code));
    expect(JSON.stringify(await prisma.registrationInvite.findMany())).not.toContain(code);
    expect(await prisma.auditEvent.count({ where: { action: "platform.invite_created", actorId: a.id, targetId: id } })).toBe(1);

    expect((await register("pilotshop", code)).status).toBe(201);
    const used = await prisma.registrationInvite.findUniqueOrThrow({ where: { id }, include: { usedBy: true } });
    expect([used.usedAt !== null, used.usedBy?.username]).toEqual([true, "pilotshop"]);
    const again = await register("secondshop", code);
    expect([again.status, again.json.fieldErrors.inviteCode?.length]).toEqual([400, 1]);
    expect((await call(a.cookie, "GET", "/platform/invites")).json).toMatchObject([{ id, status: "used", usedBy: "pilotshop", note: "فروشگاه پایلوت ۱" }]);
  });

  it("a taken username leaves the code unused; expired and revoked codes are refused; revoke is audited and single-shot", async () => {
    const a = await admin();
    await makeUser(); // user_N exists
    const taken = (await prisma.user.findFirstOrThrow({ where: { username: { startsWith: "user_" } } })).username;
    const { code, id } = (await call(a.cookie, "POST", "/platform/invites", {})).json;
    expect((await register(taken, code)).status).toBe(409);
    expect((await prisma.registrationInvite.findUniqueOrThrow({ where: { id } })).usedAt).toBeNull();
    expect((await register("freshname", code)).status).toBe(201);

    const old = (await call(a.cookie, "POST", "/platform/invites", {})).json;
    await prisma.registrationInvite.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await register("lateshop", old.code)).status).toBe(400);

    const rev = (await call(a.cookie, "POST", "/platform/invites", {})).json;
    expect((await call(a.cookie, "POST", `/platform/invites/${rev.id}/revoke`)).status).toBe(204);
    expect((await call(a.cookie, "POST", `/platform/invites/${rev.id}/revoke`)).status).toBe(404);
    expect((await register("revokedshop", rev.code)).status).toBe(400);
    expect(await prisma.auditEvent.count({ where: { action: "platform.invite_revoked", targetId: rev.id } })).toBe(1);
  });

  it("the same code used twice at once creates exactly one account", async () => {
    const a = await admin();
    const { code } = (await call(a.cookie, "POST", "/platform/invites", {})).json;
    const results = await Promise.all(["race_a", "race_b", "race_c", "race_d"].map((u) => register(u, code)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400, 400]);
    expect(await prisma.user.count({ where: { username: { startsWith: "race_" } } })).toBe(1);
  });

  it("opened by a super admin: sign-up works without a code; only super admins manage invites and the mode", async () => {
    const a = await admin();
    const stranger = await makeUser();
    const s = await sessionOf(stranger.id);
    expect((await call(s, "GET", "/platform/invites")).status).toBe(403);
    expect((await call(s, "POST", "/platform/invites", {})).status).toBe(403);
    expect((await call("", "POST", "/platform/invites", {})).status).toBe(401);
    expect((await call(s, "PATCH", "/v1/platform/settings/registration", { mode: "open" })).status).toBe(403);
    expect((await call(a.cookie, "PATCH", "/v1/platform/settings/registration", { mode: "open" })).status).toBe(200);
    expect((await call("", "GET", "/auth/registration")).json).toEqual({ mode: "open" });
    expect((await register("openshop")).status).toBe(201);
  });
});

describe("admin-assisted account recovery (MVP item 2, roadmap §12.3)", () => {
  async function owner() {
    const u = await prisma.user.create({ data: { username: `owner_${++ipN}`, name: "صاحب فروشگاه", passwordHash: await hashPassword(OWNER_PW) } });
    await makeStore(u.id, "فروشگاه صاحب");
    return { id: u.id, username: u.username, cookie: await sessionOf(u.id) };
  }
  const request = (reason = "تماس تلفنی با شماره‌ی ثبت‌شده و پرسش‌های امنیتی", adminPassword = ADMIN_PW, identityVerified: unknown = true) => ({ adminPassword, reason, identityVerified });

  it("issues a single-use link: every session ends, the old password stops working, audited with the reason; the owner sets a new password", async () => {
    const a = await admin();
    const o = await owner();
    expect((await call(o.cookie, "GET", "/auth/me")).status).toBe(200);
    const found = await call(a.cookie, "GET", `/platform/users?username=${o.username}`);
    expect(found.json).toMatchObject({ id: o.id, username: o.username, isPlatformAdmin: false, stores: 1, recoveredAt: null });

    const r = await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request());
    expect(r.status).toBe(200);
    const token = new URL(r.json.url).searchParams.get("token")!;
    expect(r.json.url.startsWith("http://localhost:3000/recover?token=")).toBe(true);
    expect((await call(o.cookie, "GET", "/auth/me")).status).toBe(401); // every session ended
    expect((await login(o.username, OWNER_PW)).status).toBe(401); // the old password no longer works
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "platform.account_recovered", targetId: o.id } });
    expect([audit.actorId, audit.metadata]).toEqual([a.id, { reason: "تماس تلفنی با شماره‌ی ثبت‌شده و پرسش‌های امنیتی", identityVerifiedOutOfBand: true }]);
    expect(JSON.stringify(await prisma.auditEvent.findMany())).not.toContain(token);
    expect((await prisma.accountRecovery.findFirstOrThrow({ where: { userId: o.id } })).tokenHash).toBe(sha256(token));

    expect((await call("", "POST", "/auth/recover", { token, newPassword: "brand-new-pass-1" })).status).toBe(204);
    expect((await login(o.username, "brand-new-pass-1")).status).toBe(200);
    expect((await call("", "POST", "/auth/recover", { token, newPassword: "another-pass-22" })).status).toBe(400); // single use
    const fresh = await sessionOf(o.id);
    expect((await call(fresh, "GET", "/auth/notices")).json.recoveredAt).not.toBeNull();
  });

  it("refuses: non-admins (403); a wrong admin password (403, audited, then rate-limited 429); missing attestation or short reason (400)", async () => {
    const a = await admin();
    const o = await owner();
    expect((await call(o.cookie, "POST", `/platform/users/${o.id}/recovery`, request())).status).toBe(403);
    expect((await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request(undefined, ADMIN_PW, false))).status).toBe(400);
    expect((await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request("کوتاه"))).status).toBe(400);
    const wrong = await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request(undefined, "not-my-password"));
    expect([wrong.status, wrong.json.errorName]).toEqual([403, "ReauthFailedError"]);
    expect(await prisma.auditEvent.count({ where: { action: "security.reauth_failed", actorId: a.id } })).toBe(1);
    for (let i = 0; i < 4; i++) await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request(undefined, "not-my-password"));
    expect((await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request())).status).toBe(429); // 5 attempts / 15 min
    expect(await prisma.accountRecovery.count()).toBe(0);
    expect((await call(o.cookie, "GET", "/auth/me")).status).toBe(200); // nothing happened to the account
  });

  it("never for another platform admin or oneself; unknown user 404; a new link revokes the previous one; an expired link is refused", async () => {
    const a = await admin();
    const other = await admin();
    expect((await call(a.cookie, "POST", `/platform/users/${other.id}/recovery`, request())).json.errorName).toBe("RecoveryRefusedError");
    expect((await call(a.cookie, "POST", `/platform/users/${a.id}/recovery`, request())).status).toBe(409);
    expect((await call(a.cookie, "POST", "/platform/users/nosuchuser/recovery", request())).status).toBe(404);

    const o = await owner();
    const first = new URL((await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request())).json.url).searchParams.get("token")!;
    const second = new URL((await call(a.cookie, "POST", `/platform/users/${o.id}/recovery`, request())).json.url).searchParams.get("token")!;
    expect((await call("", "POST", "/auth/recover", { token: first, newPassword: "brand-new-pass-1" })).status).toBe(400); // revoked
    await prisma.accountRecovery.updateMany({ where: { tokenHash: sha256(second) }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("", "POST", "/auth/recover", { token: second, newPassword: "brand-new-pass-1" })).status).toBe(400); // expired
  });
});
