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

## Phase 6: storefront renderer, `general` template and draft preview

Full architecture: [`docs/storefront.md`](storefront.md).

| ID | Decision | Status |
|---|---|---|
| D6-1 | **One data contract**, `StorefrontData` (`src/templates/storefront-data.ts`, strict Zod, `schemaVersion: 1`), is what every template renders. The draft preview builds it from the live tables; phase 10 will store exactly this shape in `StoreVersion.snapshot` and read it through the same schema. No second data model. | Implemented |
| D6-2 | The existing section model is reused and **tightened**: every section type has a strict props schema (unknown keys rejected, links must be internal paths). Persisted JSON is validated at the boundary (`parseSections`, `storefrontDataSchema`), never trusted by TypeScript type alone. All three seeds satisfy the strict schemas, so no data migration and **no database migration** is needed. | Implemented |
| D6-3 | **Compatibility rule:** invalid, unknown or legacy sections are skipped when rendering and reported to the owner in the preview banner. They are **never modified or deleted** (tested: the JSON in the database is byte-identical afterwards). Invalid store settings fall back to the template defaults, also reported, also unmodified. | Implemented |
| D6-4 | Templates are independent React implementations behind `TemplateModule` (`key`, `version`, `Layout`, one component per section type). They live in `src/templates/<key>` and are registered in a single file (`registry.ts`). The engine never imports a concrete template; an architecture test enforces it, so adding a template does not touch the core. | Implemented |
| D6-5 | The template is chosen from the persisted `TemplateVersion` (key + version). An unregistered key/version (`coffee`, `fashion` until phase 9) yields an explicit "unsupported template" outcome with a friendly page; it is never rendered with another template. | Implemented |
| D6-6 | Storefront code (`src/templates`, `src/app/preview`) does not import MUI, Next UI, Prisma, auth or dashboard components (architecture test). To make this true the root layout no longer loads MUI; `ThemeRegistry` moved into the dashboard and auth layouts, the landing page and the root not-found page. Dashboard behavior is unchanged. | Implemented |
| D6-7 | **Visibility rule:** only `ACTIVE` products are part of storefront data. `DRAFT`/`ARCHIVED` products never enter it (the preview shows only a count to the owner). Stock is independent of status: an ACTIVE product with zero stock is shown as "ناموجود". Prices are integer Toman. | Implemented |
| D6-8 | **Preview security model:** `/preview/<storeId>/...`. The owner id comes from the server session only; ownership is a SQL condition (`DraftStorefrontRepository`). Missing, foreign and malformed store ids give the same 404 (real HTTP 404, produced in the layout before any streaming). `proxy.ts` also redirects anonymous requests to login. Responses are `no-store`, `X-Robots-Tag: noindex, nofollow, noarchive` and `robots` metadata. A banner always marks the page as a private draft. Read-only: no revision bump, no version row, nothing published. | Implemented |
| D6-9 | Public storefront URLs are fixed by page type (`/`, `/products`, `/products/<slug>`, `/about`, `/contact`) and do not depend on the editable `page.slug`. Product URLs use the percent-encoded Persian slug; the router decodes safely. | Implemented |
| D6-10 | `readPublishedStorefront(storeId)` exists and is tested but has **no route and no writer** yet (phase 10). It reads only the snapshot pinned by `publishedVersionId`, never the live tables, and returns `null` for unpublished stores or snapshots that fail the contract. | Implemented |
| D6-11 | Images are placeholders (initial letter on a brand-colored block); no upload, no fake media. Contact/social links are built from validated values with fixed schemes and hosts, so a stored value can never produce a `javascript:` link. Brand color text color is chosen for WCAG AA contrast. | Implemented |

Known limitations (deliberate): inside an existing store, an unknown storefront path renders the not-found UI with HTTP 200 (Next streams it after the loading boundary); missing/foreign stores are a true 404. No cart, checkout or orders; product detail says to contact the store. Pagination is link-based (12 per page).

## Phase 7: media and images

Full description: [`docs/media.md`](media.md).

| ID | Decision | Status |
|---|---|---|
| D7-1 | `sharp` and `@aws-sdk/client-s3` are approved. All S3 code lives in `src/lib/storage/s3.ts`; application modules depend on the `MediaStorage` interface only (architecture test). | Implemented |
| D7-2 | Images are served from direct, public, read-only S3-compatible URLs built in one place (`mediaPublicUrl` from `S3_PUBLIC_BASE_URL`). The database and snapshots store relative keys, never a host. Keys are server-generated with 128 random bits. Anyone with a URL can read the image; the mechanism must not be used for private files. | Implemented |
| D7-3 | Limits: 5 MB upload, 25 MP decoded input, 2048 x 2048 output, 100 images and 100 MB (processed bytes) per store; all enforced on the server; quotas are race-free (reservation inside the store-row lock). | Implemented |
| D7-4 | Every accepted image is re-encoded as WebP (type, extension, key and recorded metadata always agree; a CHECK constraint enforces it). EXIF/GPS/ICC are stripped, transparency kept; animated, polyglot, malformed and oversized inputs are rejected. | Implemented |
| D7-5 | Product images and the store logo share one upload pipeline. `Store.logoId` is nullable with a composite FK `(id, logoId) -> Media(storeId, id)`; `Product.image` and `Store.logo` use `NO ACTION` so that deleting a whole store (cascade) works while deleting a referenced media row is refused. | Implemented (migration `20261107075639_phase7_media`) |
| D7-6 | Consistency: ordering + `Media.status` (PENDING/READY/DELETING) + idempotent cleanup instead of pretending S3 and PostgreSQL are atomic. A media object is never deleted while referenced by a product, the logo, a page section or any `StoreVersion` snapshot (published site and rollbacks). | Implemented |
| D7-7 | Upload rate limit via the existing shared limiter: 20 per 10 minutes per user and store. Ownership and forged ids are checked in SQL; foreign, missing, PENDING and DELETING media are indistinguishable (not found). | Implemented |
| D7-8 | CI gets a throw-away MinIO container (test-only credentials, isolated `-test`/`-e2e` buckets, loopback only) for storage integration tests and E2E; no deployment jobs or secrets. | Implemented; verified by GitHub Actions (see delivery report) |
| D7-9 | The storefront contract gains optional `store.logo` and `product.image` (`{key,width,height}`, default null) under the same `schemaVersion: 1`; the renderer receives a URL builder from the host. Hero/imageText section images stay placeholders (phase 8). | Implemented |
| D7-10 | Server Action body limit raised to 6 MB for uploads (the pipeline enforces the real 5 MB limit). | Implemented |

