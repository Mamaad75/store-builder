import { Module } from "@nestjs/common";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG } from "../../config/tokens.js";
import { PlatformSettingsService } from "../platform/platform.api.js";
import { OrderSmsService } from "./application/order-sms.service.js";
import { createOrderSmsService } from "./infrastructure/compose.js";
import { StoreSmsSettingsController } from "./interface/sms.controllers.js";

/** Phase 3.6: in the API only the merchant's settings; the worker sends the messages (scripts/worker.ts). */
@Module({
  controllers: [StoreSmsSettingsController],
  providers: [
    {
      provide: OrderSmsService,
      useFactory: (config: ApiConfig, settings: PlatformSettingsService) =>
        createOrderSmsService({
          authSecret: config.authSecret,
          storeOrigin: (label) => `${config.protocol}://${label}.${config.rootDomain}`,
          platform: { settings: () => settings.settings(), reveal: (n) => settings.reveal(n) },
          sender: null, // the API never sends order SMS
        }),
      inject: [CONFIG, PlatformSettingsService],
    },
  ],
})
export class NotificationsModule {}
