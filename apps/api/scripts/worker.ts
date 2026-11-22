import type { ChildProcess } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { EnvError, loadWorkerConfig, type WorkerConfig } from "../src/config/env.js";
import { createPrismaClient } from "../src/database/prisma-client.js";
import { AlertConfigError, createNotifier, readAlertConfig, type AlertConfig } from "../src/lib/alert.js";
import { useDb } from "../src/lib/db.js";
import { formatLog } from "../src/lib/log.js";
import { createErrorReporter, NO_REPORTER } from "@store-builder/shared/observability/error-report";
import { EVENT_HANDLERS } from "../src/worker/handlers.js";
import { startWorker } from "../src/worker/worker.js";
import { JOBS, emptyStatus, runOnce, type LoopDeps, type SchedulerStatus } from "./scheduler-core.js";
import { runJobProcess, signalJobTree } from "./scheduler-process.js";

/**
 * Worker process (phase 2.2; compose service `worker`, which replaced `scheduler` in 2.2b): outbox relay, domain-event consumers and
 * the periodic maintenance jobs. Health: `pnpm worker:health`. Local run: `pnpm worker` (needs `docker compose up -d valkey`).
 */
const STATUS_FILE = process.env.WORKER_STATUS_FILE ?? "/tmp/worker-status.json";

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
if (!alertConfig) console.warn(formatLog("warn", "alert.disabled", { reason: "BALE_BOT_TOKEN and BALE_CHAT_ID are not set" }));
const alert = createNotifier(alertConfig);
// Phase 2.6: error tracking (ERROR_TRACKING_DSN) and the metrics endpoint (METRICS_PORT); both off when unset.
const et = config.observability.errorTracking;
let countReport: (outcome: "sent" | "failed" | "rate_limited" | "duplicate") => void = () => undefined; // connected by startWorker when metrics are on
const reporter = et ? createErrorReporter({ dsn: et.dsn, service: "worker", environment: et.environment, release: et.release, onOutcome: (x) => countReport(x) }) : NO_REPORTER;
const crash = (kind: string) => (e: unknown) => {
  console.error(formatLog("error", `process.${kind}`, { errorClass: e instanceof Error ? e.name : "UnknownError" }));
  reporter.capture(e, { kind });
  void reporter.flush(2000).finally(() => process.exit(1));
};
process.on("uncaughtException", crash("uncaught_exception"));
process.on("unhandledRejection", crash("unhandled_rejection"));

let status: SchedulerStatus = emptyStatus(new Date());
const children = new Set<ChildProcess>();
const deps: LoopDeps = {
  // Each job runs in its own process group; a timeout kills the whole tree (scripts/scheduler-process.ts).
  run: (command, timeoutMs) => runJobProcess(command, timeoutMs, children),
  now: () => new Date(),
  write: (line, level) => (level === "error" ? console.error(line) : console.info(line)),
  save: (s) => {
    writeFileSync(`${STATUS_FILE}.tmp`, JSON.stringify(s));
    renameSync(`${STATUS_FILE}.tmp`, STATUS_FILE); // atomic: the health probe never reads a half-written file
  },
  getStatus: () => status,
  setStatus: (s) => {
    status = s;
  },
  alert,
};
deps.save(status);

const prisma = createPrismaClient(config.databaseUrl);
useDb(prisma);
const worker = await startWorker({
  redisUrl: config.redisUrl,
  handlers: EVENT_HANDLERS,
  alert,
  metrics: config.observability.metrics,
  reporter,
  bindReportOutcome: (count) => (countReport = count),
  maintenance: {
    jobs: JOBS.map((j) => ({ name: j.name, everyMs: j.intervalMs })),
    run: async (name) => {
      const job = JOBS.find((j) => j.name === name);
      if (!job) throw new Error(`unknown maintenance job ${name}`); // a stale scheduler from an older release: fail it visibly
      return runOnce(job, deps); // logs, status and alerts happen inside; the next tick is the retry. The result class feeds the metrics.
    },
  },
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(formatLog("info", "worker.signal", { signal }));
  for (const c of children) signalJobTree(c, "SIGTERM");
  setTimeout(() => process.exit(1), 15_000).unref(); // hard stop if a job refuses to finish
  await worker.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
