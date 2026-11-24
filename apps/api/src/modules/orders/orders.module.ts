import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG, PAYMENT_GATEWAY, RATE_LIMITER } from "../../config/tokens.js";
import { PlatformSettingsService } from "../platform/platform.api.js";
import { SecretService } from "../secrets/secrets.api.js";
import { OrdersService } from "./application/orders.service.js";
import { PaymentsService } from "./application/payments.service.js";
import type { PaymentGateway } from "./application/ports.js";
import { createOrdersService, createPaymentsService } from "./infrastructure/compose.js";
import { CustomerOrdersController, PaymentsController, PublicOrdersController, StorePaymentSettingsController, StoreOrdersController } from "./interface/orders.controllers.js";

@Module({
  controllers: [PublicOrdersController, CustomerOrdersController, StoreOrdersController, PaymentsController, StorePaymentSettingsController],
  providers: [
    {
      provide: PaymentsService,
      useFactory: (config: ApiConfig, limiter: RateLimiter, settings: PlatformSettingsService, secrets: SecretService, gateway: PaymentGateway | null) =>
        createPaymentsService({
          authSecret: config.authSecret,
          limiter,
          sources: { paymentSettings: async () => (await settings.settings()).payment, reveal: (storeId, name) => (secrets.configured ? secrets.reveal(storeId, name) : Promise.resolve(null)), secretsReady: () => secrets.configured },
          storeOrigin: (label) => `${config.protocol}://${label}.${config.rootDomain}`,
          gateway,
          devBaseUrl: config.zarinpalDevBaseUrl,
        }),
      inject: [CONFIG, RATE_LIMITER, PlatformSettingsService, SecretService, PAYMENT_GATEWAY],
    },
    {
      provide: OrdersService,
      useFactory: (config: ApiConfig, limiter: RateLimiter, payments: PaymentsService) => createOrdersService({ authSecret: config.authSecret, limiter, payments }),
      inject: [CONFIG, RATE_LIMITER, PaymentsService],
    },
  ],
})
export class OrdersModule {}
