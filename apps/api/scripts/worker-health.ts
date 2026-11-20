import { readFileSync } from "node:fs";
import { JOBS, evaluateHealth, type SchedulerStatus } from "./scheduler-core.js";

/**
 * Container health check of the worker (`pnpm worker:health`): exit 0 when every maintenance job has SUCCEEDED recently. The jobs are
 * triggered through Valkey, so a dead queue, a dead worker or a failing job all turn this unhealthy within three intervals.
 */
let status: SchedulerStatus | null = null;
try {
  status = JSON.parse(readFileSync(process.env.WORKER_STATUS_FILE ?? "/tmp/worker-status.json", "utf8")) as SchedulerStatus;
} catch {
  status = null;
}
const r = evaluateHealth(status, JOBS, new Date());
if (!r.healthy) {
  console.error(JSON.stringify({ level: "error", event: "worker.unhealthy", stale: r.stale }));
  process.exit(1);
}
