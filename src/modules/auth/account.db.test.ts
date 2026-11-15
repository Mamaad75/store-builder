import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { jwtCallback } from "./callbacks";
import { RESET_TOKEN_TTL_MS, changePassword, cleanupResetTokens, isResetTokenUsable, requestPasswordReset, resetPassword, signOutEverywhere } from "./account";
import { MemoryMailer, setMailerForTests, type Mailer } from "./mailer";
import { MemoryRateLimiter } from "./rate-limit";
import { authenticate, registerUser } from "./service";

beforeEach(async () => {
  await resetDb();
  mailer = new MemoryMailer();
  setMailerForTests(mailer);
});
afterAll(async () => {
  setMailerForTests(undefined);
  await prisma.$disconnect();
});

let mailer: MemoryMailer;
const EMAIL = "ali@example.com";
const OLD = "old-password-1";
const NEW = "brand-new-pass-2";
const ctx = () => ({ ip: "1.1.1.1", limiter: new MemoryRateLimiter() });
const login = (password: string) => authenticate({ email: EMAIL, password }, ctx());
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

async function makeUser() {
  await registerUser({ name: "Ali", email: EMAIL, password: OLD }, ctx());
  return prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
}
const tokenFromMail = (i = mailer.outbox.length - 1) => /reset-password\?token=([A-Za-z0-9_-]{43})/.exec(mailer.outbox[i]!.text)![1]!;

describe("change password", () => {
  it("requires the current password, stores a new Argon2id hash, ends every session and drops pending reset links", async () => {
    const u = await makeUser();
    await requestPasswordReset({ email: EMAIL }, ctx());
    expect(await prisma.passwordResetToken.count()).toBe(1);

    expect(await changePassword(u.id, { currentPassword: "wrong-password", newPassword: NEW }, ctx())).toMatchObject({ ok: false, error: "wrong_password" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).authVersion).toBe(0);

    expect(await changePassword(u.id, { currentPassword: OLD, newPassword: NEW }, ctx())).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.authVersion).toBe(1);
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await login(OLD)).ok).toBe(false);
    expect((await login(NEW)).ok).toBe(true);
    expect(await prisma.passwordResetToken.count()).toBe(0);
    // a JWT issued before the change no longer validates
    expect(await jwtCallback({ token: { sub: u.id, authVersion: 0 } as never })).toBeNull();
  });
  it("validates input (same password, too short) and is rate limited per user", async () => {
    const u = await makeUser();
    expect(await changePassword(u.id, { currentPassword: OLD, newPassword: OLD }, ctx())).toMatchObject({ ok: false, error: "invalid", fieldErrors: { newPassword: expect.any(Array) } });
    expect(await changePassword(u.id, { currentPassword: OLD, newPassword: "short" }, ctx())).toMatchObject({ ok: false, error: "invalid" });
    const c = ctx();
    for (let i = 0; i < 10; i++) await changePassword(u.id, { currentPassword: "nope-nope-1", newPassword: NEW }, c);
    expect(await changePassword(u.id, { currentPassword: OLD, newPassword: NEW }, c)).toMatchObject({ ok: false, error: "rate_limited" });
    expect((await login(OLD)).ok).toBe(true); // nothing changed
  });
});

describe("sign out everywhere", () => {
  it("bumps authVersion so every previously issued JWT is rejected, without touching the password", async () => {
    const u = await makeUser();
    const issued = { sub: u.id, authVersion: u.authVersion } as never;
    expect(await jwtCallback({ token: issued })).not.toBeNull();
    await signOutEverywhere(u.id);
    expect(await jwtCallback({ token: issued })).toBeNull();
    expect((await login(OLD)).ok).toBe(true);
  });
});

