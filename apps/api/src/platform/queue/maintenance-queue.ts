import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_PREFIX } from "./event-queue.js";

/**
 * Periodic maintenance jobs on BullMQ Job Schedulers (phase 2.2b; replaces the in-process scheduler loop). The schedule lives in
 * Valkey, so it survives restarts and fires once per interval however many workers run; global concurrency 1 means a job never
 * overlaps itself (nor another maintenance job) across processes.
 */
export const MAINTENANCE_QUEUE = "maintenance";

export interface ScheduledJob {
  name: string;
  everyMs: number;
}

export interface MaintenanceHooks {
  log: { info(event: string, fields?: Record<string, unknown>): void; error(event: string, fields?: Record<string, unknown>): void };
}

/**
 * Upserts one scheduler per job and removes schedulers of jobs that no longer exist (a renamed or deleted job must not keep
 * firing). `run` receives the job name; it reports failures itself (logs, alerts), so a thrown error only marks the BullMQ job failed.
 */
export async function startMaintenance(
  connection: Redis,
  jobs: readonly ScheduledJob[],
  run: (name: string) => Promise<void>,
  hooks: MaintenanceHooks,
  prefix: string = QUEUE_PREFIX,
): Promise<{ queue: Queue; worker: Worker; close(): Promise<void> }> {
  const queue = new Queue(MAINTENANCE_QUEUE, { connection, prefix });
  await queue.setGlobalConcurrency(1);
  const wanted = new Set(jobs.map((j) => j.name));
  for (const s of await queue.getJobSchedulers()) {
    if (s.key && !wanted.has(s.key)) await queue.removeJobScheduler(s.key);
  }
  for (const j of jobs) {
    // attempts 1: the next scheduled run is the retry; completed/failed runs are kept briefly for inspection only.
    await queue.upsertJobScheduler(j.name, { every: j.everyMs }, { name: j.name, opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } });
  }
  const worker = new Worker(MAINTENANCE_QUEUE, (job) => run(job.name), { connection, prefix, concurrency: 1 });
  worker.on("error", (err) => hooks.log.error("maintenance.worker_error", { errorClass: err.name }));
  hooks.log.info("maintenance.scheduled", { jobs: jobs.map((j) => ({ name: j.name, everyMinutes: j.everyMs / 60_000 })) });
  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
