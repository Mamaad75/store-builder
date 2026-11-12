# Store Builder

Multi-tenant SaaS storefront builder (MVP). Next.js (App Router) + TypeScript + MUI (RTL, Persian) +
PostgreSQL/Prisma + S3-compatible storage + Auth.js. Modular monolith; stores are rendered by a shared
renderer, not one project per customer.

## Status
Phase 5 of 15 implemented (products and categories). The full roadmap is in `docs/roadmap.md` and every approved decision is recorded in `docs/decisions.md`.

## Development
```bash
pnpm install
cp .env.example .env.local
pnpm db:up        # PostgreSQL + MinIO (needs Docker)
pnpm db:migrate   # apply migrations (Prisma)
pnpm db:seed      # seed the 3 templates (idempotent)
pnpm dev          # http://localhost:3000  (stores: http://<name>.localhost:3000)
```

Checks: `pnpm check` (typecheck + lint + unit tests + DB tests). Browser E2E tests: `pnpm test:e2e` (builds the app and uses an isolated `storebuilder_e2e` database). `E2E_CPU_THROTTLE=6 pnpm test:e2e` slows the main page 6x to expose timing races (hydration, late rendering) like those seen on slow CI runners. Database tests: `pnpm test:db` (needs PostgreSQL; uses an isolated `storebuilder_test` database that it recreates).

Inspect the local database visually: `pnpm db:studio` (Prisma Studio at http://localhost:5555, local database only, loopback only). See `docs/local-database.md` (includes the DBeaver option for ER diagrams).

The platform root domain is configured with `APP_ROOT_DOMAIN` / `APP_PROTOCOL`.
Dev credentials in `docker-compose.yml` are for local use only.

## Authentication notes
- Auth.js v5 (beta) Credentials provider with JWT sessions (7 days). Passwords: Argon2id.
- `User.authVersion` is stored in the JWT and re-checked against the database whenever the session is read; `invalidateUserSessions(userId)` revokes all tokens of a user.
- `/dashboard/**` is guarded by `src/proxy.ts` (early redirect) **and** by `requireUser()` on the server.
- Rate limiting uses a `RateLimiter` interface; the default backend is shared PostgreSQL (`RATE_LIMIT_BACKEND=postgres`). A Redis backend can implement the same interface.
- Rate limiting keys on the client IP. Forwarding headers are ignored unless `TRUST_PROXY_HEADERS=true`; see `docs/deployment.md` for proxy requirements and the expired-bucket cleanup job (`pnpm db:cleanup`).
- Generate `AUTH_SECRET` with `openssl rand -base64 32`; never commit it.
