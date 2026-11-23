import { rateLimitKey } from "../../../lib/rate-limit.js";
import { CustomerAuthService } from "../application/customer-auth.service.js";
import { CustomersService } from "../application/customers.service.js";
import type { Limiter, OtpSender } from "../application/ports.js";
import { customerTokens, otpCodec } from "./crypto.js";
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
  });
}

export const createCustomersService = (): CustomersService => new CustomersService(new PrismaCustomerRepository());
