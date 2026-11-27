import { randomBytes } from "node:crypto";
import { referralCodeFrom, REFERRAL_CODE_LENGTH } from "@store-builder/shared/modules/billing/billing";
import { effectiveSandbox, type AppEnv } from "../../../config/env.js";
import { StaffBillingService, StoreBillingService } from "../application/billing.service.js";
import { PlatformPaymentsService } from "../application/payments.service.js";
import type { GatewayConfig, PlatformGateway } from "../application/payment-ports.js";
import { ZarinpalGateway } from "../../orders/orders.api.js";
import { PrismaBillingRepository } from "./prisma-billing.repository.js";
import { PrismaPaymentsRepository } from "./prisma-payments.repository.js";

const repo = () => new PrismaBillingRepository(() => referralCodeFrom(randomBytes(REFERRAL_CODE_LENGTH)));
export const createStoreBillingService = (): StoreBillingService => new StoreBillingService(repo());
export const createStaffBillingService = (): StaffBillingService => new StaffBillingService(repo());

/** The platform's own Zarinpal terminal: the switch and sandbox from the platform settings, the merchant id from the platform secrets (a well-formed UUID or nothing). */
export interface PlatformGatewaySources {
  settings(): Promise<{ payment: { zarinpalEnabled: boolean; sandbox: boolean } }>;
  reveal(name: "payment.zarinpal.merchant_id"): Promise<string | null>;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createPlatformPaymentsService(o: {
  appEnv: AppEnv;
  sources: PlatformGatewaySources;
  /** `<protocol>://<root domain>/dashboard/stores/<id>/billing/return`. */
  returnUrl: (storeId: string) => string;
  /** Tests: a fake gateway. */
  gateway?: PlatformGateway | null;
  /** Development and tests: a local fake Zarinpal. */
  devBaseUrl?: string;
}): PlatformPaymentsService {
  const config: GatewayConfig = {
    current: async () => {
      const { payment } = await o.sources.settings();
      const id = (await o.sources.reveal("payment.zarinpal.merchant_id"))?.trim().toLowerCase() ?? null;
      const merchantId = id && UUID_RE.test(id) ? id : null;
      return { ready: payment.zarinpalEnabled && merchantId !== null, sandbox: effectiveSandbox(payment.sandbox, o.appEnv), merchantId };
    },
  };
  const gateway = o.gateway ?? new ZarinpalGateway(o.devBaseUrl ? { baseUrlOverride: o.devBaseUrl } : {});
  return new PlatformPaymentsService(new PrismaPaymentsRepository(), gateway, config, o.returnUrl);
}
