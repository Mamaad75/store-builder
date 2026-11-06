# Decision record

Every product, architecture and process decision that has been approved for this project, with its status.
Newer decisions never silently override older ones: a change is recorded as a new entry that references the old one.

## Repository and process

| ID | Decision | Status |
|---|---|---|
| P-1 | Work only in `Mamaad75/store-builder` on the feature branch `claude/confident-davinci-mcf5d0`. The Git history is preserved. `main` is not created or modified until the work has been reviewed. | Approved |
| P-2 | Work proceeds in small phases. Each phase ends with a report and waits for approval before the next one starts. | Approved |
| P-3 | Nothing is called complete unless it was implemented **and** tested. Reports separate code inspection, automated tests run in the sandbox, and CI results. | Approved |

## Product and architecture (phases 1 to 4)

| ID | Decision | Status |
|---|---|---|
| A-1 | Modular monolith on Next.js (App Router), TypeScript, MUI (RTL, Persian, Vazirmatn), PostgreSQL, Prisma. One deployment, never one project per customer. | Approved |
| A-2 | Server Actions only. No REST API in the MVP. | Approved |
| A-3 | Authentication: Auth.js Credentials with JWT sessions, Argon2id, `User.authVersion` re-checked on every session read. Rate limiting through a storage-agnostic `RateLimiter` (shared PostgreSQL backend). | Approved |
| A-4 | Multi-tenancy: every tenant row carries `storeId`; ownership is checked **in SQL** by owner-bound repositories; the client never supplies identity. A foreign and a non-existent resource are indistinguishable (404). | Approved |
| A-5 | At most 10 stores per user, enforced with a row lock on the user (`createStore` is the only place that creates stores). Store deletion is physical, with database cascades, and requires typing the store name. | Approved |
| A-6 | SVG uploads are forbidden. | Approved |
| A-7 | Draft and Published are separate: the public site is rendered only from an immutable `StoreVersion` snapshot. Editing never changes the live site. | Approved |
| A-8 | Subdomain is chosen at first publication, globally unique, with a reserved-name list. | Approved |

## Phase 5: products and categories

| ID | Decision | Status |
|---|---|---|
| D5-1 | Product status is `DRAFT`, `ACTIVE` or `ARCHIVED`. `ARCHIVED -> ACTIVE` is **not** allowed; an archived product must first return to `DRAFT`. Same-status "transitions" are rejected. | Implemented |
| D5-2 | Every new product starts as `DRAFT`. Activation is an explicit, validated transition (`changeProductStatus`), the only way to change status. | Implemented |
| D5-3 | Maximum stock quantity is 1,000,000. Stock must be a non-negative integer. | Implemented (Zod + DB `CHECK`) |
| D5-4 | `lastPublishedSlug` is **not** added in phase 5. Slug history and redirects are designed as part of the publishing architecture in phase 10. | Honoured |
| D5-5 | A save that changes nothing does not write and does not increment `draftRevision`. | Implemented |
| D5-6 | Category slugs are generated automatically from the name and are not editable. | Implemented |
| D5-7 | Product status and stock availability are independent. `stockQuantity = 0` never hides, archives or unpublishes a product. "Out of stock" is a display badge only. | Implemented |
| D5-8 | Price is an integer number of Toman; only the number is stored. Zero is allowed. Displayed with thousands separators and the unit "تومان". One currency only. | Implemented |
| D5-9 | Renaming a product never changes its slug. The slug is generated once at creation; "regenerate from name" is an explicit, manual action in the form. | Implemented |
| D5-10 | Changing the slug of a product that is **live on the published storefront** requires explicit confirmation. The rule is implemented server-side behind an injectable dependency `getPublishedSlug(ctx, productId)`; with nothing published (phase 5) it answers `null`. **No confirmation UI is shown until phase 10**, when the real published-slug source (slug history / published snapshot) replaces the default and the UX is activated. | Server logic implemented and tested with injection; UX deferred to phase 10 |
| D5-11 | Deleting a category never leaves a product with an invalid category reference. By default deletion is refused while the category has products; with explicit confirmation the products are moved to "uncategorised" and the category is deleted in one transaction. The composite foreign key (`Restrict`) is the final backstop. | Implemented |
| D5-12 | Every product and category mutation runs inside `withStoreMutation`. | Implemented (enforced by types and an architecture test) |
| D5-13 | **Business decision (MVP):** the maximum price is **1,000,000,000 Toman**. This is a business limit chosen for the MVP, not a technical one: the `Int` column could hold up to 2,147,483,647. It is enforced in Zod and by a database `CHECK`. Raising it up to about 2.1 billion needs only the constant and the `CHECK`; going beyond that requires changing the column type to `BigInt` and must be planned separately. | Approved |
| D5-14 | Limits per store: 50 categories and 500 products. Persian normalisation of names, slugs and search (`ي→ی`, `ك→ک`, `ى→ی`, NFKC, tatweel and invisible characters removed, digits normalised for search). Every successful mutation bumps `Store.draftRevision`. | Implemented |

