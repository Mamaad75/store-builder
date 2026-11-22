import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorReporter, Tags } from "@store-builder/shared/observability/error-report";
import { createApp } from "../app.js";
import { EnvError, loadConfig, loadWorkerConfig } from "../config/env.js";
import { createApiMetrics, createWorkerMetrics, startMetricsServer } from "../platform/observability/metrics.js";
import { capture, fakeDb, FETCH_BLOCKED_PORTS, listenFetchable, testConfig } from "./helpers.js";

@Controller("obs")
class BoomController {
  @Get("bug/:id")
  bug() {
    throw new TypeError("unexpected for user ali@example.com");
  }
  @Get("busy")
  busy() {
    throw new ServiceUnavailableException(); // a deliberate answer, not a bug
  }
}

let app: NestExpressApplication | undefined;
let server: Server | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

function fakeReporter() {
  const captured: { error: unknown; tags: Tags }[] = [];
  const reporter: ErrorReporter = { capture: (error, tags = {}) => void captured.push({ error, tags }), flush: async () => {} };
  return { reporter, captured };
}

async function boot() {
  const cap = capture();
  const metrics = createApiMetrics();
  const rep = fakeReporter();
  const started = await listenFetchable(() => createApp(testConfig, { database: fakeDb(), logger: cap.logger, extraControllers: [BoomController], metrics, errorReporter: rep.reporter }));
  app = started.app;
  const url = started.base;
  do {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = await startMetricsServer(metrics.registry, 0, "127.0.0.1", { error: () => undefined });
  } while (FETCH_BLOCKED_PORTS.has((server.address() as AddressInfo).port));
  const metricsUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/metrics`;
  return { url, metricsUrl, cap, rep };
}

describe("request id (phase 2.6)", () => {
  it("every response carries one; a safe incoming id is kept, anything else is replaced", async () => {
    const { url } = await boot();
    const fresh = await fetch(`${url}/api/health`);
    expect(fresh.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const kept = await fetch(`${url}/api/health`, { headers: { "x-request-id": "edge-1234abcd" } });
    expect(kept.headers.get("x-request-id")).toBe("edge-1234abcd");
    for (const bad of ["short", "has space here", "x".repeat(65), "a\"b\\c{}0123"]) {
      const r = await fetch(`${url}/api/health`, { headers: { "x-request-id": bad } });
      expect(r.headers.get("x-request-id"), bad).not.toBe(bad);
    }
  });

  it("log lines written while handling a request carry its id", async () => {
    const { url, cap } = await boot();
    const r = await fetch(`${url}/api/obs/bug/42`, { headers: { "x-request-id": "trace-abcdef12" } });
    expect(r.status).toBe(500);
    const line = cap.lines.map((l) => JSON.parse(l)).find((l) => l.event === "api.error");
    expect(line).toMatchObject({ requestId: "trace-abcdef12", statusCode: 500, errorClass: "TypeError" });
  });
});

describe("error tracking (phase 2.6)", () => {
  it("an unexpected error is reported with the route TEMPLATE, method, status and request id; the answer stays generic", async () => {
    const { url, rep } = await boot();
    const r = await fetch(`${url}/api/obs/bug/cmwq4zcmb003snknwtyf6sq7o?token=abc`, { headers: { "x-request-id": "trace-abcdef12" } });
    expect(await r.json()).toEqual({ statusCode: 500, error: "Internal Server Error" });
    expect(rep.captured).toHaveLength(1);
    expect(rep.captured[0]!.error).toBeInstanceOf(TypeError);
    expect(rep.captured[0]!.tags).toEqual({ route: "/api/obs/bug/:id", method: "GET", request_id: "trace-abcdef12", status: "500" });
    expect(JSON.stringify(rep.captured[0]!.tags)).not.toMatch(/cmwq4z|token/);
  });

  it("deliberate HTTP answers (503, 404, 401) and domain errors are not reported", async () => {
    const { url, rep } = await boot();
    for (const path of ["/api/obs/busy", "/api/no-such-route", "/api/stores"]) await fetch(`${url}${path}`);
    expect(rep.captured).toEqual([]);
  });
});

describe("metrics (phase 2.6)", () => {
  it("count requests by route template, method and status class; no ids, no query, nothing unbounded", async () => {
    const { url, metricsUrl } = await boot();
    await fetch(`${url}/api/health`);
    await fetch(`${url}/api/obs/bug/cmwq4zcmb003snknwtyf6sq7o?x=1`);
    await fetch(`${url}/api/obs/bug/another-id`);
    await fetch(`${url}/api/does/not/exist/123`);
    const r = await fetch(metricsUrl);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/plain");
    const body = await r.text();
    expect(body).toContain('sb_http_requests_total{method="GET",route="/api/health",status="2xx",service="api"} 1');
    expect(body).toContain('sb_http_requests_total{method="GET",route="/api/obs/bug/:id",status="5xx",service="api"} 2');
    expect(body).toContain('sb_http_requests_total{method="GET",route="unmatched",status="4xx",service="api"} 1');
    expect(body).toContain("sb_http_request_duration_seconds_bucket");
    expect(body).toContain("sb_process_resident_memory_bytes");
    for (const leak of ["cmwq4z", "another-id", "x=1", "/123"]) expect(body, leak).not.toContain(leak);
  });

  it("the metrics port serves only GET /metrics, and the public API port does not serve metrics at all", async () => {
    const { url, metricsUrl } = await boot();
    expect((await fetch(metricsUrl.replace("/metrics", "/"))).status).toBe(404);
    expect((await fetch(metricsUrl, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${url}/api/metrics`)).status).toBe(404);
    expect((await fetch(`${url}/metrics`)).status).toBe(404);
  });

  it("worker metrics: closed event-type labels, gauges read on scrape", async () => {
    const m = createWorkerMetrics({ outboxPending: async () => 7, queueJobs: async () => ({ waiting: 2, failed: 1 }), eventTypes: ["store.published"] });
    m.event("store.published", "ok");
    m.event("attacker.made.this.up", "dead");
    m.maintenance.inc({ job: "media-cleanup", result: "ok" });
    const body = await m.registry.metrics();
    expect(body).toContain('sb_events_total{type="store.published",outcome="ok",service="worker"} 1');
    expect(body).toContain('sb_events_total{type="other",outcome="dead",service="worker"} 1');
    expect(body).not.toContain("attacker");
    expect(body).toContain('sb_outbox_pending{service="worker"} 7');
    expect(body).toContain('sb_queue_jobs{state="waiting",service="worker"} 2');
  });
});

