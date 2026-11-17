import { formatLog } from "../src/lib/log";

/**
 * The periodic job runner of the production stack (phase 13). Pure logic lives here so it is unit-tested; scripts/scheduler.ts is the
 * thin process around it. It satisfies the mechanical part of the Phase 14 media-cleanup gate (D10-13): periodic execution, exit-code
 * detection, structured failure logs, and a health probe that goes unhealthy when a job has not SUCCEEDED recently. Alert routing and
 * the staging proof stay Phase 14 work.
 */
export interface JobSpec {
  name: string;
  command: string[];
  intervalMs: number;
  timeoutMs: number;
}

export const MINUTE = 60_000;

/**
 * Jobs run their script through tsx DIRECTLY (the same scripts as `pnpm media:cleanup` / `pnpm db:cleanup`, pinned by a test), not
 * through pnpm: one wrapper process fewer in the tree, and the script's own exit code (0 / 2 / 1) reaches the classifier unchanged.
 * Paths are relative to the working directory of the jobs image (/app).
 */
export const TSX_BIN = "node_modules/.bin/tsx";

export const JOBS: JobSpec[] = [
  // Grace period of unreferenced media is 1 h; every 30 minutes keeps a failed item at most one extra cycle old.
  { name: "media-cleanup", command: [TSX_BIN, "scripts/cleanup-media.ts"], intervalMs: 30 * MINUTE, timeoutMs: 10 * MINUTE },
  { name: "db-cleanup", command: [TSX_BIN, "scripts/cleanup-rate-limits.ts"], intervalMs: 15 * MINUTE, timeoutMs: 5 * MINUTE },
];

/** A job counts as healthy while its last SUCCESS is younger than this many intervals. */
export const STALE_AFTER_INTERVALS = 3;

export type ExitClass = "ok" | "failed_items" | "timeout" | "crashed";

/** Exit codes of `pnpm media:cleanup`: 0 clean, 2 = some items failed (they are retried next run), anything else = the run crashed. */
export function classifyExit(exitCode: number | null, timedOut: boolean): ExitClass {
  if (timedOut) return "timeout";
  if (exitCode === 0) return "ok";
  if (exitCode === 2) return "failed_items";
  return "crashed";
}

export interface JobStatus {
  lastStart?: string;
  lastFinish?: string;
  lastSuccess?: string;
  lastExitCode?: number | null;
  lastClass?: ExitClass;
  consecutiveFailures: number;
}
export interface SchedulerStatus {
  startedAt: string;
  jobs: Record<string, JobStatus>;
}

export const emptyStatus = (now: Date): SchedulerStatus => ({ startedAt: now.toISOString(), jobs: {} });

export function recordStart(status: SchedulerStatus, job: string, now: Date): SchedulerStatus {
  const prev = status.jobs[job] ?? { consecutiveFailures: 0 };
  return { ...status, jobs: { ...status.jobs, [job]: { ...prev, lastStart: now.toISOString() } } };
}

export function recordResult(status: SchedulerStatus, job: string, r: { exitCode: number | null; cls: ExitClass }, now: Date): SchedulerStatus {
  const prev = status.jobs[job] ?? { consecutiveFailures: 0 };
  const ok = r.cls === "ok";
  return {
    ...status,
    jobs: {
      ...status.jobs,
      [job]: {
        ...prev,
        lastFinish: now.toISOString(),
        lastExitCode: r.exitCode,
        lastClass: r.cls,
        lastSuccess: ok ? now.toISOString() : prev.lastSuccess,
        consecutiveFailures: ok ? 0 : prev.consecutiveFailures + 1,
      },
    },
  };
}

export function evaluateHealth(status: SchedulerStatus | null, jobs: JobSpec[], now: Date): { healthy: boolean; stale: string[] } {
  if (!status) return { healthy: false, stale: jobs.map((j) => j.name) };
  const stale = jobs
    .filter((j) => {
      const since = Date.parse(status.jobs[j.name]?.lastSuccess ?? status.startedAt);
      return now.getTime() - since > STALE_AFTER_INTERVALS * j.intervalMs;
    })
    .map((j) => j.name);
  return { healthy: stale.length === 0, stale };
}

export interface LoopDeps {
  run: (command: string[], timeoutMs: number) => Promise<{ exitCode: number | null; timedOut: boolean }>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  write: (line: string, level: "info" | "error") => void;
  save: (status: SchedulerStatus) => void;
  getStatus: () => SchedulerStatus;
  setStatus: (s: SchedulerStatus) => void;
  stopped: () => boolean;
}

/** One execution: logs start and result as JSON lines (errors at level "error", which is what alerting matches on). */
export async function runOnce(job: JobSpec, d: LoopDeps): Promise<ExitClass> {
  const started = d.now();
  d.setStatus(recordStart(d.getStatus(), job.name, started));
  d.save(d.getStatus());
  d.write(formatLog("info", "job.start", { job: job.name }, d.now), "info");
  const { exitCode, timedOut } = await d.run(job.command, job.timeoutMs);
  const finished = d.now();
  const cls = classifyExit(exitCode, timedOut);
  d.setStatus(recordResult(d.getStatus(), job.name, { exitCode, cls }, finished));
  d.save(d.getStatus());
  const common = { job: job.name, exitCode, class: cls, durationMs: finished.getTime() - started.getTime(), consecutiveFailures: d.getStatus().jobs[job.name]!.consecutiveFailures };
  if (cls === "ok") d.write(formatLog("info", "job.finish", common, d.now), "info");
  else d.write(formatLog("error", "job.failed", { ...common, recovery: "the next run retries; see docs/runbook.md" }, d.now), "error");
  return cls;
}

/** Never overlaps itself: the next run starts one interval after the previous one FINISHED. */
export async function runLoop(job: JobSpec, d: LoopDeps): Promise<void> {
  while (!d.stopped()) {
    await runOnce(job, d);
    if (d.stopped()) break;
    await d.sleep(job.intervalMs);
  }
}
