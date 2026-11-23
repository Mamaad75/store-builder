import { normalizeIranMobile } from "@store-builder/shared/lib/phone";
import { CustomerExistsError, CustomerLoginError, CustomerLoginRateLimitedError, OtpDeliveryError, OtpInvalidError, OtpRateLimitedError, OtpUnavailableError } from "@store-builder/shared/modules/customers/errors";
import { customerLoginSchema, customerRegisterSchema } from "@store-builder/shared/modules/customers/schemas";
import { ValidationError } from "@store-builder/shared/modules/stores/errors";
import { OTP, challengeState, ipLimitKey, parseCode, resendWait } from "../domain/otp.js";
import type { CustomerRepository, CustomerTokens, CustomerView, Limiter, OtpCodec, OtpRepository, OtpSender, PasswordHasher } from "./ports.js";

export interface CustomerAuthDeps {
  customers: CustomerRepository;
  otps: OtpRepository;
  codec: OtpCodec;
  limiter: Limiter;
  tokens: CustomerTokens;
  /** The current sender, or null = customer sign-in by SMS is off (not configured or not enabled). Read on each use (settings change). */
  sender: () => Promise<OtpSender | null>;
  /** Phase 3.3b: password sign-in. */
  passwords: PasswordHasher;
  now?: () => Date;
}

/** Phase 3.3b: password attempts and new accounts per network and per phone (per store). */
export const PASSWORD_RULES = {
  loginPerIp: { limit: 30, windowSeconds: 900 },
  loginPerPhone: { limit: 10, windowSeconds: 900 },
  registerPerIp: { limit: 10, windowSeconds: 3600 },
} as const;

/** The public view of a signed-in customer (no internal counters). */
export interface CustomerProfile {
  id: string;
  phone: string;
  name: string | null;
  /** Phase 3.3b: the phone was proven by an SMS code (then orders attached to the phone from guest checkouts are shown too). */
  phoneVerified: boolean;
}
const profile = (c: CustomerView): CustomerProfile => ({ id: c.id, phone: c.phone, name: c.name, phoneVerified: c.phoneVerifiedAt !== null });

/**
 * Customer sign-in by one-time SMS code (phase 3.1, D31-2), for ONE store at a time. Off while `sender` is null: nothing is stored and the
 * answer is OtpUnavailableError. Answers never reveal whether a phone already has an account.
 */
export class CustomerAuthService {
  private readonly now: () => Date;
  constructor(private readonly d: CustomerAuthDeps) {
    this.now = d.now ?? (() => new Date());
  }

  async isEnabled(): Promise<boolean> {
    return (await this.d.sender()) !== null;
  }

  async requestCode(storeId: string, rawPhone: unknown, ip: string): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
    const sender = await this.d.sender();
    if (!sender) throw new OtpUnavailableError();
    const phone = normalizeIranMobile(rawPhone);
    if (!phone) throw new ValidationError({ phone: ["شماره‌ی موبایل معتبر وارد کنید (مثل ۰۹۱۲۳۴۵۶۷۸۹)."] });

    const byIp = await this.d.limiter.consume(`otp-request:ip:${ipLimitKey(ip)}`, OTP.requestsPerIpPerHour);
    if (!byIp.allowed) throw new OtpRateLimitedError(byIp.retryAfterSeconds);
    const now = this.now();
    const wait = resendWait((await this.d.otps.latest(storeId, phone))?.createdAt ?? null, now);
    if (wait > 0) throw new OtpRateLimitedError(wait);
    // Per store, then across every store (one victim, many shops), then the platform-wide budget (security review 2026-11-23).
    for (const [key, rule] of [
      [`otp-request:phone:${storeId}:${phone}`, OTP.perPhonePerHour],
      [`otp-request:phone-all:${phone}`, OTP.perPhoneAllStoresPerHour],
      [`otp-request:phone-day:${phone}`, OTP.perPhoneAllStoresPerDay],
      ["otp-request:platform", OTP.platformPerHour],
    ] as const) {
      const r = await this.d.limiter.consume(key, rule);
      if (!r.allowed) throw new OtpRateLimitedError(r.retryAfterSeconds);
    }