describe("password reset: requesting", () => {
  it("is identical for registered, unknown and malformed addresses, and only a registered one gets a token and an email", async () => {
    await makeUser();
    const known = await requestPasswordReset({ email: EMAIL }, ctx());
    const unknown = await requestPasswordReset({ email: "nobody@example.com" }, ctx());
    const malformed = await requestPasswordReset({ email: "not-an-email" }, ctx());
    expect(unknown).toEqual(known);
    expect(malformed).toEqual(known);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]!.to).toBe(EMAIL);
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });
  it("stores only the SHA-256 of the token, with a one-hour expiry, and the link points at the configured platform host", async () => {
    const u = await makeUser();
    const now = new Date("2026-01-01T10:00:00Z");
    await requestPasswordReset({ email: EMAIL }, { ...ctx(), now: () => now });
    const token = tokenFromMail();
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.tokenHash).toBe(sha(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MS);
    expect(mailer.outbox[0]!.text).toContain(`http://localhost:3000/reset-password?token=${token}`); // APP_PROTOCOL + APP_ROOT_DOMAIN, never a request header
  });
  it("a new request replaces the previous link (at most one live token per user)", async () => {
    await makeUser();
    await requestPasswordReset({ email: EMAIL }, ctx());
    const first = tokenFromMail();
    await requestPasswordReset({ email: EMAIL }, ctx());
    const second = tokenFromMail();
    expect(second).not.toBe(first);
    expect(await prisma.passwordResetToken.count()).toBe(1);
    expect(await resetPassword({ token: first, password: NEW }, ctx())).toMatchObject({ ok: false, error: "invalid_token" });
    expect(await resetPassword({ token: second, password: NEW }, ctx())).toEqual({ ok: true });
  });
  it("a mail transport failure never changes the answer", async () => {
    await makeUser();
    const failing: Mailer = { send: () => Promise.reject(new Error("smtp down")) };
    setMailerForTests(failing);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestPasswordReset({ email: EMAIL }, ctx())).toEqual({ ok: true });
    expect(spy.mock.calls.flat().join(" ")).not.toContain(EMAIL);
    spy.mockRestore();
  });
  it("is rate limited per address and per IP, answering the same way for unknown addresses", async () => {
    const c = ctx();
    for (let i = 0; i < 3; i++) expect(await requestPasswordReset({ email: "x@example.com" }, c)).toEqual({ ok: true });
    expect(await requestPasswordReset({ email: "x@example.com" }, c)).toEqual({ ok: false, error: "rate_limited" });
    const c2 = ctx();
    for (let i = 0; i < 10; i++) await requestPasswordReset({ email: `u${i}@example.com` }, c2);
    expect(await requestPasswordReset({ email: "another@example.com" }, c2)).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("password reset: completing", () => {
  it("sets the new password, ends every session, consumes the link and cannot be replayed", async () => {
    const u = await makeUser();
    await requestPasswordReset({ email: EMAIL }, ctx());
    const token = tokenFromMail();
    expect(await isResetTokenUsable(token)).toBe(true);
    expect(await resetPassword({ token, password: NEW }, ctx())).toEqual({ ok: true });
    expect((await login(NEW)).ok).toBe(true);
    expect((await login(OLD)).ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).authVersion).toBe(1);
    expect(await jwtCallback({ token: { sub: u.id, authVersion: 0 } as never })).toBeNull();
    expect(await isResetTokenUsable(token)).toBe(false);
    expect(await resetPassword({ token, password: "another-pass-3" }, ctx())).toMatchObject({ ok: false, error: "invalid_token" });
    expect((await login(NEW)).ok).toBe(true);
  });
  it("an expired link is refused exactly like an unknown one, and changes nothing", async () => {
    await makeUser();
    const t0 = new Date("2026-01-01T10:00:00Z");
    await requestPasswordReset({ email: EMAIL }, { ...ctx(), now: () => t0 });
    const token = tokenFromMail();
    const late = new Date(t0.getTime() + RESET_TOKEN_TTL_MS + 1000);
    expect(await resetPassword({ token, password: NEW }, { ...ctx(), now: () => late })).toEqual({ ok: false, error: "invalid_token" });
    expect(await isResetTokenUsable(token, late)).toBe(false);
    const unknown = await resetPassword({ token: "A".repeat(43), password: NEW }, ctx());
    expect(unknown).toEqual({ ok: false, error: "invalid_token" });
    expect((await login(OLD)).ok).toBe(true);
  });
  it("malformed tokens are refused before the database, and a weak password keeps the link usable", async () => {
    await makeUser();
    await requestPasswordReset({ email: EMAIL }, ctx());
    const token = tokenFromMail();
    expect(await resetPassword({ token: "short", password: NEW }, ctx())).toEqual({ ok: false, error: "invalid_token" });
    expect(await resetPassword({ token, password: "short" }, ctx())).toMatchObject({ ok: false, error: "invalid", fieldErrors: { password: expect.any(Array) } });
    expect(await isResetTokenUsable(token)).toBe(true);
  });
  it("two concurrent submissions of the same link: exactly one succeeds", async () => {
    await makeUser();
    await requestPasswordReset({ email: EMAIL }, ctx());
    const token = tokenFromMail();
    const results = await Promise.all([resetPassword({ token, password: NEW }, ctx()), resetPassword({ token, password: "second-pass-4" }, ctx())]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results[0]!.ok ? NEW : "second-pass-4";
    expect((await login(winner)).ok).toBe(true);
  });
  it("is rate limited per IP", async () => {
    const c = ctx();
    for (let i = 0; i < 20; i++) await resetPassword({ token: "A".repeat(43), password: NEW }, c);
    expect(await resetPassword({ token: "A".repeat(43), password: NEW }, c)).toEqual({ ok: false, error: "rate_limited" });
  });
  it("deleting the user deletes their tokens, and cleanup removes only expired or used ones", async () => {
    const u = await makeUser();
    const live = { userId: u.id, tokenHash: sha("live"), expiresAt: new Date(Date.now() + 60_000) };
    await prisma.passwordResetToken.createMany({
      data: [live, { userId: u.id, tokenHash: sha("old"), expiresAt: new Date(Date.now() - 60_000) }, { userId: u.id, tokenHash: sha("used"), expiresAt: live.expiresAt, usedAt: new Date() }],
    });
    expect(await cleanupResetTokens()).toBe(2);
    expect((await prisma.passwordResetToken.findMany()).map((t) => t.tokenHash)).toEqual([sha("live")]);
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });
});
