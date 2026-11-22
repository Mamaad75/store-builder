import { createServer, type Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrics (phase 2.6, ADR 0002 §2.12). Each process owns its registry and serves it on a SEPARATE port (METRICS_PORT) that the
 * reverse proxy never routes, so metrics are reachable only on the internal network. Labels are bounded by construction: HTTP routes
 * are the matched route TEMPLATE (never the URL with ids or a query), methods and status classes are closed sets, event types and job
 * names come from code. No store, user or request identifier is ever a label.
 */
export const PREFIX = "sb_";
export type ReportOutcome = "sent" | "failed" | "rate_limited" | "duplicate";

function base(service: "api" | "worker") {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry, prefix: PREFIX });
  const errorReports = new Counter({ name: `${PREFIX}error_reports_total`, help: "Error-tracking captures by outcome.", labelNames: ["outcome"], registers: [registry] });
  return { registry, errorReports, onReport: (outcome: ReportOutcome) => errorReports.inc({ outcome }) };
}

export function createApiMetrics() {
  const b = base("api");
  return {
    ...b,
    httpRequests: new Counter({ name: `${PREFIX}http_requests_total`, help: "Finished HTTP requests.", labelNames: ["method", "route", "status"], registers: [b.registry] }),
    httpDuration: new Histogram({
      name: `${PREFIX}http_request_duration_seconds`,
      help: "HTTP request duration.",
      labelNames: ["method", "route"],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [b.registry],
    }),
    inFlight: new Gauge({ name: `${PREFIX}http_requests_in_flight`, help: "HTTP requests being handled.", registers: [b.registry] }),
  };
}
export type ApiMetrics = ReturnType<typeof createApiMetrics>;

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** The matched route template ("/api/stores/:storeId/products"), or "unmatched" (404, or refused before routing). */
export function routeLabel(req: Pick<Request, "baseUrl"> & { route?: { path?: unknown } }): string {
  const path = req.route?.path;
  // No route, or the framework's catch-all ("/api*path", which answers 404): one label for every unknown URL.
  if (typeof path !== "string" || path.includes("*")) return "unmatched";
  return `${req.baseUrl ?? ""}${path}`.slice(0, 120) || "/";
}

export function httpMetricsMiddleware(m: ApiMetrics) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const stop = m.httpDuration.startTimer();
    m.inFlight.inc();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      m.inFlight.dec();
      const labels = { method: METHODS.has(req.method) ? req.method : "OTHER", route: routeLabel(req) };
      stop(labels);
      m.httpRequests.inc({ ...labels, status: `${Math.floor(res.statusCode / 100)}xx` });
    };
    res.on("finish", finish);
    res.on("close", finish); // client went away before the response finished
    next();
  };
}

export function createWorkerMetrics(o: { outboxPending: () => Promise<number>; queueJobs: () => Promise<Record<string, number>>; eventTypes: readonly string[] }) {
  const b = base("worker");
  const known = new Set(o.eventTypes);
  const events = new Counter({ name: `${PREFIX}events_total`, help: "Domain events handled by the worker, by outcome.", labelNames: ["type", "outcome"], registers: [b.registry] });
  new Gauge({
    name: `${PREFIX}outbox_pending`,
    help: "Outbox events not yet published to the queue.",
    registers: [b.registry],
    async collect() {
      this.set(await o.outboxPending());
    },
  });
  new Gauge({
    name: `${PREFIX}queue_jobs`,
    help: "Jobs of the domain-event queue by state.",
    labelNames: ["state"],
    registers: [b.registry],
    async collect() {
      for (const [state, n] of Object.entries(await o.queueJobs())) this.set({ state }, n);
    },
  });
  return {
    ...b,
    /** Event type label: a type the code knows, or "other" (the queue is internal, but a label set must stay closed). */
    event: (type: string, outcome: "ok" | "failed" | "dead") => events.inc({ type: known.has(type) ? type : "other", outcome }),
    relayClaimed: new Counter({ name: `${PREFIX}outbox_relayed_total`, help: "Outbox events claimed by the relay.", registers: [b.registry] }),
    relayFailures: new Counter({ name: `${PREFIX}outbox_relay_failures_total`, help: "Relay passes that failed (database unreachable, ...).", registers: [b.registry] }),
    maintenance: new Counter({ name: `${PREFIX}maintenance_runs_total`, help: "Maintenance job runs by result.", labelNames: ["job", "result"], registers: [b.registry] }),
  };
}
export type WorkerMetrics = ReturnType<typeof createWorkerMetrics>;

/** Serves GET /metrics of one registry; everything else is 404. Errors answer 500 without details. */
export function startMetricsServer(registry: Registry, port: number, host: string, log: { error(event: string, fields?: Record<string, unknown>): void }): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || (req.url ?? "").split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    registry
      .metrics()
      .then((body) => res.writeHead(200, { "content-type": registry.contentType, "cache-control": "no-store" }).end(body))
      .catch((e: unknown) => {
        log.error("metrics.collect_failed", { errorClass: e instanceof Error ? e.name : "UnknownError" });
        res.writeHead(500).end();
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
