import { Module } from "@nestjs/common";
import { PlatformSettingsService } from "../platform/platform.api.js";
import { PricingService } from "./application/pricing.service.js";
import { RatesService } from "./application/rates.service.js";
import { createPricingService, createRatesService } from "./infrastructure/compose.js";
import { PlatformRatesController } from "./interface/platform-rates.controller.js";
import { PriceLinksController } from "./interface/price-links.controller.js";

@Module({
  controllers: [PriceLinksController, PlatformRatesController],
  providers: [
    { provide: PricingService, useFactory: createPricingService },
    { provide: RatesService, useFactory: (settings: PlatformSettingsService) => createRatesService(settings), inject: [PlatformSettingsService] },
  ],
  exports: [PricingService, RatesService],
})
export class PricingModule {}
