import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "@/test/db-helpers";
import { jwtCallback } from "./callbacks";
import { changePassword, signOutEverywhere } from "./account";
import { MemoryRateLimiter } from "./rate-limit";
import { authenticate, registerUser } from "./service";

/** Account self-service on real PostgreSQL. Password reset by e-mail no longer exists (ADR 0001, U1). */
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const USERNAME = "ali_test";
const OLD = "old-password-1";
const NEW = "brand-new-pass-2";
const ctx = () => ({ ip: "1.1.1.1", limiter: new MemoryRateLimiter() });
const login = (password: string) => authenticate({ username: USERNAME, password }, ctx());

async function makeUser() {
  expect(await registerUser({ name: "Ali", username: USERNAME, password: OLD }, ctx())).toEqual({ ok: true });
  return prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
}

describe("change password", () => {
  it("requires the current password, stores a new Argon2id hash and ends every session", async () => {
    const u = await makeUser();
    expect(await changePassword(u.id, { currentPassword: "wrong-password", newPassword: NEW }, ctx())).toMatchObject({ ok: false, error: "wrong_password" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).authVersion).toBe(0);

    expect(await changePassword(u.id, { currentPassword: OLD, newPassword: NEW }, ctx())).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.authVersion).toBe(1);
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await login(OLD)).ok).toBe(false);
    expect((await login(NEW)).ok).toBe(true);
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
