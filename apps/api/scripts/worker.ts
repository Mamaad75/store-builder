import { EnvError, loadWorkerConfig, type WorkerConfig } from "../src/config/env.js";
import { createPrismaClient } from "../src/database/prisma-client.js";
import { AlertConfigError, createNotifier, readAlertConfig, type AlertConfig } from "../src/lib/alert.js";
import { useDb } from "../src/lib/db.js";
import { formatLog } from "../src/lib/log.js";
import { EVENT_HANDLERS } from "../src/worker/handlers.js";
import { startWorker } from "../src/worker/worker.js";

/** Worker process (phase 2.2): outbox relay + domain-event consumers. Local run: `pnpm worker` (needs `docker compose up -d valkey`). */
let config: WorkerConfig;
let alertConfig: AlertConfig | null;
try {
  config = loadWorkerConfig(process.env);
  alertConfig = readAlertConfig(process.env);
} catch (e) {
  // Names of the bad variables only, never their values.
  const reason = e instanceof EnvError ? e.problems.join("; ") : e instanceof AlertConfigError ? e.message : "invalid configuration";
  console.error(formatLog("error", "startup.refused", { reason }));
  process.exit(1);
}

const prisma = createPrismaClient(config.databaseUrl);
useDb(prisma);
const worker = startWorker({ redisUrl: config.redisUrl, handlers: EVENT_HANDLERS, alert: createNotifier(alertConfig) });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(formatLog("info", "worker.signal", { signal }));
  setTimeout(() => process.exit(1), 15_000).unref(); // hard stop if a job refuses to finish
  await worker.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
