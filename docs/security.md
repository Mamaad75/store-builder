# Security controls (phase 13)

## Response headers (every response)
Set by `src/proxy.ts` through `src/lib/security-headers.ts` for **all** outcomes (pages, rewrites to store hosts, redirects, the neutral 404, unknown hosts), computed per request from runtime configuration:

| Header | Value / rule |
|---|---|
| `Content-Security-Policy` | production only. `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:` **plus the media origin** (origin of `S3_PUBLIC_BASE_URL`); `font-src 'self' data:`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'self'`; `upgrade-insecure-requests` when `APP_PROTOCOL=https`. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, only in production over https (store hosts are sub-domains of the root, so they are covered). **No `preload`** (irreversible; a phase 14 decision once the domain is stable). |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb all denied. |
| `Cross-Origin-Opener-Policy` | `same-origin`. |
| `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-Powered-By` removed | from `next.config.ts` (unchanged). |

**Known, accepted weakness (D13-5): `'unsafe-inline'` for scripts.** Next.js inlines its bootstrap/hydration scripts. A nonce-based policy would force every page, including the prerendered landing page, to render dynamically per request and requires emotion cache nonces. Mitigations: all output is escaped by React, architecture tests ban raw HTML injection everywhere except the single JSON-LD component (which escapes `< > & U+2028 U+2029`), `object-src`/`base-uri`/`form-action`/`frame-ancestors` are locked down, and the only external origin is the media origin. Revisit with Next.js nonce support.

HSTS is also **not** sent by Caddy (no duplicate). CSP and HSTS are disabled in development and test (`NODE_ENV`), where Next needs eval and plain http.

## Startup refusals (the process exits with code 1 and prints variable NAMES only)
* `src/lib/server-env.ts` (D13-3): in every environment whose `NODE_ENV` is not exactly `development`/`test`: `DATABASE_URL`, `INTERNAL_API_URL` (the API; `AUTH_SECRET` is validated by the API itself, ≥ 32 chars, not a placeholder, see docs/api.md), `APP_ROOT_DOMAIN` (no default, bare host), `APP_PROTOCOL=https`, `TRUST_PROXY_HEADERS=true`, `RATE_LIMIT_BACKEND` not `memory`, `TRUSTED_PROXY_HOPS` sane, complete `S3_*`. Plain http is accepted only for a loopback root domain (the E2E suite).
* `src/modules/auth/mailer.ts` (D12-8): `MAIL_TRANSPORT=log|file` refused outside development/test.

## Readiness and liveness
`GET /api/health` (liveness, cheap) and `GET /api/ready` (database `SELECT 1` and an object-store listing, 2 s each, `503` with the failing dependency's NAME only). Both answer on the platform host only (any other Host: neutral 404). The container health check sends the platform Host header.

## Logs
`src/lib/log.ts` writes one JSON object per line (`ts`, `level`, `event`, fields). Values under keys matching password, secret, token, authorization, cookie, credential, api key, email, link, url or hash are replaced by `[redacted]`; `Error` objects are logged by class name only (never message or stack); strings are length-bounded. Caddy logs are JSON on stdout. Docker rotates container logs (5 × 20 MB per service). Existing structured events keep their shape (`media.release_failed`, `publish`, the scheduler's `job.*`, `startup.refused`, `readiness.failed`, `mail.reset_failed`, `auth.error`).

## Dependency audit
CI fails on any HIGH or CRITICAL advisory in production dependencies (`pnpm audit --prod --audit-level=high`). One advisory is accepted, listed in `package.json` under `pnpm.auditConfig.ignoreGhsas`:

* **GHSA-ggr8-5vv4-36mx** (`deepmerge-ts < 8`, stack exhaustion on recursive object graphs), reached only through `@prisma/client > prisma > @prisma/config`, i.e. Prisma's own CLI configuration loading. It merges trusted, developer-written configuration; no request data ever reaches it. Remove the entry when Prisma ships a patched dependency (check on every Prisma upgrade).

## Containers
Runtime image: non-root `node` user, standalone output only (no sources, no dev dependencies, no `.env`), read-only root filesystem with tmpfs for `/tmp` and the Next cache, all capabilities dropped, `no-new-privileges`, memory limit. PostgreSQL sits on an `internal: true` network and publishes no port. Only Caddy publishes 80/443. Base images are pinned by digest (Dependabot proposes updates). The images are rebuilt from the lockfile; nothing is pulled at run time.

## Edge contract (Caddy ↔ application)
Caddy replaces `X-Forwarded-For` with the connecting address and removes `X-Forwarded-Host`, `Forwarded`, `X-Original-Host`, `X-Real-Ip`; the application trusts the last `X-Forwarded-For` entry (`TRUSTED_PROXY_HOPS=1`) and only the raw `Host`. If a CDN is ever placed in front of Caddy, `TRUSTED_PROXY_HOPS` and Caddy's trusted proxies must change together (docs/deployment.md).
