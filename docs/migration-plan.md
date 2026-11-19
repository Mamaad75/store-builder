# Moving the whole backend out of Next.js (decision of 2026-11-19, working plan)

**Owner's instruction:** all business logic and all database access leave Next.js; the backend is Node.js + Express (NestJS stays, it runs on Express); PostgreSQL + Prisma stay. Done in one go, reported at the end.

## Target
* `packages/shared` (`@store-builder/shared`): framework-free code used by both sides (template definitions and data schemas, text/money/spec helpers, SEO builders, domain error classes, DTO types). Built with `tsc` to `dist` (`pnpm shared:build`).
* `apps/api` (NestJS): every domain module (stores, categories, products, media, pages, publishing, storefront), its REST controllers, the jobs (media cleanup, rate-limit cleanup, scheduler, alerts) and the only Prisma client.
* `apps/web` (Next.js): **UI only**: pages render data fetched from the API (`src/gateway/*`), Server Actions are thin relays (form → API call → redirect), no `@prisma/client`, no `src/modules`, no `DATABASE_URL`.

## Steps and status
1. [x] `packages/shared` created; template definitions, helpers and SEO builders moved (imports rewritten).
2. [ ] API infrastructure for the domain (db singleton, storage, logging, rate limiter, test helpers, shared errors).
3. [ ] Domain modules moved into `apps/api/src/modules/*` with their DB tests.
4. [ ] Controllers + error mapping per module (stores/categories/products, then pages/media, then publishing/storefront/public read).
5. [ ] Web gateway; pages, layouts, actions, preview and store-host routes switched to it; modules and Prisma removed from web.
6. [ ] Jobs moved to the API; compose, Dockerfile, Caddy, CI, runbook.
7. [ ] Architecture guards rewritten for the new layout; full test suites and E2E green.
