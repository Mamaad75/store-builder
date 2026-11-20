# Moving the whole backend out of Next.js (decision of 2026-11-19, working plan)

**Owner's instruction:** all business logic and all database access leave Next.js; the backend is Node.js + Express (NestJS stays, it runs on Express); PostgreSQL + Prisma stay. Done in one go, reported at the end.

## Target
* `packages/shared` (`@store-builder/shared`): framework-free code used by both sides (template definitions and data schemas, text/money/spec helpers, SEO builders, domain error classes, DTO types). Built with `tsc` to `dist` (`pnpm shared:build`).
* `apps/api` (NestJS): every domain module (stores, categories, products, media, pages, publishing, storefront), its REST controllers, the jobs (media cleanup, rate-limit cleanup, scheduler, alerts) and the only Prisma client.
* `apps/web` (Next.js): **UI only**: pages render data fetched from the API (`src/gateway/*`), Server Actions are thin relays (form → API call → redirect), no `@prisma/client`, no `src/modules`, no `DATABASE_URL`.

## Steps and status
1. [x] `packages/shared` created; template definitions, helpers, SEO builders and errors moved.
2. [x] API infrastructure for the domain (db handle, storage, logging, rate limiter, test helpers, shared error registry and DTO types with a compile-time conformance check).
3. [x] Domain modules moved into `apps/api/src/modules/*` with their DB tests (475 DB tests pass unchanged apart from import paths).
4. [x] REST controllers per area, error transport, raw-bytes uploads, public read endpoints; HTTP tests on real PostgreSQL.
5. [x] Web gateway (`apps/web/src/gateway`); pages, layouts, actions, preview and store-host routes switched; `src/modules/*`, Prisma, storage and the DB removed from web.
6. [x] Jobs (scheduler, cleanups, alerts) and the Prisma schema/migrations/seed moved to the API; compose, Dockerfile, CI, smoke script; E2E moved to `apps/e2e`.
7. [x] Architecture guards split between API, web and shared; docs.

## Decisions taken while doing it (flag any you disagree with)
* NestJS stays (it is Express underneath), as the owner answered.
* Server Actions remain as **thin relays** (form -> API call -> redirect/revalidate). They hold no logic and no database access, but they still run on the Next.js server.
  Moving the forms to call the API straight from the browser is a separate, later UI change (it needs the `/api/*` route in Caddy and client-side forms).
* Web <-> API payloads are JSON: dates are ISO strings (DTOs in `packages/shared/src/dto`).
* The `/api/*` Caddy route is still not published: only the web server reaches the API (internal network).
* Dormant code left in web on purpose: the SMTP mailer (unused since U1, still tested by `pnpm test:mail`).
