import "reflect-metadata";
import type { ErrorReporter } from "@store-builder/shared/observability/error-report";
import { createApp } from "./app.js";
import { EnvError, loadConfig } from "./config/env.js";
import { ERROR_REPORTER, METRICS } from "./config/tokens.js";
import { JsonLogger } from "./logging/json-logger.js";
import { startMetricsServer, type ApiMetrics } from "./platform/observability/metrics.js";

const logger = new JsonLogger();
const errorClass = (e: unknown) => (e instanceof Error ? e.name : "UnknownError");

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // names variables only, never values
    logger.event("error", "startup.refused", { problems: err instanceof EnvError ? err.problems : ["unknown"] });
    process.exit(1);
  }
  const app = await createApp(config);
  const reporter = app.get<ErrorReporter>(ERROR_REPORTER);
  // A crash stays a crash (Node's default for both): it is logged and reported first, with a bounded wait for the report.
  const crash = (kind: string) => (e: unknown) => {
    logger.event("error", `process.${kind}`, { errorClass: errorClass(e) });
    reporter.capture(e, { kind });
    void reporter.flush(2000).finally(() => process.exit(1));
  };
  process.on("uncaughtException", crash("uncaught_exception"));
  process.on("unhandledRejection", crash("unhandled_rejection"));

  await app.listen(config.port, config.host);
  logger.event("info", "api.listening", { port: config.port });
  const metrics = app.get<ApiMetrics | null>(METRICS);
  if (metrics && config.observability.metrics) {
    const { port, host } = config.observability.metrics;
    await startMetricsServer(metrics.registry, port, host, { error: (event, fields) => logger.event("error", event, fields) });
    logger.event("info", "metrics.listening", { port });
  }
  logger.event("info", "observability.status", { metrics: Boolean(metrics), errorTracking: Boolean(config.observability.errorTracking) });
}

main().catch((err: unknown) => {
  logger.event("error", "startup.failed", { errorClass: errorClass(err) });
  process.exit(1);
});
