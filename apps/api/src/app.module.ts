import { type DynamicModule, Module, type Type } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiConfig } from "./config/env.js";
import { CONFIG, DATABASE, LOGGER } from "./config/tokens.js";
import { type Database, PrismaDatabase } from "./database/database.js";
import { HealthController } from "./health/health.controller.js";
import { AllExceptionsFilter } from "./http/all-exceptions.filter.js";
import { OriginGuard } from "./http/origin.guard.js";
import { JsonLogger } from "./logging/json-logger.js";

@Module({})
export class AppModule {
  /** `overrides` lets tests inject a fake database and a capturing logger; production passes only the config. */
  static register(config: ApiConfig, overrides: { database?: Database; logger?: JsonLogger; extraControllers?: Type<unknown>[] } = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, ...(overrides.extraControllers ?? [])],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: LOGGER, useValue: overrides.logger ?? new JsonLogger() },
        overrides.database ? { provide: DATABASE, useValue: overrides.database } : { provide: DATABASE, useClass: PrismaDatabase },
        { provide: APP_GUARD, useClass: OriginGuard },
        AllExceptionsFilter,
      ],
      exports: [CONFIG, LOGGER, DATABASE],
    };
  }
}