    const code = this.d.codec.newCode();
    const id = await this.d.otps.create(storeId, phone, this.d.codec.hash(storeId, phone, code), new Date(now.getTime() + OTP.ttlSeconds * 1000));
    try {
      await sender.sendOtp(phone, code);
    } catch {
      await this.d.otps.discard(id); // an unsent code must not block a retry for a minute
      throw new OtpDeliveryError();
    }
    return { resendAfterSeconds: OTP.resendSeconds, expiresInSeconds: OTP.ttlSeconds };
  }

  async verifyCode(storeId: string, rawPhone: unknown, rawCode: unknown, ip: string): Promise<{ customer: CustomerProfile; token: string }> {
    if (!(await this.d.sender())) throw new OtpUnavailableError();
    const byIp = await this.d.limiter.consume(`otp-verify:ip:${ipLimitKey(ip)}`, OTP.verifiesPerIpPerHour);
    if (!byIp.allowed) throw new OtpRateLimitedError(byIp.retryAfterSeconds);
    const phone = normalizeIranMobile(rawPhone);
    const code = parseCode(rawCode);
    if (!phone || !code) throw new OtpInvalidError();

    const now = this.now();
    const c = await this.d.otps.latest(storeId, phone);
    if (!c || challengeState(c, now) !== "usable") throw new OtpInvalidError();
    // The try is counted BEFORE the comparison, atomically: parallel guesses cannot exceed the limit.
    if (!(await this.d.otps.countAttempt(c.id, OTP.maxAttempts))) throw new OtpInvalidError();
    if (!this.d.codec.same(c.codeHash, this.d.codec.hash(storeId, phone, code))) throw new OtpInvalidError();
    if (!(await this.d.otps.consume(c.id, now))) throw new OtpInvalidError(); // used by a parallel request

    const customer = await this.d.customers.signIn(storeId, phone, now);
    const token = await this.d.tokens.issue({ customerId: customer.id, storeId, authVersion: customer.authVersion });
    return { customer: profile(customer), token };
  }

  private async limit(key: string, rule: { limit: number; windowSeconds: number }) {
    const r = await this.d.limiter.consume(key, rule);
    if (!r.allowed) throw new CustomerLoginRateLimitedError(r.retryAfterSeconds);
  }

  /**
   * Phase 3.3b: a password account for this store. The phone is NOT verified by this: such an account sees only orders placed while signed
   * in to it, until the phone is verified by an SMS code. A phone that already has a password or was verified by SMS code is refused.
   */
  async register(storeId: string, body: unknown, ip: string): Promise<{ customer: CustomerProfile; token: string }> {
    const r = customerRegisterSchema.safeParse(body);
    if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
    await this.limit(`password-register:ip:${ipLimitKey(ip)}`, PASSWORD_RULES.registerPerIp);
    const created = await this.d.customers.register(storeId, r.data.phone, r.data.name, await this.d.passwords.hash(r.data.password), this.now());
    if (created === "exists") throw new CustomerExistsError();
    return { customer: profile(created), token: await this.d.tokens.issue({ customerId: created.id, storeId, authVersion: created.authVersion }) };
  }

  /** Phase 3.3b: sign-in with phone and password. Unknown phone, no password and wrong password are the same answer and cost the same. */
  async login(storeId: string, body: unknown, ip: string): Promise<{ customer: CustomerProfile; token: string }> {
    const r = customerLoginSchema.safeParse(body ?? {});
    const password = r.success ? r.data.password : "";
    const phone = r.success ? normalizeIranMobile(r.data.phone) : null;
    await this.limit(`password-login:ip:${ipLimitKey(ip)}`, PASSWORD_RULES.loginPerIp);
    if (phone) await this.limit(`password-login:phone:${storeId}:${phone}`, PASSWORD_RULES.loginPerPhone);
    const found = phone && password ? await this.d.customers.credentials(storeId, phone) : null;
    const ok = found?.passwordHash ? await this.d.passwords.verify(found.passwordHash, password) : await this.d.passwords.verifyDummy(password);
    if (!ok || !found) throw new CustomerLoginError();
    await this.d.customers.recordLogin(storeId, found.customer.id, this.now());
    return { customer: profile(found.customer), token: await this.d.tokens.issue({ customerId: found.customer.id, storeId, authVersion: found.customer.authVersion }) };
  }

  /** The customer of a session token, for this store only; null when the token is invalid, for another store or ended. */
  async current(storeId: string, token: string | undefined): Promise<CustomerProfile | null> {
    if (!token) return null;
    const claims = await this.d.tokens.read(token);
    if (!claims || claims.storeId !== storeId) return null;
    const c = await this.d.customers.find(storeId, claims.customerId);
    return c && c.authVersion === claims.authVersion ? profile(c) : null;
  }

  /** Ends every session of the signed-in customer (all devices). */
  async signOutEverywhere(storeId: string, token: string | undefined): Promise<void> {
    const me = await this.current(storeId, token);
    if (me) await this.d.customers.bumpAuthVersion(storeId, me.id);
  }
}
