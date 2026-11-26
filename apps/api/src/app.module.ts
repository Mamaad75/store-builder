import { type DynamicModule, Module, type Provider, type Type } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import type { RateLimiter, UserRepository } from "./auth/ports.js";
import { SessionGuard } from "./auth/session.guard.js";
import type { ApiConfig } from "./config/env.js";
import { CONFIG, DATABASE, ERROR_REPORTER, LOGGER, METRICS, PAYMENT_GATEWAY, PRISMA_CLIENT, RATE_LIMITER, USERS } from "./config/tokens.js";
import { NO_REPORTER, type ErrorReporter } from "@store-builder/shared/observability/error-report";
import type { ApiMetrics } from "./platform/observability/metrics.js";
import { type Database, PrismaDatabase } from "./database/database.js";
import { useDb } from "./lib/db.js";
import { createPrismaClient } from "./database/prisma-client.js";
import { PostgresRateLimiter } from "./database/rate-limiter.js";
import { PrismaUserRepository } from "./database/user.repository.js";
import { CatalogController } from "./modules/catalog/catalog.controller.js";
import { AccessModule } from "./modules/access/access.module.js";
import { CategoriesModule } from "./modules/categories/categories.module.js";
import { SecretsModule } from "./modules/secrets/secrets.module.js";
import { CustomersModule } from "./modules/customers/customers.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { CheckoutModule } from "./modules/checkout/checkout.module.js";
import { AnalyticsModule } from "./modules/analytics/analytics.module.js";
import { BlogModule } from "./modules/blog/blog.module.js";
import { ReviewsModule } from "./modules/reviews/reviews.module.js";
import { SupportModule } from "./modules/support/support.module.js";
import { OrdersModule } from "./modules/orders/orders.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { DiscountsModule } from "./modules/discounts/discounts.module.js";
import { PricingModule } from "./modules/pricing/pricing.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { MediaController } from "./modules/media/media.controller.js";
import { PagesController } from "./modules/pages/pages.controller.js";
import { PublishingController } from "./modules/publishing/publishing.controller.js";
import { PublicStoresController } from "./modules/storefront/public.controller.js";
import { StoresController } from "./modules/stores/stores.controller.js";
import { HealthController } from "./health/health.controller.js";
import { AllExceptionsFilter } from "./http/all-exceptions.filter.js";
import { OriginGuard } from "./http/origin.guard.js";
import { JsonLogger } from "./logging/json-logger.js";

export interface AppOverrides {
  database?: Database;
  users?: UserRepository;
  rateLimiter?: RateLimiter;
  logger?: JsonLogger;
  extraControllers?: Type<unknown>[];
  errorReporter?: ErrorReporter;
  metrics?: ApiMetrics | null;
  /** Phase 3.5: a fake payment gateway (the real one is Zarinpal). */
  paymentGateway?: unknown;
}

@Module({})
export class AppModule {
  /** `overrides` lets tests inject fakes; production passes only the config and gets the PostgreSQL implementations. */
  static register(config: ApiConfig, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: CONFIG, useValue: config },
      { provide: LOGGER, useValue: overrides.logger ?? new JsonLogger() },
      { provide: ERROR_REPORTER, useValue: overrides.errorReporter ?? NO_REPORTER },
      { provide: METRICS, useValue: overrides.metrics ?? null },
      { provide: PAYMENT_GATEWAY, useValue: overrides.paymentGateway ?? null },
      overrides.database ? { provide: DATABASE, useValue: overrides.database } : { provide: DATABASE, useClass: PrismaDatabase },
      overrides.users ? { provide: USERS, useValue: overrides.users } : { provide: USERS, useClass: PrismaUserRepository },
      overrides.rateLimiter ? { provide: RATE_LIMITER, useValue: overrides.rateLimiter } : { provide: RATE_LIMITER, useClass: PostgresRateLimiter },
      { provide: APP_GUARD, useClass: OriginGuard },
      AuthService,
      SessionGuard,
      AllExceptionsFilter,
    ];
    // The Prisma client exists only when something real needs it (a lazy client costs nothing, but tests then need no database URL).
    if (!overrides.database || !overrides.users || !overrides.rateLimiter) {
      providers.push({
        provide: PRISMA_CLIENT,
        useFactory: () => {
          const client = createPrismaClient(config.databaseUrl);
          useDb(client); // the domain modules read through the shared `db` handle
          return client;
        },
      });
    }
    return {
      module: AppModule,
      // Global, so the feature modules (ADR 0002 layout) resolve SessionGuard and its dependencies without importing AppModule back.
      global: true,
      imports: [AccessModule, CategoriesModule, SecretsModule, CustomersModule, PlatformModule, InventoryModule, PricingModule, CheckoutModule, OrdersModule, AnalyticsModule, NotificationsModule, DiscountsModule, SupportModule, ReviewsModule, BlogModule],
      controllers: [HealthController, AuthController, StoresController, CatalogController, PagesController, MediaController, PublishingController, PublicStoresController, ...(overrides.extraControllers ?? [])],
      providers,
      exports: [CONFIG, LOGGER, DATABASE, RATE_LIMITER, PAYMENT_GATEWAY, AuthService, SessionGuard],
    };
  }
}
