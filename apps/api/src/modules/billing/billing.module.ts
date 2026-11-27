import { Module } from "@nestjs/common";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG, PAYMENT_GATEWAY } from "../../config/tokens.js";
import { PlatformSettingsService } from "../platform/platform.api.js";
import { StaffBillingService, StoreBillingService } from "./application/billing.service.js";
import { PlatformPaymentsService } from "./application/payments.service.js";
import type { PlatformGateway } from "./application/payment-ports.js";
import { createPlatformPaymentsService, createStaffBillingService, createStoreBillingService } from "./infrastructure/compose.js";
import { PlatformBillingController } from "./interface/platform-billing.controller.js";
import { StoreBillingController } from "./interface/billing.controllers.js";

/** Subscriptions, the store wallet and referrals; a store pays the platform through the gateway (a plan, or a wallet top-up) or staff record a purchase. */
@Module({
  controllers: [StoreBillingController, PlatformBillingController],
  providers: [
    { provide: StoreBillingService, useFactory: createStoreBillingService },
    { provide: StaffBillingService, useFactory: createStaffBillingService },
    {
      provide: PlatformPaymentsService,
      useFactory: (config: ApiConfig, settings: PlatformSettingsService, gateway: PlatformGateway | Record<string, PlatformGateway> | null) =>
        createPlatformPaymentsService({
          appEnv: config.appEnv,
          sources: { settings: async () => settings.settings(), reveal: (name) => settings.reveal(name) },
          returnUrl: (storeId) => `${config.protocol}://${config.rootDomain}/dashboard/stores/${storeId}/billing/return`,
          // the tests inject one fake Zarinpal (the same object the stores' payments use)
          gateway: gateway && typeof (gateway as PlatformGateway).request === "function" ? (gateway as PlatformGateway) : null,
          devBaseUrl: config.zarinpalDevBaseUrl,
        }),
      inject: [CONFIG, PlatformSettingsService, PAYMENT_GATEWAY],
    },
  ],
})
export class BillingModule {}
