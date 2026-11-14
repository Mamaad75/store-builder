# Roadmap

Status legend: **Done** = implemented, tested and reviewed; **Implemented** = implemented and tested, awaiting review or first CI run; **Next** = approved and queued; **Planned** = not started.
Complexity is relative (low / medium / high), not a calendar estimate.

## Phases

| # | Phase | Goal | Status | Complexity |
|---|---|---|---|---|
| 1 | Project skeleton | Next.js, MUI RTL, tooling | Done | low |
| 2 | Database schema | Multi-tenant Prisma schema, migrations, template seed | Done | medium |
| 3 | Authentication | Register, login, sessions, `authVersion`, rate limiting | Done | high |
| 4 | Store management | Owner-scoped store CRUD, 10-store limit | Done | high |
| CI-0 | Initial CI | Independent verification on GitHub (no deployment) | Implemented; first GitHub run passed (run 1, commit `2605ba8`) | low |
| 5 | Products and categories | Owner-scoped catalog, lifecycle, search, atomic `draftRevision` | Implemented and tested; awaiting review | high |
| 6 | Renderer and "general" template | Section prop schemas, shared renderer, first real storefront, owner-only draft preview; URL helper using `APP_ORIGIN` and `STORE_ROOT_DOMAIN` | Implemented and tested; awaiting review (URL helper for `APP_ORIGIN`/`STORE_ROOT_DOMAIN` is deferred to phase 10, where the first public URL exists) | high |
| 7 | Media and images | S3 abstraction, validated uploads (no SVG), logo, product images, cleanup | Implemented and tested; awaiting review | high |
| 8 | Customisation and pages | Section content editing, ordering, page visibility, colours, typography from an allow-list, logo | Implemented and tested; awaiting review | high |
| 9 | Remaining templates | "Coffee and food" and "Fashion" templates | 9A and 9B accepted; 9C home-appliances theme and product specifications implemented and tested (awaiting review) | high |
| 10 | Publishing and subdomains | Immutable `StoreVersion` snapshots, publish/unpublish/rollback, subdomain claim, Host routing, slug history and redirect design, real `getPublishedSlug`, slug-change confirmation UX | **Accepted** on commit `eee9fec` (see `docs/publishing.md`), subject to the phase 14 media-cleanup scheduling requirement (D10-13) | high |
| 11 | SEO and metadata | Titles, descriptions, Open Graph, sitemap, robots, canonical, basic JSON-LD | Planned | medium |
| 12 | Platform polish and accounts | Landing page, onboarding, change password and sign out everywhere, error pages, accessibility pass, legal pages, password reset (email) | Planned | medium |
| 13 | Production readiness (code) | Dockerfile, standalone output, production compose, custom Caddy image, full CI/CD, env validation, readiness endpoint, CSP/HSTS, structured logs, backup and restore scripts, runbooks | Planned | high |
| 14 | Staging deployment | **Starts with the purchasing and configuration checklist and waits for explicit approval.** Domain, VPS, DNS, wildcard certificate, first deployment, restore drill. **Release gate: scheduled media cleanup tested in staging (D10-13).** | Planned (external) | medium |
| 15 | Production launch | Production server, backups and monitoring live, rollback rehearsed, limited beta | Planned (external) | medium |

## Milestones

| Milestone | Phases | What can be reviewed |
|---|---|---|
| M1 | 1 to 4 | Dashboard and store management (reviewed) |
| M2 | 5 (+ CI-0) | Products and categories |
| M3 | 6 | First real storefront with real products (preview) |
| M4 | 7 | Logo and images |
| M5 | 8 and 9 | Full customisation and all three templates |
| M6 | 10 and 11 | Published storefront on a platform subdomain (locally via `*.localhost`), SEO |
| M7 | 12 and 13 | Feature-complete MVP, CI green, deployment-ready |
| M8 | 14 | Online staging |
| M9 | 15 | Production |

## Scope

