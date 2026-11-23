import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG, RATE_LIMITER } from "../../config/tokens.js";
import { CustomerAuthService } from "./application/customer-auth.service.js";
import { CustomersService } from "./application/customers.service.js";
import { createCustomerAuthService, createCustomersService } from "./infrastructure/compose.js";
import { PlatformSettingsService, otpSenderSource } from "../platform/platform.api.js";
import { CustomerAuthController, StoreCustomersController } from "./interface/customers.controllers.js";

@Module({
  controllers: [CustomerAuthController, StoreCustomersController],
  providers: [
    {
      provide: CustomerAuthService,
      useFactory: (config: ApiConfig, limiter: RateLimiter, settings: PlatformSettingsService) =>
        createCustomerAuthService({ authSecret: config.authSecret, sender: otpSenderSource(settings), limiter }),
      inject: [CONFIG, RATE_LIMITER, PlatformSettingsService],
    },
    { provide: CustomersService, useFactory: createCustomersService },
  ],
  exports: [CustomerAuthService],
})
export class CustomersModule {}
