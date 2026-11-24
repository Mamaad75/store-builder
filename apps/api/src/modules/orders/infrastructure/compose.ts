import { createHash, randomBytes } from "node:crypto";
import { GATEWAY_SECRETS, type Gateway } from "@store-builder/shared/modules/orders/orders";
import { PaymentUnavailableError } from "@store-builder/shared/modules/orders/errors";
import { rateLimitKey } from "../../../lib/rate-limit.js";
import { createCheckoutService } from "../../checkout/checkout.api.js";
import { createInventoryService } from "../../inventory/inventory.api.js";
import { OrdersService } from "../application/orders.service.js";
import { TransfersService } from "../application/transfers.service.js";
import { processReceiptImage } from "../../media/media.api.js";
import { PrismaTransferStore } from "./prisma-transfers.repository.js";
import { PaymentsService } from "../application/payments.service.js";
import type { Limiter, PaymentConfig, PaymentGateway, StockHold } from "../application/ports.js";
import { PrismaOrderStore } from "./prisma-orders.repository.js";
import { PrismaPaymentStore } from "./prisma-payments.repository.js";
import { orderTokens } from "./tokens.js";
import { ZarinpalGateway } from "./zarinpal.js";
import { AqayePardakhtGateway } from "./aqayepardakht.js";

interface RateLimiterLike {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const newId = () => randomBytes(12).toString("hex");
const limiterOf = (o: RateLimiterLike): Limiter => ({ consume: (key, rule) => o.consume(rateLimitKey("orders", key), rule) });

/** What online payment reads from elsewhere: the platform settings (switch, sandbox) and the store's secret (its merchant id). */
export interface PaymentSources {
  paymentSettings(): Promise<{ zarinpalEnabled: boolean; aqayepardakhtEnabled: boolean; sandbox: boolean }>;
  reveal(storeId: string, name: string): Promise<string | null>;
  secretsReady(): boolean;
}

/** Composition of online payment (phase 3.5): PostgreSQL attempts, Zarinpal (or the injected fake). */
export function createPaymentsService(o: {
  authSecret: string;
  limiter: RateLimiterLike;
  sources: PaymentSources;
  storeOrigin: (label: string) => string;
  /** Tests: fakes per gateway (a single object is the Zarinpal fake, as in phase 3.5). */
  gateway?: PaymentGateway | Partial<Record<Gateway, PaymentGateway>> | null;
  devBaseUrl?: string;
  /** Development only: a local fake Aghaye Pardakht. */
  devAqayeBaseUrl?: string;
}): PaymentsService {
  const config: PaymentConfig = {
    // Read on every use (one small row): switching payments off or to sandbox applies at once, also to sessions being opened.
    platform: async () => {
      const p = await o.sources.paymentSettings();
      return { enabled: { ZARINPAL: p.zarinpalEnabled, AQAYEPARDAKHT: p.aqayepardakhtEnabled }, sandbox: p.sandbox };
    },
    secretsReady: () => o.sources.secretsReady(),
    fingerprint: (g, id) => sha256(g === "ZARINPAL" ? id.trim().toLowerCase() : id.trim()), // the pin is case-sensitive (review D35c-1)
    newReturnKey: () => {
      const key = randomBytes(32).toString("base64url");
      return { key, hash: sha256(key) };
    },
    hashReturnKey: (key) => (/^[A-Za-z0-9_-]{43}$/.test(key) ? sha256(key) : null),
    credential: async (storeId, g) => {
      const v = (await o.sources.reveal(storeId, GATEWAY_SECRETS[g]))?.trim() ?? null;
      return v === null ? null : g === "ZARINPAL" ? v.toLowerCase() : v; // Zarinpal ids are case-insensitive UUIDs; pins are kept as typed
    },
  };
  const fakes: Partial<Record<Gateway, PaymentGateway>> =
    o.gateway && typeof (o.gateway as PaymentGateway).request === "function" ? { ZARINPAL: o.gateway as PaymentGateway } : ((o.gateway ?? {}) as Partial<Record<Gateway, PaymentGateway>>);
  const gateways: Record<Gateway, PaymentGateway> = {
    ZARINPAL: fakes.ZARINPAL ?? new ZarinpalGateway(o.devBaseUrl ? { baseUrlOverride: o.devBaseUrl } : {}),
    AQAYEPARDAKHT: fakes.AQAYEPARDAKHT ?? new AqayePardakhtGateway(o.devAqayeBaseUrl ? { baseUrlOverride: o.devAqayeBaseUrl } : {}),
  };
  // Each gateway returns to its own page of the store (the return carries different parameters).
  const returnPath: Record<Gateway, string> = { ZARINPAL: "/checkout/payment/return", AQAYEPARDAKHT: "/checkout/payment/return/aqayepardakht" };
  return new PaymentsService(
    new PrismaPaymentStore(), gateways, config, orderTokens(o.authSecret), limiterOf(o.limiter),
    (label, g) => `${o.storeOrigin(label)}${returnPath[g]}`, newId,
  );
}

/** D35b-1: card-to-card (bank cards, receipts re-encoded by the media pipeline and kept in PostgreSQL). */
export function createTransfersService(o: { limiter: RateLimiterLike }): TransfersService {
  return new TransfersService(new PrismaTransferStore(), processReceiptImage, limiterOf(o.limiter));
}

/** Composition: the PostgreSQL order store, the 3.2 stock ledger, the 3.3 checkout (same pricing), keys hashed by rateLimitKey. */
export function createOrdersService(o: { authSecret: string; limiter: RateLimiterLike; payments?: PaymentsService | null; transfers?: TransfersService | null }): OrdersService {
  const inventory = createInventoryService();
  const stock: StockHold = {
    reserve: async (storeId, ref, lines, ttlSeconds) => void (await inventory.reserve(storeId, ref, lines, ttlSeconds)),
    release: (storeId, ref) => inventory.release(storeId, ref),
  };
  return new OrdersService(
    new PrismaOrderStore(), createCheckoutService({ limiter: o.limiter }), stock, orderTokens(o.authSecret), limiterOf(o.limiter), newId,
    () => new Date(),
    {
      assertCanPay: async (storeId, total, method, gateway) => {
        if (method === "CARD_TRANSFER") {
          if (!o.transfers) throw new PaymentUnavailableError("no_cards");
          return o.transfers.assertAvailable(storeId);
        }
        if (!o.payments) throw new PaymentUnavailableError("off");
        return o.payments.assertCanPay(storeId, total, gateway ?? "ZARINPAL");
      },
      transferInfo: (storeId, order) => (o.transfers ? o.transfers.shopperInfo(storeId, order) : Promise.resolve(null)),
    },
  );
}
