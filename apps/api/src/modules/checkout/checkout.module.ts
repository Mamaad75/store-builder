import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import { RATE_LIMITER } from "../../config/tokens.js";
import { CheckoutService } from "./application/checkout.service.js";
import { ShippingService } from "./application/shipping.service.js";
import { createCheckoutService, createShippingService } from "./infrastructure/compose.js";
import { CustomerAddressesController, PublicCheckoutController, ShippingMethodsController } from "./interface/checkout.controllers.js";

@Module({
  controllers: [PublicCheckoutController, CustomerAddressesController, ShippingMethodsController],
  providers: [
    { provide: CheckoutService, useFactory: (limiter: RateLimiter) => createCheckoutService({ limiter }), inject: [RATE_LIMITER] },
    { provide: ShippingService, useFactory: createShippingService },
  ],
})
export class CheckoutModule {}
