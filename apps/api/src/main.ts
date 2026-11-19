import "reflect-metadata";
import { createApp } from "./app.js";
import { EnvError, loadConfig } from "./config/env.js";
import { JsonLogger } from "./logging/json-logger.js";

const logger = new JsonLogger();

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
  await app.listen(config.port, config.host);
  logger.event("info", "api.listening", { port: config.port });
}

main().catch((err: unknown) => {
  logger.event("error", "startup.failed", { errorClass: err instanceof Error ? err.name : "UnknownError" });
  process.exit(1);
});
