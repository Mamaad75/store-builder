# Observability: metrics, error tracking, request ids (phase 2.6)

ADR 0002 §2.12: structured logs (existed), **metrics** (Prometheus on the internal network), **error tracking** (self-hosted GlitchTip),
alerts (Bale, existed). Decision D26-1. Everything is optional and off by default; nothing here sends data to a foreign service.

## What exists

| Part | Where | On when |
|---|---|---|
| Request id | `apps/api/src/platform/observability/request-context.ts` | always |
| API metrics | `platform/observability/metrics.ts`, served on `METRICS_PORT` | `METRICS_PORT` set |
| Worker metrics | same module, served by the worker on its `METRICS_PORT` | `METRICS_PORT` set |
| Error reporter | `packages/shared/src/observability/error-report.ts` (API, worker, web) | `ERROR_TRACKING_DSN` set |
| Prometheus + alert rules | `docker-compose.observability.yml`, `docker/observability/` | file only (phase 4 deploys) |

### Request id
Every API response has `X-Request-Id`. In production Caddy **sets** it for every proxied request (`{http.request.uuid}`), so a client cannot
choose it (a forged id would mix an attacker's log lines with a victim's). Behind no proxy, an incoming id is kept only if it is 8–64
characters of `[A-Za-z0-9._-]`, otherwise a UUID is generated. Every log line written while the request is handled carries `requestId`, and its error report
carries the `request_id` tag.

### Metrics
Each process has its own registry, served as `GET /metrics` on a **separate port** (`METRICS_PORT`, 9464 in production). The port is never
published and Caddy never routes it; the public API port has no metrics endpoint. Inside the host, containers on the api's networks
(`backend`, `edge`, and with the overlay `metrics`) can reach it. Labels are closed sets: the matched **route template**
(`/api/stores/:storeId/products`, never the URL, ids or query; unknown URLs are `unmatched`), the method, the status class (`2xx`…), event
types known to the code (anything else is `other`) and maintenance job names. No store, user or request id is ever a label.

| Metric | Process | Meaning |
|---|---|---|
| `sb_http_requests_total{method,route,status}` | api | finished requests |
| `sb_http_request_duration_seconds{method,route}` | api | latency histogram |
| `sb_http_requests_in_flight` | api | concurrent requests |
| `sb_events_total{type,outcome}` | worker | domain events: `ok`, `failed` (will retry), `dead` (attempts used up) |
| `sb_outbox_pending` | worker | outbox rows not yet published (read at scrape time) |
| `sb_queue_jobs{state}` | worker | waiting / active / delayed / failed jobs of the event queue |
| `sb_outbox_relayed_total`, `sb_outbox_relay_failures_total` | worker | relay throughput and failed passes |
| `sb_maintenance_runs_total{job,result}` | worker | media/db cleanup runs (`ok`, `failed`, `timeout`, …) |
| `sb_error_reports_total{outcome}` | api, worker | captures: `sent`, `failed`, `rate_limited`, `duplicate` |
| `sb_process_*`, `sb_nodejs_*` | both | memory, CPU, event-loop lag, GC (prom-client defaults) |

### Error tracking
A small reporter of our own instead of the Sentry SDK (which instruments the process and attaches headers, bodies and breadcrumbs by
itself). It speaks the Sentry envelope protocol that GlitchTip ingests (`POST /api/<project>/envelope/`). An event contains only:
the error class; the message **scrubbed** (credentials in any URL, also with internal dot-less hosts such as
`postgresql://user:pw@postgres`, `password=`/`secret=`/`token=`/`api_key=` values, e-mails, phone/card-like digit runs incl. Persian
digits, JWTs, long tokens, `Bearer …`, URL queries and database ids removed; only the first 2000 characters are scanned, 300 kept); stack frames with paths cut to `apps/…`/`packages/…`/`node_modules/…`; and bounded
tags (service, route template, method, status, request id, job or event type). Never headers, cookies, bodies, query strings, user or
store ids, environment values. At most 30 events per minute per process; the same error at the same place is sent once a minute. Sending
never throws, never follows a redirect and does not wait for the network (5 s timeout); the synchronous work per capture is bounded.

