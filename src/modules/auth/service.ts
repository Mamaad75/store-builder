import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";
import { AUTH_RULES, getRateLimiter, rateLimitKey, type RateLimiter } from "./rate-limit";
import { loginSchema, registerSchema } from "./schemas";

/** Only data that is safe to return to callers. Never includes the password hash. */
export interface SafeUser {
  id: string;
  username: string;
  name: string;
}

export type RegisterOutcome =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "username_taken"; fieldErrors?: Record<string, string[]>; retryAfterSeconds?: number };

/**
 * Registration by username (ADR 0001, U1). Unlike the former e-mail sign-up, a taken username IS reported: the person must pick
 * another one, and a username is not a secret (it is never shown publicly either). Login stays non-enumerating (one generic outcome)
 * and is rate limited per IP and per username. Uniqueness is decided by the database (unique index), never by a read-then-write.
 */
export async function registerUser(
  input: unknown,
  ctx: { ip: string; limiter?: RateLimiter },
): Promise<RegisterOutcome> {
  const limiter = ctx.limiter ?? getRateLimiter();
  const rl = await limiter.consume(rateLimitKey("register:ip", ctx.ip), AUTH_RULES.registerPerIp);
  if (!rl.allowed) return { ok: false, error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds };

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const { name, username, password } = parsed.data;

  const passwordHash = await hashPassword(password);
  try {
    await db.user.create({ data: { name, username, passwordHash } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "username_taken", fieldErrors: { username: ["این نام کاربری قبلاً گرفته شده است"] } };
    }
    throw e;
  }
  return { ok: true };
}

export type AuthenticateResult =
  | { ok: true; user: SafeUser; authVersion: number }
  | { ok: false; reason: "invalid" | "rate_limited" };

/** Returns the same `invalid` outcome for malformed input, unknown username and wrong password. */
export async function authenticate(
  credentials: unknown,
  ctx: { ip: string; limiter?: RateLimiter },
): Promise<AuthenticateResult> {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { username, password } = parsed.data;

  const limiter = ctx.limiter ?? getRateLimiter();
  const [byIp, byUsername] = await Promise.all([
    limiter.consume(rateLimitKey("login:ip", ctx.ip), AUTH_RULES.loginPerIp),
    limiter.consume(rateLimitKey("login:username", username), AUTH_RULES.loginPerUsername),
  ]);
  if (!byIp.allowed || !byUsername.allowed) return { ok: false, reason: "rate_limited" };

  const user = await db.user.findUnique({ where: { username } });
  // Unknown names still pay for one Argon2 verification, so timing does not reveal which usernames exist.
  const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyDummyPassword(password);
  if (!user || !valid) return { ok: false, reason: "invalid" };

  return { ok: true, user: { id: user.id, username: user.username, name: user.name }, authVersion: user.authVersion };
}

/** Invalidates every existing JWT of the user (e.g. after password change or suspected compromise). */
export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
}

/** True only if the user still exists and the token's authVersion matches the current one. */
export async function isSessionVersionCurrent(userId: string, authVersion: unknown): Promise<boolean> {
  if (typeof authVersion !== "number") return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { authVersion: true } });
  return !!user && user.authVersion === authVersion;
}

export async function getSafeUser(userId: string): Promise<SafeUser | null> {
  return db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, name: true } });
}
