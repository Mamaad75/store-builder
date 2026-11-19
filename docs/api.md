# API (NestJS) — `apps/api`

Step N2 of ADR 0001: the skeleton of the separate backend. It has **no business endpoints yet**; those arrive in N3–N6 (auth, stores, pages, media).

## Run locally
```bash
pnpm db:up && pnpm db:generate          # PostgreSQL and the Prisma client (generated from apps/web/prisma/schema.prisma)
DATABASE_URL=postgresql://storebuilder:storebuilder@localhost:5432/storebuilder NODE_ENV=development pnpm api:dev   # http://localhost:4000
curl localhost:4000/api/health ; curl localhost:4000/api/ready
```
Scripts (root): `api:dev`, `api:build`, `api:start`, `api:lint`, `api:typecheck`, `api:test`. The integration test needs `DATABASE_URL` (always set in CI; skipped locally without it).

## Configuration (`src/config/env.ts`, the only file that reads the environment)
| Variable | Meaning |
|---|---|
| `DATABASE_URL` | required, `postgresql://…` |
| `APP_ROOT_DOMAIN`, `APP_PROTOCOL` | the platform's public origin (required in production; defaults to `localhost:3000`/`http` in development only) |
| `TRUST_PROXY_HOPS` | reverse-proxy hops in front of the API (must be ≥ 1 in production) |
| `API_HOST` / `API_PORT` | bind address (default `0.0.0.0`) / port (default 4000) |
| `API_BODY_LIMIT_BYTES` | JSON body limit (default 1 MiB) |

Same rule as the web app: any `NODE_ENV` other than `development`/`test` refuses to start (`startup.refused`, exit 1) unless the configuration is complete and safe. Errors name variables, never values.

## What N2 provides
* **Logging:** one JSON line per event (`src/logging/json-logger.ts`), sensitive keys redacted, errors reduced to their class name; the only place that may use `console`.
* **Health:** `GET /api/health` (liveness) and `GET /api/ready` (database within 2 s; one shared probe, cached 2 s; `503` body names only `database`).
* **Headers:** helmet with a deny-all CSP (`default-src 'none'`, no framing), `no-referrer`, HSTS in production, no `X-Powered-By`.
* **CSRF guard** (`OriginGuard`, global): every non-GET/HEAD/OPTIONS request needs an `Origin` equal to one of the platform's origins; a missing, `null` or foreign Origin, or `Sec-Fetch-Site: cross-site`, gets 403.
* **Errors:** every error leaves as `{statusCode, error}` with fixed text per status (never the exception message or stack).
* **Database:** a lazy Prisma client behind a small `Database` interface (only `database/database.ts` imports it). The schema and migrations stay in `apps/web/prisma` until the web app no longer needs them.
* **Image:** `docker build --target api .` — compiled JS and production dependencies only, non-root, health check. CI builds it and boots it against a throw-away PostgreSQL (`scripts/ci-api-image-check.sh`).

## Conventions
Native ESM (`"type": "module"`, `.js` suffixes in relative imports), explicit `@Inject(token)` (no reliance on emitted decorator metadata), architecture tests in `src/__tests__/architecture.test.ts` (env, console and Prisma access are confined to their files).

## Not in N2
Authentication/sessions (N3), domain endpoints (N4–N6), rate limiting, CORS for a separate API origin, reverse-proxy routing of `/api` to this service and its compose service (they come with the first real endpoint, so nothing is exposed that does nothing).