What is reported:
* **API:** unexpected errors only (a non-HTTP exception that became a 500). Deliberate answers (4xx, a thrown 503, domain errors) are not
  bugs and are not reported. Uncaught exceptions and unhandled rejections are logged, reported and then still crash the process (Node's
  default), after waiting at most 2 s for the report.
* **Worker:** an event that used up its delivery attempts, a failed relay pass, a maintenance run that did not end `ok`, and process crashes.
* **Web:** server-side render and route-handler errors (Next `onRequestError`), with the route template (`/store-host/[label]/[[...path]]`)
  and method; Next's navigation signals (`notFound`, `redirect`) are not errors.

## Configuration

| Variable | Process | Default | Notes |
|---|---|---|---|
| `METRICS_PORT` | api, worker | unset = off | must differ from `API_PORT` |
| `METRICS_HOST` | api, worker | `0.0.0.0` in production, `127.0.0.1` in development | |
| `ERROR_TRACKING_DSN` | api, worker, web | unset = off | `https://<key>@<glitchtip host>/<project id>`; plain http only for a loopback host. Treat as a secret: never logged |
| `ERROR_TRACKING_ENVIRONMENT` | api, worker, web | `production` / `development` | letters, digits, `-`, `_` |
| `APP_RELEASE` | api, worker, web | unset | e.g. the git commit; shown per event |

A value that is set but invalid **refuses to start** (names the variable, never the value), so a typo never silently turns monitoring off.
The production compose sets `METRICS_PORT=9464` for api and worker and passes the three error-tracking variables (empty = off).
**Owner action:** add empty `ERROR_TRACKING_DSN=`, `ERROR_TRACKING_ENVIRONMENT=production` and `APP_RELEASE=` lines to
`.env.production.example` (Claude may not read or write that file).

## Prometheus (file only)

```
docker compose -f docker-compose.prod.yml -f docker-compose.observability.yml --env-file .env.production up -d
```

Prometheus v3.15.1 (pinned by digest) scrapes `api:9464` and `worker:9464` over its own internal `metrics` network (it is not on
`backend`, so it cannot reach PostgreSQL or Valkey), keeps 30 days (max 5 GB), and publishes its UI
on the host loopback only (`127.0.0.1:9090`: use an SSH tunnel). `docker/observability/alerts.yml` holds 7 rules (target down, 5xx ratio
> 2 %, p95 > 1 s, outbox backlog, dead events, failing maintenance, error reports not delivered), checked with `promtool check rules`.
**Delivering these alerts to Bale** (Alertmanager or a small relay) is a phase-4 (staging) task; until then the worker's Bale alerts stay.

## GlitchTip (not installed by this repository)

GlitchTip is self-hosted (it needs its own PostgreSQL and Valkey/Redis), ideally on its own small server at the Iranian provider. Its
compose file is **not** included: the official install guide could not be read from this environment (glitchtip.com is not reachable),
and an unverified file would be worse than none. Install it in phase 4 from the official guide (the Arvan mirror has `glitchtip/glitchtip`
v5.2.1 and v6.0.3), create one project per service or one shared project, and put its DSN into `ERROR_TRACKING_DSN`. Then send one test
error per service and check the event in GlitchTip: the envelope format is the documented Sentry one but has **not yet been verified
against a real GlitchTip**.

## Local development

```
METRICS_PORT=9464 pnpm --filter @store-builder/api dev     # then: curl http://127.0.0.1:9464/metrics
```
To try Prometheus locally against it, run the API with `METRICS_HOST=0.0.0.0` and point a Prometheus container at
`host.docker.internal:9464` (verified on 2026-11-22: `up = 1`, route-template labels only).

## Security review (2026-11-22)
Independent review of this phase: no Critical or High findings. Fixed, each with a test or a validated config: Prometheus pinned by digest
and moved off `backend` to its own internal network (Medium); credentials in dot-less connection URLs and `key=value` secrets scrubbed;
scrubbing and stack parsing bounded before any pattern runs; Caddy sets `X-Request-Id` (all Low); the worker's
`sb_error_reports_total` connected (it was always zero); `redirect: "error"` on sends; `node:` frames marked as not in-app.
Remaining by design: the metrics port listens on the container's interfaces, so a compromised container on the same internal networks
could read metrics (counts and route templates only); crash logs carry the error class only (the stack goes to GlitchTip when configured).
