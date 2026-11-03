# Store Builder

Multi-tenant SaaS storefront builder (MVP). Next.js (App Router) + TypeScript + MUI (RTL, Persian) +
PostgreSQL/Prisma + S3-compatible storage + Auth.js. Modular monolith; stores are rendered by a shared
renderer, not one project per customer.

## Status
Step 2 of 12 (database schema, migrations, template seed). See the implementation plan in the project discussion.

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
