import { rateLimitKey } from "../../../lib/rate-limit.js";
import { createDiscountsService } from "../../discounts/discounts.api.js";
import { CheckoutService } from "../application/checkout.service.js";
import type { Limiter } from "../application/ports.js";
import { ShippingService } from "../application/shipping.service.js";
import { PrismaAddressStore, PrismaCartStore, PrismaCheckoutReads, PrismaShippingStore } from "./prisma-checkout.repository.js";
import { cartTokens } from "./tokens.js";

interface RateLimiterLike {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

/** Composition: the one place where the PostgreSQL implementations are handed to the use cases (rate-limit keys hashed by rateLimitKey). */
export function createCheckoutService(o: { limiter: RateLimiterLike }): CheckoutService {
  const limiter: Limiter = { consume: (key, rule) => o.limiter.consume(rateLimitKey("checkout", key), rule) };
  // Phase 5.1: discount codes are evaluated by the discounts module (read-only here; the order's transaction redeems them).
  return new CheckoutService(new PrismaCartStore(), new PrismaCheckoutReads(), new PrismaAddressStore(), cartTokens, limiter, createDiscountsService());
}

export const createShippingService = (): ShippingService => new ShippingService(new PrismaShippingStore());
