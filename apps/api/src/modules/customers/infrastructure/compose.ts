import { rateLimitKey } from "../../../lib/rate-limit.js";
import { CustomerAuthService } from "../application/customer-auth.service.js";
import { CustomersService } from "../application/customers.service.js";
import type { Limiter, OtpSender } from "../application/ports.js";
import { log } from "../../../lib/log.js";
import { maskPhone } from "@store-builder/shared/lib/phone";
import { customerTokens, otpCodec } from "./crypto.js";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../../../auth/password.js";
import { PrismaCustomerRepository, PrismaOtpRepository } from "./prisma-customers.repository.js";

interface RateLimiterLike {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

/** Composition: PostgreSQL storage, the shared rate limiter (keys hashed: no phone or IP is stored in clear), the SMS sender from the platform settings. */
export function createCustomerAuthService(o: { authSecret: string; sender: () => Promise<OtpSender | null>; limiter: RateLimiterLike }): CustomerAuthService {
  const limiter: Limiter = { consume: (key, rule) => o.limiter.consume(rateLimitKey("customer", key), rule) };
  return new CustomerAuthService({
    customers: new PrismaCustomerRepository(),
    otps: new PrismaOtpRepository(),
    codec: otpCodec(o.authSecret),
    tokens: customerTokens(o.authSecret),
    limiter,
    sender: o.sender,
    passwords: { hash: hashPassword, verify: verifyPassword, verifyDummy: verifyDummyPassword },
  });
}

export const createCustomersService = (): CustomersService => new CustomersService(new PrismaCustomerRepository());

/**
 * Development and tests only (config.customerOtpDevLog): sign-in codes go to the API log instead of an SMS, so SMS sign-in can be tried
 * without an SMS account. The config refuses this outside development/test.
 */
export const devLogOtpSender: OtpSender = {
  async sendOtp(phone, code) {
    log.info("customer.otp.dev_code", { phone: maskPhone(phone), code, note: "CUSTOMER_OTP_DEV_LOG: development only, never in production" });
  },
};
