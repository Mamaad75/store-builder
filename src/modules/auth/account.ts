import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getAppEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";
import { getMailer } from "./mailer";
import { AUTH_RULES, getRateLimiter, rateLimitKey, type RateLimiter } from "./rate-limit";
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "./schemas";

/** How long an emailed reset link works. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

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
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, authVersion: { increment: 1 } } }),
    db.passwordResetToken.deleteMany({ where: { userId } }), // a pending reset link must not outlive the password it was issued for
  ]);
  return { ok: true };
}

/** "Sign out everywhere": invalidates every issued JWT of the user, this session included. */
export async function signOutEverywhere(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
}

function resetLink(token: string): string {
  const env = getAppEnv();
  return `${env.APP_PROTOCOL}://${env.APP_ROOT_DOMAIN}/reset-password?token=${token}`;
}

/**
 * Starts a password reset. The outcome is IDENTICAL for unknown, known and malformed addresses (no enumeration); only an
 * exceeded rate limit is reported as such (it is keyed by IP and by the submitted address, not by account existence).
 * At most one live token per user, enforced by the unique `userId` index: asking again replaces the previous link, even when requests race. Mail delivery is best effort and its result is
 * never shown to the requester.
 */
export type ForgotOutcome = { ok: true } | { ok: false; error: "rate_limited" };

export async function requestPasswordReset(input: unknown, ctx: { ip: string; limiter?: RateLimiter; now?: () => Date }): Promise<ForgotOutcome> {
  const limiter = ctx.limiter ?? getRateLimiter();
  const parsed = forgotPasswordSchema.safeParse(input);
  const checks = [limiter.consume(rateLimitKey("forgot:ip", ctx.ip), AUTH_RULES.forgotPerIp)];
  if (parsed.success) checks.push(limiter.consume(rateLimitKey("forgot:email", parsed.data.email), AUTH_RULES.forgotPerEmail));
  if ((await Promise.all(checks)).some((r) => !r.allowed)) return { ok: false, error: "rate_limited" };
  if (!parsed.success) return { ok: true };

  const user = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true } });
  if (!user) return { ok: true };

  const token = randomBytes(32).toString("base64url");
  const now = (ctx.now ?? (() => new Date()))();
  // ONE atomic statement (explicit ON CONFLICT, not Prisma's upsert, so it never degrades to select-then-insert): `userId` is
  // unique, so concurrent requests for the same user serialise on that row. The last writer's token is the only live one (an
  // earlier emailed link simply stops working) and no interleaving can leave two rows. A racing reset that already claimed the
  // row finishes first (row lock); its DELETE then lets this statement insert a fresh row.
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
  await db.$executeRaw`
    INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")
    VALUES (${randomUUID()}, ${user.id}, ${sha256(token)}, ${expiresAt}, NULL, ${now})
    ON CONFLICT ("userId") DO UPDATE SET
      "tokenHash" = EXCLUDED."tokenHash", "expiresAt" = EXCLUDED."expiresAt", "usedAt" = NULL, "createdAt" = EXCLUDED."createdAt"`;
  try {
    await getMailer().send({
      to: user.email,
      subject: "بازیابی رمز عبور",
      text: `برای تعیین رمز عبور جدید روی پیوند زیر بزنید (تا یک ساعت معتبر است و فقط یک بار کار می‌کند):\n${resetLink(token)}\n\nاگر این درخواست از طرف شما نبوده است، این پیام را نادیده بگیرید؛ رمز عبور شما تغییری نمی‌کند.`,
    });
  } catch (e) {
    // class only: never the address, the link or a stack
    log.error("mail.reset_failed", { errorClass: e instanceof Error ? e.name : "UnknownError" });
  }
  return { ok: true };
}

export type ResetOutcome = { ok: true } | { ok: false; error: "invalid_token" | "invalid" | "rate_limited"; fieldErrors?: Fields };

/**
 * Completes a reset. The token is claimed with one conditional UPDATE (`usedAt IS NULL AND expiresAt > now`), so two
 * concurrent submissions cannot both succeed. The new password replaces the old hash, every session ends (authVersion), and
 * every other token of the user is removed. Unknown, expired, used and malformed tokens are one and the same outcome.
 */
export async function resetPassword(input: unknown, ctx: { ip: string; limiter?: RateLimiter; now?: () => Date }): Promise<ResetOutcome> {
  const limiter = ctx.limiter ?? getRateLimiter();
  const rl = await limiter.consume(rateLimitKey("reset:ip", ctx.ip), AUTH_RULES.resetPerIp);
  if (!rl.allowed) return { ok: false, error: "rate_limited" };

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors as Fields;
    return fe.token ? { ok: false, error: "invalid_token" } : { ok: false, error: "invalid", fieldErrors: fe };
  }
  const now = (ctx.now ?? (() => new Date()))();
  const passwordHash = await hashPassword(parsed.data.password);
  const tokenHash = sha256(parsed.data.token);

  return db.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) return { ok: false as const, error: "invalid_token" as const };
    const row = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, authVersion: { increment: 1 } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId } }); // the (single) row is consumed and removed
    return { ok: true as const };
  });
}

/** Whether a link is still usable, for the reset page (it does not consume the token). */
export async function isResetTokenUsable(token: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return !!(await db.passwordResetToken.findFirst({ where: { tokenHash: sha256(token), usedAt: null, expiresAt: { gt: now } }, select: { id: true } }));
}

/** Housekeeping: expired or used tokens carry no value. Bounded; safe to run concurrently. */
export async function cleanupResetTokens(now = new Date()): Promise<number> {
  const r = await db.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } });
  return r.count;
}
