import { Inject, Injectable } from "@nestjs/common";
import type { ApiConfig } from "../config/env.js";
import { CONFIG, RATE_LIMITER, USERS } from "../config/tokens.js";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password.js";
import type { RateLimiter, SafeUser, UserRepository } from "./ports.js";
import { AUTH_RULES, rateLimitKey } from "./rate-limit.js";
import { changePasswordSchema, loginSchema, registerSchema } from "./schemas.js";
import { TokenService } from "./token.js";

type Fields = Record<string, string[]>;

export type RegisterOutcome =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "username_taken"; fieldErrors?: Fields; retryAfterSeconds?: number };
export type LoginOutcome = { ok: true; user: SafeUser; token: string } | { ok: false; reason: "invalid" | "rate_limited"; retryAfterSeconds?: number };
export type ChangePasswordOutcome = { ok: true } | { ok: false; error: "invalid" | "wrong_password" | "rate_limited"; fieldErrors?: Fields; retryAfterSeconds?: number };

/**
 * Ported from the web app's modules/auth (ADR 0001, N3) with the same rules: Argon2id, normalised usernames, a taken username IS
 * reported at registration, login is non-enumerating (one outcome for unknown name, wrong password and malformed input, and unknown
 * names pay for one hash too), rate limits per IP and per username, and authVersion for revoking every issued token.
 */
@Injectable()
export class AuthService {
  readonly tokens: TokenService;

  constructor(
    @Inject(USERS) private readonly users: UserRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(CONFIG) config: ApiConfig,
  ) {
    this.tokens = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);
  }

  async register(input: unknown, ctx: { ip: string }): Promise<RegisterOutcome> {
    const rl = await this.limiter.consume(rateLimitKey("register:ip", ctx.ip), AUTH_RULES.registerPerIp);
    if (!rl.allowed) return { ok: false, error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds };

    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: parsed.error.flatten().fieldErrors as Fields };
    const { name, username, password } = parsed.data;

    const created = await this.users.create({ name, username, passwordHash: await hashPassword(password) });
    if (!created) return { ok: false, error: "username_taken", fieldErrors: { username: ["این نام کاربری قبلاً گرفته شده است"] } };
    return { ok: true };
  }

  async login(input: unknown, ctx: { ip: string }): Promise<LoginOutcome> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "invalid" };
    const { username, password } = parsed.data;

    const [byIp, byUsername] = await Promise.all([
      this.limiter.consume(rateLimitKey("login:ip", ctx.ip), AUTH_RULES.loginPerIp),
      this.limiter.consume(rateLimitKey("login:username", username), AUTH_RULES.loginPerUsername),
    ]);
    if (!byIp.allowed || !byUsername.allowed) {
      return { ok: false, reason: "rate_limited", retryAfterSeconds: Math.max(byIp.allowed ? 0 : byIp.retryAfterSeconds, byUsername.allowed ? 0 : byUsername.retryAfterSeconds) };
    }

    const user = await this.users.findByUsername(username);
    // Unknown names still pay for one Argon2 verification, so timing does not reveal which usernames exist.
    const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyDummyPassword(password);
    if (!user || !valid) return { ok: false, reason: "invalid" };

    const token = await this.tokens.sign({ userId: user.id, authVersion: user.authVersion });
    return { ok: true, user: { id: user.id, username: user.username, name: user.name }, token };
  }

  /** The user behind a token, only while the user exists and the token's authVersion is still current. */
  async userForToken(token: string): Promise<SafeUser | null> {
    const claims = await this.tokens.verify(token);
    if (!claims) return null;
    const user = await this.users.findById(claims.userId);
    if (!user || user.authVersion !== claims.authVersion) return null;
    return { id: user.id, username: user.username, name: user.name };
  }

  /** Every session of the user (this one included) ends; the user signs in again. */
  async changePassword(userId: string, input: unknown): Promise<ChangePasswordOutcome> {
    const rl = await this.limiter.consume(rateLimitKey("change-password:user", userId), AUTH_RULES.changePasswordPerUser);
    if (!rl.allowed) return { ok: false, error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds };

    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: parsed.error.flatten().fieldErrors as Fields };
    const { currentPassword, newPassword } = parsed.data;

    const user = await this.users.findById(userId);
    const valid = user ? await verifyPassword(user.passwordHash, currentPassword) : await verifyDummyPassword(currentPassword);
    if (!user || !valid) return { ok: false, error: "wrong_password", fieldErrors: { currentPassword: ["رمز عبور فعلی نادرست است"] } };

    await this.users.setPassword(userId, await hashPassword(newPassword));
    return { ok: true };
  }

  async signOutEverywhere(userId: string): Promise<void> {
    await this.users.bumpAuthVersion(userId);
  }
}
