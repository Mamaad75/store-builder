import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG, PAYMENT_GATEWAY, RATE_LIMITER } from "../../config/tokens.js";
import { PlatformSettingsService } from "../platform/platform.api.js";
import { SecretService } from "../secrets/secrets.api.js";
import { OrdersService } from "./application/orders.service.js";
import { PaymentsService } from "./application/payments.service.js";
import { TransfersService } from "./application/transfers.service.js";
import { OverviewService } from "./application/overview.service.js";
import { PrismaOverviewReader } from "./infrastructure/prisma-overview.reader.js";
import type { PaymentGateway } from "./application/ports.js";
import { createOrdersService, createPaymentsService, createTransfersService } from "./infrastructure/compose.js";
import { CustomerOrdersController, StoreOverviewController, PaymentsController, PublicOrdersController, StoreBankCardsController, StorePaymentSettingsController, StoreOrdersController } from "./interface/orders.controllers.js";

@Module({
  controllers: [PublicOrdersController, CustomerOrdersController, StoreOrdersController, PaymentsController, StorePaymentSettingsController, StoreBankCardsController, StoreOverviewController],
  providers: [
    {
      provide: PaymentsService,
      useFactory: (config: ApiConfig, limiter: RateLimiter, settings: PlatformSettingsService, secrets: SecretService, gateway: PaymentGateway | Record<string, PaymentGateway> | null) =>
        createPaymentsService({
          authSecret: config.authSecret,
          limiter,
          sources: { paymentSettings: async () => (await settings.settings()).payment, reveal: (storeId, name) => (secrets.configured ? secrets.reveal(storeId, name) : Promise.resolve(null)), secretsReady: () => secrets.configured },
          storeOrigin: (label) => `${config.protocol}://${label}.${config.rootDomain}`,
          gateway,
          devBaseUrl: config.zarinpalDevBaseUrl,
          devAqayeBaseUrl: config.aqayepardakhtDevBaseUrl,
        }),
      inject: [CONFIG, RATE_LIMITER, PlatformSettingsService, SecretService, PAYMENT_GATEWAY],
    },
    { provide: OverviewService, useFactory: () => new OverviewService(new PrismaOverviewReader()) },
    { provide: TransfersService, useFactory: (limiter: RateLimiter) => createTransfersService({ limiter }), inject: [RATE_LIMITER] },
    {
      provide: OrdersService,
      useFactory: (config: ApiConfig, limiter: RateLimiter, payments: PaymentsService, transfers: TransfersService) =>
        createOrdersService({ authSecret: config.authSecret, limiter, payments, transfers }),
      inject: [CONFIG, RATE_LIMITER, PaymentsService, TransfersService],
    },
  ],
})
export class OrdersModule {}
