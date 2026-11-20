import { readFileSync } from "node:fs";
import { JOBS, evaluateHealth, type SchedulerStatus } from "./scheduler-core.js";

/** Exit 0 when every job has succeeded recently; exit 1 (and name the stale jobs) otherwise. Used as the container health check. */
let status: SchedulerStatus | null = null;
try {
  status = JSON.parse(readFileSync(process.env.SCHEDULER_STATUS_FILE ?? "/tmp/scheduler-status.json", "utf8")) as SchedulerStatus;
} catch {
  status = null;
}
const r = evaluateHealth(status, JOBS, new Date());
if (!r.healthy) {
  console.error(JSON.stringify({ level: "error", event: "scheduler.unhealthy", stale: r.stale }));
  process.exit(1);
}