**Essential for the MVP:** phases 5 to 13, then staging and production (14 and 15). Password reset by email is treated as essential (a user who forgets the password is otherwise locked out); email verification can follow.

**After the MVP:** email verification, store members and roles, slug redirects beyond the phase 10 design, several images per product, nested categories, import/export, per-store analytics, CDN and image variants, two-factor authentication, audit log, soft delete, store duplication, bulk editing.

**Explicitly excluded from the current MVP (need separate planning):** shopping cart, checkout, payment gateways, orders, shipping, discounts, advanced inventory and stock reservations, subscriptions and platform billing, custom domains (connection and purchase), drag-and-drop editor, AI site generation, per-customer deployments, advanced SEO, plugins, template marketplace, mobile app.

## Constraints that apply to every phase

Deployment restrictions in `docs/decisions.md` stay in force: nothing is purchased, connected to, or deployed without explicit approval at phase 14.

## Recorded for phase 13 (from the phase 9A storage investigation)

1. Choose a maintained MinIO-compatible image or another S3-compatible server; verify bucket policies and **all** existing storage security tests before switching.
2. Fix the development `docker-compose.yml` MinIO start (the default `bitnamilegacy/minio` entrypoint restarts MinIO ~5 s after it first reports ready; CI already bypasses it, see `docs/media.md`).
3. Keep the failure-only MinIO diagnostics step in CI.
4. If the storage job fails again, investigate the printed diagnostics instead of assuming the same cause.
5. Never weaken a storage security assertion (anonymous LIST/PUT/DELETE must each get a real 403; ECONNRESET must fail the test).

## Mandatory for phase 14 (release gate, from the Phase 10 acceptance, D10-13)

**Media cleanup scheduling.** Replacing or removing images leaves unreferenced images behind whenever the follow-up release fails (store busy, database error, crash); `pnpm media:cleanup` is the only recovery path (`docs/media.md`). Until it runs, such an image keeps its public URL and its quota slot. Therefore, before any production deployment:

1. **Periodic, reliable execution.** `pnpm media:cleanup` runs periodically (at least hourly; the cleanup grace period is 1 h) through a scheduler that does not depend on a person or on a single request path (cron, a platform scheduler or an equivalent job runner chosen in phase 13/14). A missed run must be detectable (see 3).
2. **Exit codes are detected and reported.** The scheduler treats a non-zero exit code as a failed run and reports it: the script exits `2` when any item failed (items that could not be cleaned) and `1` when the run itself crashed. A scheduler that ignores exit codes does not satisfy this requirement.
3. **Failures are observable and alert.** The job's JSON report line and the `media.release_failed` / `media.reclaim_failed` log lines are collected by the production log pipeline, and an operational alert fires on (a) a failed run (non-zero exit), (b) no successful run within the expected interval, and (c) `scanTruncated: true` on consecutive runs. Alert routing is part of the phase 14 monitoring checklist.
4. **Recovery is verified.** Failed items must be shown to be recovered by a later run: in staging, inject a failure (for example, make the object store reject deletes, or hold a store lock), confirm the failed run exits non-zero and alerts, remove the fault, and confirm the next run removes the leftover images and rows (`failures: 0`, `deletingFinished` / `unreferencedReadyReclaimed` account for the leftovers) and that a further run changes nothing.
5. **Tested in staging before production.** The scheduled job (not only a manual run) is exercised in staging, including items 2 to 4, and its result is recorded in the phase 14 release checklist. **Production deployment does not proceed until this is done.**

Nothing in this repository schedules the job today and none is to be added before phase 13/14: no scheduler, no deployment infrastructure.

## Future work (recorded, not scheduled)

* **Archived-content cleanup and recovery** (from 9B): an explicit, owner-driven way to review archived (`legacySections`) entries, restore them into a page or delete them, with confirmation and the normal reference-aware media release. Until then archived entries and the media they reference are kept indefinitely and never removed automatically.