## Phase 8: page editing and appearance

Full description: [`docs/pages.md`](pages.md).

| ID | Decision | Status |
|---|---|---|
| D8-1 | Sections are edited with forms (add, edit, remove, up/down; no drag and drop) from the **current template's approved registry** (`TemplateModule.editor`: allowed / singletons / required per page). The core names no template, so phase 9 only adds specs. At most 20 sections per page. | Implemented |
| D8-2 | `HOME` and `PRODUCTS` cannot be hidden (service rule + CHECK constraint). Hiding `PRODUCT_DETAIL` is allowed; this makes product URLs "not found" in the preview. | Implemented |
| D8-3 | Every edit runs in `withStoreMutation`; new `Page.revision` is the optimistic-concurrency token, so stale forms get the existing explicit `ConflictError`. No-ops roll back and bump nothing (also applied to `updateStore`). | Implemented (migration `20261107083537_phase8_pages`) |
| D8-4 | Invalid/legacy section JSON is never discarded or overwritten: edits are refused until an explicit recovery MOVES the entries verbatim into `Page.legacySections`. | Implemented |
| D8-5 | Section images reuse the phase 7 pipeline; the reference is validated (same store, `READY`) in the mutation transaction; reference-aware release is preserved; the storefront contract gains `images` (by media id, relative keys). | Implemented |
| D8-6 | Typography: Vazirmatn only; size scale, heading weight and body weight come from explicit allow-lists; colors are strict `#RRGGBB`; no arbitrary CSS, HTML, scripts or external fonts. Old settings parse with defaults. | Implemented |
| D8-7 | Everything is draft-only; no publishing, snapshot writing or public routing. The preview reflects edits immediately. | Implemented |

## Phase 9A: business categories, theme modules and the section registry

Full description: [`docs/themes.md`](themes.md).

| ID | Decision | Status |
|---|---|---|
| D9A-1 | **Business category** (what is sold) and **theme** (visual direction) are separate. Category = `Store.businessCategory` (format-only CHECK; the registry in code is the allowlist, so a new category needs no migration); theme = the existing `Template`/`TemplateVersion` rows. No separate commerce models per category. | Implemented (migration `phase9a_business_category`) |
| D9A-2 | Backfill by inferred category from the current template key (best effort, editable). Category starter text is applied **only at creation**; changing the category never modifies pages, sections, products, categories, settings, colors or typography. | Implemented |
| D9A-3 | The category is store metadata: changing it is an atomic owner-scoped compare-and-set that does **not** increment `draftRevision` (the renderer does not read it), writes nothing for a no-op and reports concurrent changes as `ConflictError`. | Implemented |
| D9A-4 | Themes are pure `ThemeDefinition` + React `TemplateModule`; every theme must implement all core sections. Version 1 seeds and stores of general/coffee/fashion stay valid; coffee and fashion version 1 gain real renderers. Theme versions stay immutable. | Implemented |
| D9A-5 | Section **definition registry**: core types in the core, theme-specific types namespaced by theme (`coffee.openingHours`, `fashion.sizeGuide`). Validation of persisted JSON is global and independent of the active theme. | Implemented |
| D9A-6 | Three section states: active, **dormant** (valid, known, not approved by the active theme: preserved verbatim and in place, never rendered, deletable only by the owner) and invalid (Phase 8 recovery unchanged). Preservation = all keys/values, array and section order and references unchanged (not byte equality). Dormant sections keep participating in media reference protection. | Implemented (changes Phase 8's "not allowed" handling as approved) |
| D9A-7 | Store creation requires a theme that exists in the database AND in code; the creation form asks for category and theme separately (category only suggests a theme). | Implemented |
| D9B-1 | A theme switch writes only `Store.templateVersionId` (+ `draftRevision`); section state is derived on read, so nothing is migrated, normalised, inserted or deleted and a round trip is lossless. No migration. | Implemented |
| D9B-2 | The switch is refused (with the report) when it would create a NEW invalid section or violate a target required-section rule; pre-existing invalid data never blocks; the owner fixes pages under the current theme first. | Implemented |
| D9B-3 | The report carries `draftRevision`; the switch re-evaluates under the store lock and a stale report is a `ConflictError`. Same-theme switches are no-ops. | Implemented |
| D9B-4 | Only the latest active version of a theme key that also exists in code is a valid target; upgrades are out of scope. | Implemented |
| D9B-5 | Candidate-theme preview via `?theme=`: owner-only, read-only, isolated from published data. | Implemented |
| D9B-6 | `isMediaReferenced` also scans `Page.legacySections` (archived sections); archived entries are never removed by the application, so their media stay protected. | Implemented |
| D9B-7 | Known limitation, accepted: archived entries (`legacySections`) have no owner-facing removal, so media referenced only by them stays protected indefinitely. No automatic deletion of archived content or media, no destructive cleanup in 9B; an explicit, owner-driven archived-content cleanup/recovery capability is future work. | Accepted limitation |
