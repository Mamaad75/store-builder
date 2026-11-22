import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { configureRateLimiter } from "./lib/rate-limit.js";
import { configureStorage } from "./lib/storage/index.js";
import { AppModule, type AppOverrides } from "./app.module.js";
import type { ApiConfig } from "./config/env.js";
import { AllExceptionsFilter } from "./http/all-exceptions.filter.js";
import { JsonLogger } from "./logging/json-logger.js";
import { createErrorReporter, NO_REPORTER } from "@store-builder/shared/observability/error-report";
import { createApiMetrics, httpMetricsMiddleware } from "./platform/observability/metrics.js";
import { requestIdMiddleware } from "./platform/observability/request-context.js";

export async function createApp(config: ApiConfig, overrides: AppOverrides = {}): Promise<NestExpressApplication> {
  if (config.storage) configureStorage(config.storage);
  configureRateLimiter(config.rateLimitBackend);
  const logger = overrides.logger ?? new JsonLogger();
  // Phase 2.6: metrics only with METRICS_PORT (served by main.ts on that port), error tracking only with ERROR_TRACKING_DSN.
  const metrics = overrides.metrics !== undefined ? overrides.metrics : config.observability.metrics ? createApiMetrics() : null;
  const et = config.observability.errorTracking;
  const errorReporter = overrides.errorReporter ?? (et ? createErrorReporter({ dsn: et.dsn, service: "api", environment: et.environment, release: et.release, onOutcome: metrics?.onReport }) : NO_REPORTER);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, { ...overrides, logger, metrics, errorReporter }), { logger, bodyParser: false });
  // First of all: the request id (logs and error reports of this request carry it) and the request metrics (they also count requests
  // the body parsers refuse).
  app.use(requestIdMiddleware);
  if (metrics) app.use(httpMetricsMiddleware(metrics));
  app.setGlobalPrefix("api");
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  // JSON only, bounded size
  app.useBodyParser("json", { limit: config.bodyLimitBytes });
  // Image uploads travel as raw bytes (the pipeline enforces the real limits again): 5 MB image + slack.
  app.useBodyParser("raw", { type: "application/octet-stream", limit: 6 * 1024 * 1024 });
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
