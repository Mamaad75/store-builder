import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule, type AppOverrides } from "./app.module.js";
import type { ApiConfig } from "./config/env.js";
import { AllExceptionsFilter } from "./http/all-exceptions.filter.js";
import { JsonLogger } from "./logging/json-logger.js";

export async function createApp(config: ApiConfig, overrides: AppOverrides = {}): Promise<NestExpressApplication> {
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
  // Session material must never be cached by anything between the API and the browser.
  app.use("/api/auth", (_req: unknown, res: { setHeader(n: string, v: string): void }, next: () => void) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.enableShutdownHooks();
  return app;
}
