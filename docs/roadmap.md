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
| 7 | Media and images | S3 abstraction, validated uploads (no SVG), logo, product images, cleanup | Planned | high |
| 8 | Customisation and pages | Section content editing, ordering, page visibility, colours, typography from an allow-list, logo | Planned | high |
| 9 | Remaining templates | "Coffee and food" and "Fashion" templates | Planned | high |
| 10 | Publishing and subdomains | Immutable `StoreVersion` snapshots, publish/unpublish/rollback, subdomain claim, Host routing, slug history and redirect design, real `getPublishedSlug`, slug-change confirmation UX | Planned | high |
| 11 | SEO and metadata | Titles, descriptions, Open Graph, sitemap, robots, canonical, basic JSON-LD | Planned | medium |
| 12 | Platform polish and accounts | Landing page, onboarding, change password and sign out everywhere, error pages, accessibility pass, legal pages, password reset (email) | Planned | medium |
| 13 | Production readiness (code) | Dockerfile, standalone output, production compose, custom Caddy image, full CI/CD, env validation, readiness endpoint, CSP/HSTS, structured logs, backup and restore scripts, runbooks | Planned | high |
| 14 | Staging deployment | **Starts with the purchasing and configuration checklist and waits for explicit approval.** Domain, VPS, DNS, wildcard certificate, first deployment, restore drill | Planned (external) | medium |
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
