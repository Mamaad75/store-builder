# Store Builder

Multi-tenant SaaS storefront builder (MVP). Next.js (App Router) + TypeScript + MUI (RTL, Persian) +
PostgreSQL/Prisma + S3-compatible storage + Auth.js. Modular monolith; stores are rendered by a shared
renderer, not one project per customer.

## Status
Step 1 of 12 (project skeleton). See the implementation plan in the project discussion.

## Development
```bash
pnpm install
cp .env.example .env.local
pnpm db:up        # PostgreSQL + MinIO (needs Docker)
pnpm dev          # http://localhost:3000  (stores: http://<name>.localhost:3000)
```

Checks: `pnpm check` (typecheck + lint + tests).

The platform root domain is configured with `APP_ROOT_DOMAIN` / `APP_PROTOCOL`.
Dev credentials in `docker-compose.yml` are for local use only.