### How the Phase 5 guarantees work

* `withStoreMutation(ownerId, storeId, fn)` opens a transaction whose **first statement** is
  `UPDATE "Store" SET "draftRevision" = "draftRevision" + 1 WHERE id = ? AND "ownerId" = ?`.
  Zero rows means `NotFoundError`; otherwise the store row is locked until commit. This verifies ownership, serialises all catalog writes of that store
  (so limits, generated slugs and status changes are race-free) and bumps the revision atomically. If `fn` throws, everything rolls back, so a failed mutation never bumps the revision.
* Lock order is always Store row, then category, then product.
* Repository write functions require a `MutationContext`, which only `withStoreMutation` can create; an architecture test enforces this.
* Search uses a stored, normalised `searchKey`. `%`, `_` and `\` in a query are escaped (Prisma's `contains` does not escape them).
* Database `CHECK` constraints mirror the rules (ranges, slug format, no Arabic yeh/kaf in names, slugs or the search key), so bypassing the application does not bypass normalisation.

## Domains and infrastructure (decided now, executed later)

| ID | Decision | Status |
|---|---|---|
| I-1 | The MVP starts with **one** domain. The architecture keeps `APP_ORIGIN` and `STORE_ROOT_DOMAIN` separate (equal for now) so storefronts can move to a separate root domain later without a rewrite. | Approved |
| I-2 | Caddy needs a custom build that includes the chosen DNS-provider module to obtain wildcard certificates with ACME DNS-01. The module, the Caddy version and the rebuild process are part of phase 13; provider selection criteria are part of phase 14. | Approved |
| I-3 | Single VPS for staging and initial production, with off-server backups and a tested restore. | Proposed in the audit, to be confirmed in phase 14 |

## Deployment restrictions (mandatory, unchanged)

* No purchase of a domain, VPS or any service.
* No connection to any server, hosting provider, DNS account, domain registrar or other external infrastructure.
* Nothing is deployed.
* Private SSH keys, database passwords and unrestricted tokens are never requested in chat. When access is needed, a dedicated deploy user with a restricted SSH key is used.
* At the start of **phase 14** a concrete purchasing and configuration checklist is delivered (domain and DNS-provider requirements including DNS API and Caddy DNS-01 compatibility, VPS specifications and selection criteria, staging and production infrastructure, backup storage, estimated monthly costs). No deployment-related action happens without explicit approval.

## Continuous integration (CI-0)

| ID | Decision | Status |
|---|---|---|
| C-1 | An initial GitHub Actions workflow runs on the feature branch and on pull requests: typecheck, lint, unit tests, database tests, E2E tests and the production build, each against isolated, job-local test databases. | Implemented; first GitHub run passed (run 1, commit `2605ba8`) |
| C-2 | No deployment jobs, no secrets, no SSH credentials, no DNS tokens, no external infrastructure. Permissions are `contents: read` only. | Implemented; first GitHub run passed (run 1, commit `2605ba8`) |
| C-3 | Every third-party Action is pinned to a **verified full commit SHA** with a version comment; Dependabot updates them. A SHA that cannot be verified is never guessed. | Implemented (SHAs verified); first GitHub run passed (run 1, commit `2605ba8`) |
| C-4 | E2E tests retry once **in CI only**. A test that passes on retry is reported as **flaky**, separately from consistently passing tests. Local runs never retry. | Implemented; first GitHub run passed (run 1, commit `2605ba8`) |
| C-5 | The full production CI/CD pipeline (container build, custom Caddy image, audit, release) is phase 13. | Planned |

Pinned Actions (verified with `git ls-remote` against the upstream repositories; annotated tags were resolved to the commit they point to and each SHA was confirmed to be a commit object whose `action.yml` declares the expected runtime):

| Action | Version | Commit SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `pnpm/action-setup` | v6.1.1 | `73e46992e05b19abd31f2f3c20e0e7370d762115` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
