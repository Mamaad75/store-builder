# API (NestJS) — `apps/api`

> Since the migration of 2026-11-19 (`docs/migration-plan.md`) the API owns **all** business logic and data access; Next.js (`apps/web`) is UI only.

Steps N2–N3 of ADR 0001: the separate backend. It serves authentication (N3); stores, catalog, pages and media arrive in N4–N6.

## Run locally
```bash
pnpm db:up && pnpm db:generate          # PostgreSQL and the Prisma client (generated from apps/web/prisma/schema.prisma)
DATABASE_URL=postgresql://storebuilder:storebuilder@localhost:5432/storebuilder NODE_ENV=development pnpm api:dev   # http://localhost:4000
curl localhost:4000/api/health ; curl localhost:4000/api/ready
```
Scripts (root): `api:dev`, `api:build`, `api:start`, `api:lint`, `api:typecheck`, `api:test` (no database needed), `api:test:db` (creates and migrates the isolated `storebuilder_api_test` database on the server `DATABASE_URL` points to). For the web app to sign anyone in, the API must be running (`INTERNAL_API_URL`, default `http://127.0.0.1:4000`).

## Configuration (`src/config/env.ts`, the only file that reads the environment)
| Variable | Meaning |
|---|---|
| `DATABASE_URL` | required, `postgresql://…` |
| `APP_ROOT_DOMAIN`, `APP_PROTOCOL` | the platform's public origin (required in production; defaults to `localhost:3000`/`http` in development only) |
| `TRUST_PROXY_HOPS` | reverse-proxy hops in front of the API (must be ≥ 1 in production) |
| `API_HOST` / `API_PORT` | bind address (default `0.0.0.0`) / port (default 4000) |
| `API_BODY_LIMIT_BYTES` | JSON body limit (default 1 MiB) |
| `AUTH_SECRET` | signs session tokens: ≥ 32 characters, not a placeholder (required in production; a fixed development default exists for `development`/`test` only) |

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

## Authentication (N3)
All under `/api/auth`, JSON, always `Cache-Control: no-store`, every state-changing call needs the platform `Origin` (OriginGuard).

| Route | Result |
|---|---|
| `POST register` `{name, username, password}` | 201; 400 `invalid` (+`fieldErrors`); 409 `username_taken`; 429 `rate_limited` (+`Retry-After`) |
| `POST login` `{username, password}` | 200 `{user}` + session cookie; 401 `invalid_credentials` (one outcome for unknown name, wrong password, malformed input); 429 |
| `POST logout` | 204, cookie cleared |
| `GET me` | 200 `{user:{id,username,name}}`; 401 |
| `POST change-password` `{currentPassword,newPassword}` | 204 and every session ends (authVersion bump); 400 `invalid` / `wrong_password`; 429 |
| `POST logout-all` | 204, every issued token revoked, password untouched |

* **Token:** HS256 JWT (`sub` = user id, `av` = authVersion; issuer and audience pinned, algorithm pinned, 7 days) in a `httpOnly`, `SameSite=Lax`, `Path=/`, no-`Domain` cookie named `__Host-sb_session` (`Secure`) over https and `sb_session` over loopback http. `GET me` and the `SessionGuard` accept a token only while the user exists and `authVersion` still matches, so one increment revokes every token.
* **Same rules as before:** Argon2id (m=19 MiB, t=2, p=1), normalised usernames (see `docs/accounts.md`), taken names reported at registration, non-enumerating login that also pays one hash for unknown names, rate limits per IP (login 30/15 min, register 5/h) and per username (10/15 min) and per user (password change 10/15 min), kept in the same `RateLimitBucket` table.
* **Client IP:** `req.ip` with `TRUST_PROXY_HOPS` hops counted from the right, so a spoofed `X-Forwarded-For` entry cannot choose the bucket.
* **Web app (BFF):** the browser never calls the API in N3. Server actions and `auth()` call it over `INTERNAL_API_URL` (`apps/web/src/lib/api-client.ts`), forward the session cookie and one trusted client IP, and copy back only the session cookie from `Set-Cookie`. `proxy.ts` only checks that a session cookie exists (a convenience redirect); real authorisation is `requireUser()` → API.
* **Behaviour changes to know:** everyone is signed out once at the switch (the old Auth.js cookie is not understood); a revoked or expired cookie stays in the browser until replaced or it expires, but every request carrying it is treated as signed out.

