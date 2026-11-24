import { createHash, randomBytes } from "node:crypto";
import { ZARINPAL_MERCHANT_SECRET } from "@store-builder/shared/modules/orders/orders";
import { rateLimitKey } from "../../../lib/rate-limit.js";
import { createCheckoutService } from "../../checkout/checkout.api.js";
import { createInventoryService } from "../../inventory/inventory.api.js";
import { OrdersService } from "../application/orders.service.js";
import { PaymentsService } from "../application/payments.service.js";
import type { Limiter, PaymentConfig, PaymentGateway, StockHold } from "../application/ports.js";
import { PrismaOrderStore } from "./prisma-orders.repository.js";
import { PrismaPaymentStore } from "./prisma-payments.repository.js";
import { orderTokens } from "./tokens.js";
import { ZarinpalGateway } from "./zarinpal.js";

interface RateLimiterLike {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const newId = () => randomBytes(12).toString("hex");
const limiterOf = (o: RateLimiterLike): Limiter => ({ consume: (key, rule) => o.consume(rateLimitKey("orders", key), rule) });

/** What online payment reads from elsewhere: the platform settings (switch, sandbox) and the store's secret (its merchant id). */
export interface PaymentSources {
  paymentSettings(): Promise<{ zarinpalEnabled: boolean; sandbox: boolean }>;
  reveal(storeId: string, name: string): Promise<string | null>;
  secretsReady(): boolean;
}

/** Composition of online payment (phase 3.5): PostgreSQL attempts, Zarinpal (or the injected fake). */
export function createPaymentsService(o: {
  authSecret: string;
  limiter: RateLimiterLike;
  sources: PaymentSources;
  storeOrigin: (label: string) => string;
  gateway?: PaymentGateway | null;
  devBaseUrl?: string;
}): PaymentsService {
  const config: PaymentConfig = {
    // Read on every use (one small row): switching payments off or to sandbox applies at once, also to sessions being opened.
    platform: async () => {
      const p = await o.sources.paymentSettings();
      return { enabled: p.zarinpalEnabled, sandbox: p.sandbox };
    },
    secretsReady: () => o.sources.secretsReady(),
    fingerprint: (id) => sha256(id.trim().toLowerCase()),
    newReturnKey: () => {
      const key = randomBytes(32).toString("base64url");
      return { key, hash: sha256(key) };
    },
    hashReturnKey: (key) => (/^[A-Za-z0-9_-]{43}$/.test(key) ? sha256(key) : null),
    merchantId: async (storeId) => (await o.sources.reveal(storeId, ZARINPAL_MERCHANT_SECRET))?.trim().toLowerCase() ?? null,
  };
  const gateway = o.gateway ?? new ZarinpalGateway(o.devBaseUrl ? { baseUrlOverride: o.devBaseUrl } : {});
  return new PaymentsService(
    new PrismaPaymentStore(), gateway, config, orderTokens(o.authSecret), limiterOf(o.limiter),
    (label) => `${o.storeOrigin(label)}/checkout/payment/return`, newId,
  );
}

/** Composition: the PostgreSQL order store, the 3.2 stock ledger, the 3.3 checkout (same pricing), keys hashed by rateLimitKey. */
export function createOrdersService(o: { authSecret: string; limiter: RateLimiterLike; payments?: PaymentsService | null }): OrdersService {
  const inventory = createInventoryService();
  const stock: StockHold = {
    reserve: async (storeId, ref, lines, ttlSeconds) => void (await inventory.reserve(storeId, ref, lines, ttlSeconds)),
    release: (storeId, ref) => inventory.release(storeId, ref),
  };
  return new OrdersService(
    new PrismaOrderStore(), createCheckoutService({ limiter: o.limiter }), stock, orderTokens(o.authSecret), limiterOf(o.limiter), newId,
    () => new Date(), o.payments ?? null,
  );
}
