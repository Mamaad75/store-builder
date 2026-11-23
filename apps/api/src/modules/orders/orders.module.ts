import { Module } from "@nestjs/common";
import type { RateLimiter } from "../../auth/ports.js";
import type { ApiConfig } from "../../config/env.js";
import { CONFIG, RATE_LIMITER } from "../../config/tokens.js";
import { OrdersService } from "./application/orders.service.js";
import { createOrdersService } from "./infrastructure/compose.js";
import { CustomerOrdersController, PublicOrdersController, StoreOrdersController } from "./interface/orders.controllers.js";

@Module({
  controllers: [PublicOrdersController, CustomerOrdersController, StoreOrdersController],
  providers: [
    {
      provide: OrdersService,
      useFactory: (config: ApiConfig, limiter: RateLimiter) => createOrdersService({ authSecret: config.authSecret, limiter }),
      inject: [CONFIG, RATE_LIMITER],
    },
  ],
})
export class OrdersModule {}
