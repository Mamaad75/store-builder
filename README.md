# Store Builder

Multi-tenant SaaS storefront builder (MVP). Next.js (App Router) + TypeScript + MUI (RTL, Persian) +
PostgreSQL/Prisma + S3-compatible storage + a NestJS API for authentication (ADR 0001). Modular monolith; stores are rendered by a shared
renderer, not one project per customer.

## Status
Phases 1-12 are implemented and accepted; phase 13 (production readiness: containers, Caddy, backups, runbook) is implemented and reviewed (review fixes D13-12). The MVP code is complete: real SMTP mail (DM2-1) and the WCAG 2.2 AA audit with all findings fixed (`docs/audit-m3-accessibility.md`). Next is phase 14 (staging), which starts with `docs/phase14-checklist.md` and explicit approval. Nothing is deployed. Changes are listed in `CHANGELOG.md` (Persian). The full roadmap is in `docs/roadmap.md` and every approved decision is recorded in `docs/decisions.md`.

## Layout (ADR 0001, `docs/migration-plan.md`)
* `apps/web`: Next.js, **UI only** (pages, forms, storefront rendering). No database, no business logic: it calls the API (`src/gateway/*`).
* `apps/api`: NestJS on Node.js/Express: authentication, stores, catalog, pages, media, publishing, public read, jobs; the **only** owner of PostgreSQL
  (Prisma schema, migrations, seed in `apps/api/prisma`) and of object storage. See `docs/api.md`.
* `packages/shared`: framework-free code used by both (template definitions, data schemas, SEO builders, domain error classes, DTO types).
* `apps/e2e`: Playwright end-to-end and production-stack smoke tests.

## Development
Two processes (plus PostgreSQL and an S3-compatible server; a third, the worker, for background events):
```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
pnpm db:up          # PostgreSQL + MinIO + Valkey (needs Docker)
pnpm db:generate && pnpm db:deploy && pnpm db:seed   # Prisma client, migrations, templates (all in apps/api)
pnpm shared:build   # once, and again after changing packages/shared (`pnpm shared:dev` watches)
# terminal 1: the API on http://localhost:4000 (reads apps/api/.env, copy it from apps/api/.env.example)
pnpm api:dev
# terminal 2: the web app on http://localhost:3000  (stores: http://<name>.localhost:3000)
pnpm dev
# terminal 3 (optional): the worker = outbox relay + event consumers (docs/async.md); REDIS_URL defaults to redis://localhost:6379
pnpm worker
```
Without S3 settings the API still starts in development; uploads and `/api/ready` then report storage as unavailable.

**Developing from Iran:** Docker Hub answers 403 to Iranian networks, so `pnpm db:up` cannot pull its images directly. Add a domestic
registry mirror to the Docker daemon (Docker Desktop: Settings → Docker Engine), for example
`"registry-mirrors": ["https://docker.arvancloud.ir"]` (alternatives that answered in 2026-11: `docker.iranserver.com`, `registry.docker.ir`).
The npm registry, GitHub and `ghcr.io` were reachable directly. Line endings are pinned to LF by `.gitattributes`, so Windows checkouts work
with the shell scripts and the architecture tests.

Other local-machine notes:
* **Port 6379 already taken** (e.g. a local Redis): `VALKEY_HOST_PORT=16379 pnpm db:up`, then `REDIS_URL=redis://localhost:16379`.
* **Port 5432 already taken** (e.g. a native PostgreSQL service): `POSTGRES_HOST_PORT=15432 pnpm db:up`, then use port 15432 in
  `DATABASE_URL` and `E2E_DATABASE_URL`. On Windows avoid ports in the reserved ranges (`netsh interface ipv4 show excludedportrange protocol=tcp`).
* **Playwright's browser download CDN refuses Iranian networks.** Run the E2E suite on an installed browser instead:
  `E2E_BROWSER_CHANNEL=chrome pnpm test:e2e` (or `msedge`). CI keeps Playwright's own Chromium.
* **Known limit on Windows:** `scripts/run-standalone.sh` copies the standalone bundle with `cp -r`, which on Windows turns pnpm's
  symlinks into real folders, so the copied server cannot find the generated Prisma client (`.prisma/client/default`). The full E2E suite
  therefore runs on Linux (CI, or WSL); on Windows run the unit, DB and storage suites.
* The backup/restore DB tests need `pg_dump`/`pg_restore`/`psql` **of the same major version as the server (16)** on `PATH`; newer clients write
  settings (`transaction_timeout`) that a 16 server rejects.

Checks: `pnpm check` (typecheck + lint + unit tests + DB tests). Browser E2E tests: `pnpm test:e2e` (builds web and API and uses an isolated `storebuilder_e2e` database; needs an S3-compatible server on :9000). `E2E_CPU_THROTTLE=6 pnpm test:e2e` slows the main page 6x to expose timing races (hydration, late rendering) like those seen on slow CI runners. Database tests: `pnpm test:db` (API; needs PostgreSQL; uses an isolated `storebuilder_api_test` database that it recreates). Storage tests: `pnpm test:storage`. Queue tests (outbox relay, BullMQ, consumers on a real Valkey): `pnpm test:queue`.

Inspect the local database visually: `pnpm db:studio` (Prisma Studio at http://localhost:5555, local database only, loopback only). See `docs/local-database.md` (includes the DBeaver option for ER diagrams).

The platform root domain is configured with `APP_ROOT_DOMAIN` / `APP_PROTOCOL`.
Dev credentials in `docker-compose.yml` are for local use only.

## Authentication notes
- Authentication: NestJS API (`apps/api`), username + password, JWT session cookie (7 days). Passwords: Argon2id.
- `User.authVersion` is stored in the JWT and re-checked against the database whenever the session is read; `invalidateUserSessions(userId)` revokes all tokens of a user.
- `/dashboard/**` is guarded by `apps/web/src/proxy.ts` (early redirect) **and** by `requireUser()` on the server, which asks the API; every domain endpoint of the API is owner-scoped and refuses requests without a valid session.
- Rate limiting uses a `RateLimiter` interface; the default backend is shared PostgreSQL (`RATE_LIMIT_BACKEND=postgres`). A Redis backend can implement the same interface.
- Rate limiting keys on the client IP. Forwarding headers are ignored unless `TRUST_PROXY_HEADERS=true`; see `docs/deployment.md` for proxy requirements and the expired-bucket cleanup job (`pnpm db:cleanup`).
- Generate `AUTH_SECRET` (read only by the API, `apps/api`) with `openssl rand -base64 32`; never commit it.

## Production readiness (phase 13)
`Dockerfile` (runtime = web, api, jobs targets), `docker-compose.prod.yml`, `docker/caddy/` (custom Caddy), `scripts/backup.sh` / `restore.sh` / `apps/api/scripts/worker.ts` (queue: docs/async.md).
Operations: `docs/runbook.md`. Security controls: `docs/security.md`. CI builds the images and smoke-tests the whole stack; no Docker daemon is needed for the unit and DB tests.