describe("configuration (phase 2.6)", () => {
  const env = { NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@h:5432/d" };
  const KEY = "0123456789abcdef0123456789abcdef";
  it("everything is off when the variables are empty", () => {
    expect(loadConfig(env).observability).toEqual({ metrics: null, errorTracking: null });
    expect(loadWorkerConfig({ ...env, REDIS_URL: "redis://localhost:6379" }).observability).toEqual({ metrics: null, errorTracking: null });
  });
  it("valid values switch them on; a development metrics port listens on this machine only", () => {
    const o = loadConfig({ ...env, METRICS_PORT: "9464", ERROR_TRACKING_DSN: `https://${KEY}@errors.example.ir/3`, APP_RELEASE: "2.6.0" }).observability;
    expect(o.metrics).toEqual({ port: 9464, host: "127.0.0.1" });
    expect(o.errorTracking).toEqual({ dsn: { endpoint: "https://errors.example.ir/api/3/envelope/", publicKey: KEY }, environment: "development", release: "2.6.0" });
  });
  it("a value that is set but invalid refuses to start, naming the variable and never echoing the DSN", () => {
    for (const bad of [{ METRICS_PORT: "4000" }, { METRICS_PORT: "abc" }, { ERROR_TRACKING_DSN: `http://${KEY}@errors.example.ir/3` }, { ERROR_TRACKING_DSN: "x", ERROR_TRACKING_ENVIRONMENT: "prod uction" }, { ERROR_TRACKING_DSN: `https://${KEY}@e.ir/3`, APP_RELEASE: "v 1" }]) {
      const e = (() => {
        try {
          loadConfig({ ...env, ...bad });
        } catch (x) {
          return x;
        }
      })();
      expect(e, JSON.stringify(bad)).toBeInstanceOf(EnvError);
      expect(JSON.stringify((e as EnvError).problems)).not.toContain(KEY);
    }
  });
});
