import { randomBytes } from "node:crypto";
import { rateLimitKey } from "../../../lib/rate-limit.js";
import { createCheckoutService } from "../../checkout/checkout.api.js";
import { createInventoryService } from "../../inventory/inventory.api.js";
import { OrdersService } from "../application/orders.service.js";
import type { Limiter, StockHold } from "../application/ports.js";
import { PrismaOrderStore } from "./prisma-orders.repository.js";
import { orderTokens } from "./tokens.js";

interface RateLimiterLike {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

/** Composition: the PostgreSQL order store, the 3.2 stock ledger, the 3.3 checkout (same pricing), keys hashed by rateLimitKey. */
export function createOrdersService(o: { authSecret: string; limiter: RateLimiterLike }): OrdersService {
  const limiter: Limiter = { consume: (key, rule) => o.limiter.consume(rateLimitKey("orders", key), rule) };
  const inventory = createInventoryService();
  const stock: StockHold = {
    reserve: async (storeId, ref, lines, ttlSeconds) => void (await inventory.reserve(storeId, ref, lines, ttlSeconds)),
    release: (storeId, ref) => inventory.release(storeId, ref),
  };
  return new OrdersService(new PrismaOrderStore(), createCheckoutService({ limiter: o.limiter }), stock, orderTokens(o.authSecret), limiter, () => randomBytes(12).toString("hex"));
}
