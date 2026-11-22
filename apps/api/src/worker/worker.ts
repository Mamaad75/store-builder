import type { Server } from "node:http";
import { NO_REPORTER, type ErrorReporter } from "@store-builder/shared/observability/error-report";
import type { Notifier } from "../lib/alert.js";
import { log } from "../lib/log.js";
import { createWorkerMetrics, startMetricsServer, type ReportOutcome } from "../platform/observability/metrics.js";
import { countPendingOutbox, PrismaOutboxStore } from "../platform/outbox/prisma-outbox.store.js";
import { RELAY_DEFAULTS, relayOnce, type OutboxStore } from "../platform/outbox/relay.js";
import { startMaintenance, type ScheduledJob } from "../platform/queue/maintenance-queue.js";
import { BullMqEventPublisher, createEventQueue, createRedisConnection, startEventWorker, type DeliveryPolicy, type EventHandler } from "../platform/queue/event-queue.js";

export interface RunningWorker {
  /** Stops polling, lets in-flight jobs finish, closes the queue connections. */
  stop(): Promise<void>;
}

/** A maintenance run that did not end "ok" (reported to error tracking; the run's own logs and alerts already happened). */
export class MaintenanceJobFailed extends Error {
  constructor(result: string) {
    super(`maintenance job ended with result ${result}`);
    this.name = "MaintenanceJobFailed";
  }
}

export interface WorkerOptions {
  redisUrl: string;
  handlers: Readonly<Record<string, EventHandler>>;
  alert: Notifier;
  store?: OutboxStore;
  idlePollMs?: number;
  /** Test seams: an isolated key prefix and a faster retry policy. */
  prefix?: string;
  delivery?: DeliveryPolicy;
  /**
   * Periodic jobs (BullMQ Job Schedulers, no overlap across processes). `run` reports its own failures and may return the run's result
   * class ("ok", "failed", "timeout", ...), which the metrics count.
   */
  maintenance?: { jobs: readonly ScheduledJob[]; run: (name: string) => Promise<string | void> };
  /** Phase 2.6: the worker's own metrics endpoint (null/absent = off) and error reporter (absent = off). */
  metrics?: { port: number; host: string } | null;
  reporter?: ErrorReporter;
  /**
   * The reporter is made before the worker (the crash handlers need it first), so its outcome counter is connected afterwards: called
   * once with the counter of `sb_error_reports_total` when metrics are on.
   */
  bindReportOutcome?: (count: (outcome: ReportOutcome) => void) => void;
  /** Test seam for the `sb_outbox_pending` gauge. */
  outboxPending?: () => Promise<number>;
}

/**
 * The worker process (phase 2.2): the outbox relay loop, the domain-event consumers and (2.2b) the periodic maintenance jobs. The database handle (`useDb`) must be set
 * by the caller. One relay loop per process; several processes are safe (claims use SKIP LOCKED and leases).
 */
export async function startWorker(o: WorkerOptions): Promise<RunningWorker> {
  const reporter = o.reporter ?? NO_REPORTER;
  const connection = createRedisConnection(o.redisUrl);
  const queue = createEventQueue(connection, o.prefix);
  const m = o.metrics
    ? createWorkerMetrics({
        outboxPending: o.outboxPending ?? countPendingOutbox,
        queueJobs: () => queue.getJobCounts("waiting", "active", "delayed", "failed"),
        eventTypes: Object.keys(o.handlers),
      })
    : null;
  if (m) o.bindReportOutcome?.(m.onReport);
  const deps = { store: o.store ?? new PrismaOutboxStore(), publisher: new BullMqEventPublisher(queue, o.delivery), log, alert: o.alert };
  const consumer = startEventWorker(
    connection,
    o.handlers,
    {
      log,
      onFinalFailure: (fields) => o.alert("event.dead", fields),
      onOutcome: (type, outcome) => m?.event(type, outcome),
      onDeadError: (err, tags) => reporter.capture(err, tags),
    },
    { prefix: o.prefix },
  );

  const runMaintenance = async (name: string) => {
    let result: string;
    try {
      result = (await o.maintenance!.run(name)) ?? "ok";
    } catch (e) {
      m?.maintenance.inc({ job: name.slice(0, 40), result: "error" });
      reporter.capture(e, { job: name.slice(0, 40) });
      throw e;
    }
    m?.maintenance.inc({ job: name.slice(0, 40), result });
    if (result !== "ok") reporter.capture(new MaintenanceJobFailed(result), { job: name.slice(0, 40) });
  };
  const maintenance = o.maintenance ? await startMaintenance(connection, o.maintenance.jobs, runMaintenance, { log }, o.prefix) : null;

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<unknown> = Promise.resolve();
  const loop = async () => {
    if (stopping) return;
    let full = false;
    try {
      const r = await relayOnce(deps);
      m?.relayClaimed.inc(r.claimed);
      full = r.claimed === RELAY_DEFAULTS.batchSize;
    } catch (e) {
      // A failed claim (database down) is retried on the next tick; class only, never the message.
      log.error("outbox.relay_failed", { errorClass: e instanceof Error ? e.name : "UnknownError" });
      m?.relayFailures.inc();
      reporter.capture(e, { job: "outbox.relay" });
    }
    if (!stopping) timer = setTimeout(() => (current = loop()), full ? 0 : (o.idlePollMs ?? RELAY_DEFAULTS.idlePollMs));
  };
  current = loop();

  let metricsServer: Server | null = null;
  if (m && o.metrics) {
    metricsServer = await startMetricsServer(m.registry, o.metrics.port, o.metrics.host, log);
    log.info("metrics.listening", { port: o.metrics.port });
  }
  log.info("worker.start", { queues: [queue.name], handlers: Object.keys(o.handlers) });

  return {
    async stop() {
      stopping = true;
      if (timer) clearTimeout(timer);
      await current;
      await maintenance?.close();
      await consumer.close();
      await queue.close();
      connection.disconnect();
      await new Promise<void>((resolve) => (metricsServer ? metricsServer.close(() => resolve()) : resolve()));
      await reporter.flush(2000);
      log.info("worker.stop");
    },
  };
}
