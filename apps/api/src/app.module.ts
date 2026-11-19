import { type DynamicModule, Module, type Provider, type Type } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import type { RateLimiter, UserRepository } from "./auth/ports.js";
import { SessionGuard } from "./auth/session.guard.js";
import type { ApiConfig } from "./config/env.js";
import { CONFIG, DATABASE, LOGGER, PRISMA_CLIENT, RATE_LIMITER, USERS } from "./config/tokens.js";
import { type Database, PrismaDatabase } from "./database/database.js";
import { createPrismaClient } from "./database/prisma-client.js";
import { PostgresRateLimiter } from "./database/rate-limiter.js";
import { PrismaUserRepository } from "./database/user.repository.js";
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
}

@Module({})
export class AppModule {
  /** `overrides` lets tests inject fakes; production passes only the config and gets the PostgreSQL implementations. */
  static register(config: ApiConfig, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: CONFIG, useValue: config },
      { provide: LOGGER, useValue: overrides.logger ?? new JsonLogger() },
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
      providers.push({ provide: PRISMA_CLIENT, useFactory: () => createPrismaClient(config.databaseUrl) });
    }
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, ...(overrides.extraControllers ?? [])],
      providers,
      exports: [CONFIG, LOGGER, DATABASE],
    };
  }
}
