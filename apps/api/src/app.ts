import type { Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import type { ApiConfig } from "./config/env.js";
import type { Database } from "./database/database.js";
import { AllExceptionsFilter } from "./http/all-exceptions.filter.js";
import { JsonLogger } from "./logging/json-logger.js";

export async function createApp(config: ApiConfig, overrides: { database?: Database; logger?: JsonLogger; extraControllers?: Type<unknown>[] } = {}): Promise<NestExpressApplication> {
  const logger = overrides.logger ?? new JsonLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, { ...overrides, logger }), { logger, bodyParser: false });
  app.setGlobalPrefix("api");
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  // JSON only, bounded size
  app.useBodyParser("json", { limit: config.bodyLimitBytes });
  app.use(
    helmet({
      // The API returns JSON only: nothing may be framed, scripted or embedded from it.
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts: config.production ? { maxAge: 63_072_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.enableShutdownHooks();
  return app;
}
