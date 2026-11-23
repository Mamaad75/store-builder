import type { PlatformSettingsService } from "../../platform/platform.api.js";
import { PricingService } from "../application/pricing.service.js";
import { RatesService } from "../application/rates.service.js";
import type { RatesConfig } from "../application/ports.js";
import { NavasanSource } from "./navasan.js";
import { PrismaLinkReader, PrismaLinkUnitOfWork, PrismaRateStore, PrismaRepricer } from "./prisma-pricing.repository.js";

/** Composition: the one place where the PostgreSQL implementations and the rate provider are handed to the use cases. */
export function createPricingService(): PricingService {
  return new PricingService(new PrismaLinkReader(), new PrismaLinkUnitOfWork(), new PrismaRateStore());
}

/** Rates configuration from the platform settings (group "rates") and the platform secret holding the provider key. */
export function ratesConfig(settings: PlatformSettingsService): RatesConfig {
  return {
    settings: async () => (await settings.settings()).rates,
    async source(s) {
      if (s.provider !== "navasan") return null;
      const key = await settings.reveal("rates.navasan.api_key");
      return key ? new NavasanSource(key, { unit: s.providerUnit, allowInsecureHttp: s.allowInsecureHttp }) : null;
    },
  };
}

export function createRatesService(settings: PlatformSettingsService): RatesService {
  return new RatesService(new PrismaRateStore(), ratesConfig(settings), new PrismaRepricer());
}
