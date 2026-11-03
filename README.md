# Store Builder

Multi-tenant SaaS storefront builder (MVP). Next.js (App Router) + TypeScript + MUI (RTL, Persian) +
PostgreSQL/Prisma + S3-compatible storage + Auth.js. Modular monolith; stores are rendered by a shared
renderer, not one project per customer.

## Status
Step 3 of 12 (authentication: Auth.js credentials + JWT, Argon2id, rate limiting). See the implementation plan in the project discussion.

## Development
```bash
pnpm install
cp .env.example .env.local
pnpm db:up        # PostgreSQL + MinIO (needs Docker)
pnpm db:migrate   # apply migrations (Prisma)
pnpm db:seed      # seed the 3 templates (idempotent)
pnpm dev          # http://localhost:3000  (stores: http://<name>.localhost:3000)
```

Checks: `pnpm check` (typecheck + lint + unit tests). Database tests: `pnpm test:db` (needs PostgreSQL; uses an isolated `storebuilder_test` database that it recreates).

The platform root domain is configured with `APP_ROOT_DOMAIN` / `APP_PROTOCOL`.
Dev credentials in `docker-compose.yml` are for local use only.

## Authentication notes
- Auth.js v5 (beta) Credentials provider with JWT sessions (7 days). Passwords: Argon2id.
- `User.authVersion` is stored in the JWT and re-checked against the database whenever the session is read; `invalidateUserSessions(userId)` revokes all tokens of a user.
- `/dashboard/**` is guarded by `src/proxy.ts` (early redirect) **and** by `requireUser()` on the server.
- Rate limiting uses a `RateLimiter` interface; the default backend is shared PostgreSQL (`RATE_LIMIT_BACKEND=postgres`). A Redis backend can implement the same interface.
- Rate limiting keys on the client IP taken from `X-Forwarded-For`: deploy behind a proxy that overwrites this header.
- Generate `AUTH_SECRET` with `openssl rand -base64 32`; never commit it.
