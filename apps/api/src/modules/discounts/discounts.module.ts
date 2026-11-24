import { Global, Module } from "@nestjs/common";
import { DiscountsService } from "./application/discounts.service.js";
import { createDiscountsService } from "./infrastructure/compose.js";
import { StoreDiscountsController } from "./interface/discounts.controllers.js";

/** Phase 5.1. Global: the checkout and orders compositions use DiscountsService through discounts.api.ts. */
@Global()
@Module({
  controllers: [StoreDiscountsController],
  providers: [{ provide: DiscountsService, useFactory: () => createDiscountsService() }],
  exports: [DiscountsService],
})
export class DiscountsModule {}