## Not yet
Domain endpoints (N4–N6), CORS (not needed: same origin), publishing `/api/*` through Caddy (the web app reaches the API on the internal network; Caddy routes come with the first endpoint the browser must call itself).


## Domain endpoints (owner-scoped; every one needs the session cookie and, for writes, the platform Origin)
Controllers are thin: they hand `user.id` (from the session, never from the request) and the route/body values to the original services in
`src/modules/*`, which validate input with Zod, enforce ownership in SQL and bump revisions under the store lock.

| Area | Routes (`/api/…`) |
|---|---|
| Stores | `GET/POST stores`, `GET stores/templates`, `GET stores/onboarding`, `GET/PATCH stores/:id`, `PATCH stores/:id/business-category`, `POST stores/:id/delete`, `GET stores/:id/themes`, `GET stores/:id/themes/:key/report`, `POST stores/:id/themes/switch`, `GET stores/:id/preview[?theme=]` |
| Catalog | `GET/POST stores/:id/categories`, `PATCH categories/:cid`, `POST categories/:cid/delete`; `GET/POST stores/:id/products` (query: `q`, `category`, `status`, `page`), `GET/PATCH products/:pid`, `POST products/:pid/status`, `POST products/:pid/delete` |
| Pages | `GET stores/:id/pages`, `GET pages/:type`, `POST pages/:type/sections`, `PATCH/… sections/:sid` (`delete`, `delete-dormant`, `move`), `POST pages/:type/visibility`, `POST pages/:type/recover` (all writes carry `expectedRevision`) |
| Media | raw `application/octet-stream` bodies (≤ 6 MB): `POST stores/:id/products/:pid/image`, `POST stores/:id/logo`, `POST stores/:id/pages/:type/sections/:sid/image[?expectedRevision=]`; `…/delete` variants. Upload + attach is one operation and rolls the image back on failure |
| Publishing | `GET/POST stores/:id/publish`, `POST stores/:id/unpublish`, `GET stores/:id/versions`, `POST stores/:id/versions/live`, `GET/POST stores/:id/subdomain` |
| Public (no session) | `GET public/stores/:label` → `{live, data}` of the published version, `GET public/stores/:label/product-redirect?slug=` — one identical 404 for every unavailable case |

**Errors.** Domain errors cross the boundary as `{statusCode, error, errorName, payload}` (`packages/shared/src/errors/registry.ts`): 400 `ValidationError`
(`payload.fieldErrors`), 404 `NotFoundError` (a foreign id is indistinguishable from a random one), 409 conflicts/busy, 422 limits, 429 rate limits, 502 storage. The web app
rebuilds the same error classes, so its `instanceof` handling is unchanged. Messages, stacks and causes never travel.

**Readiness** (`GET /api/ready`) checks the database and the object store (2 s each, cached 2 s) and names the failing one.

**Jobs** (`apps/api/scripts`, run with `tsx`; same names as before at the repository root): `pnpm media:cleanup`, `pnpm db:cleanup`, `pnpm scheduler`, `pnpm scheduler:health`, `pnpm alert:test`, `pnpm publish:stats`, `pnpm db:studio`.

**Tests.** Unit and HTTP tests need no database (`pnpm api:test`); `pnpm api:test:db` runs the moved domain tests (≈ 475) and `src/__tests__/domain-http.db.test.ts` (authentication,
forged requests, ownership on every route, error transport, uploads, public read) on real PostgreSQL; `pnpm test:storage` needs an S3-compatible server. Architecture guards:
`src/__tests__/domain.architecture.test.ts` (data layer, catalog writes, media/storage, pages, published readers) and `architecture.test.ts` (env, console, Prisma).
