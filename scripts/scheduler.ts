import type { ChildProcess } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { formatLog } from "../src/lib/log";
import { JOBS, emptyStatus, runLoop, type LoopDeps, type SchedulerStatus } from "./scheduler-core";
import { runJobProcess, signalJobTree } from "./scheduler-process";

/** Long-running scheduler process (compose service `scheduler`). Health: `pnpm scheduler:health`. */
const STATUS_FILE = process.env.SCHEDULER_STATUS_FILE ?? "/tmp/scheduler-status.json";

let status: SchedulerStatus = emptyStatus(new Date());
let stopping = false;
const children = new Set<ChildProcess>();

const deps: LoopDeps = {
  // Each job runs in its own process group; a timeout kills the whole tree (scripts/scheduler-process.ts).
  run: (command, timeoutMs) => runJobProcess(command, timeoutMs, children),
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  write: (line, level) => (level === "error" ? console.error(line) : console.info(line)),
  save: (s) => {
    writeFileSync(`${STATUS_FILE}.tmp`, JSON.stringify(s));
    renameSync(`${STATUS_FILE}.tmp`, STATUS_FILE); // atomic: the health probe never reads a half-written file
  },
  getStatus: () => status,
  setStatus: (s) => {
    status = s;
  },
  stopped: () => stopping,
};

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(formatLog("info", "scheduler.stop", { signal }));
  for (const c of children) signalJobTree(c, "SIGTERM");
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.info(formatLog("info", "scheduler.start", { jobs: JOBS.map((j) => ({ name: j.name, everyMinutes: j.intervalMs / 60_000 })) }));
deps.save(status);
void Promise.all(JOBS.map((j) => runLoop(j, deps))).then(() => process.exit(0));
