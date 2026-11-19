import { db } from "@/lib/db";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";
import { AUTH_RULES, getRateLimiter, rateLimitKey, type RateLimiter } from "./rate-limit";
import { changePasswordSchema } from "./schemas";

/*
 * Account self-service. Password reset by e-mail was removed with the e-mail address (ADR 0001, U1): until OTP exists there is no
 * self-service recovery of a forgotten password. The table "PasswordResetToken" is no longer read or written (dropped by the approved
 * contract migration later).
 */

type Fields = Record<string, string[]>;

/** Password change for a signed-in user. Every session of the user (this one included) ends; the user signs in again. */
export type ChangePasswordOutcome =
  | { ok: true }
  | { ok: false; error: "invalid" | "wrong_password" | "rate_limited"; fieldErrors?: Fields };

export async function changePassword(userId: string, input: unknown, ctx: { limiter?: RateLimiter } = {}): Promise<ChangePasswordOutcome> {
  const limiter = ctx.limiter ?? getRateLimiter();
  const rl = await limiter.consume(rateLimitKey("change-password:user", userId), AUTH_RULES.changePasswordPerUser);
  if (!rl.allowed) return { ok: false, error: "rate_limited" };

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: parsed.error.flatten().fieldErrors as Fields };
  const { currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const valid = user ? await verifyPassword(user.passwordHash, currentPassword) : await verifyDummyPassword(currentPassword);
  if (!user || !valid) return { ok: false, error: "wrong_password", fieldErrors: { currentPassword: ["رمز عبور فعلی نادرست است"] } };

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: userId }, data: { passwordHash, authVersion: { increment: 1 } } });
  return { ok: true };
}

/** "Sign out everywhere": invalidates every issued JWT of the user, this session included. */
export async function signOutEverywhere(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
}
