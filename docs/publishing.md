# Publishing, versions, subdomains and host routing (Phase 10)

## Model

* **Publish** takes the owner's *draft* (the editable tables), builds the storefront contract (`buildStorefrontData`) and stores it as an **immutable `StoreVersion`**. The public site renders only that snapshot. It never reads a draft table.
* `Store.status` is `DRAFT` (never published), `PUBLISHED` (live) or `UNPUBLISHED` (offline). The live version is `Store.publishedVersionId`; the existing `Store_published_consistency` CHECK keeps status and pointer in agreement.
* Operations (all owner-scoped, all take the **store row lock**): `publishStore`, `unpublishStore`, `setLiveVersion` (`rollback` while live, `republish` while offline), `claimSubdomain`. Rolling back or republishing only moves the pointer; a version row is never written, updated or deleted.
* Publishing needs a claimed subdomain (U1). Publishing the *same* content as the **active** snapshot (compared by hash, never with the highest-numbered version) is refused as "no changes". An unpublished store can always publish.

## What the database guarantees (migration `20261112090000_phase10_publishing`)

| Rule | Mechanism |
|---|---|
| A version is immutable | `BEFORE UPDATE` trigger always raises (`StoreVersion`, `StoreVersionProduct`, `PublishedSlug`) |
| A version cannot be deleted directly, but a store delete cascades | `BEFORE DELETE` trigger refuses unless `pg_trigger_depth() > 1` (i.e. fired by the cascade) |
| Snapshot size and hash | `snapshotBytes` CHECK ≤ 20 MiB; `contentHash` = sha256 of the same canonical UTF-8 text whose byte length is `snapshotBytes` |
| Published slugs are reserved forever, per store | append-only `PublishedSlug` (`UNIQUE(storeId, slug)`, no FK on `productId`, so deleting a product keeps its reservation) |
| Slug limits | statement trigger: ≤ 10,000 reserved slugs per store, ≤ 6 per product (current + 5 historical); the service checks first and reports a clear owner error |
| Subdomain reservation | `SubdomainReservation` has no foreign keys. A trigger on `Domain` writes it when a subdomain row is deleted (release **or** store deletion, 30 days) and refuses a claim by anyone but the previous store while it is active. Exact expiry: free again when `now() >= reservedUntil` |
| Domain identity | `UPDATE` of `Domain.id/storeId/kind/host` raises, so an update cannot bypass the reservation or move a host between stores |
| Races | per-host advisory lock inside the `Domain` `BEFORE INSERT/DELETE` triggers |
| Migration safety | pre-flight aborts loudly (counts, nothing changed) on inconsistent data (U11); tested on a scratch database |

JSONB stores a *normalised* binary form (key order, spacing, numeric and escape forms). The hash and size describe the canonical text that was sent; we never claim identical physical bytes. Text PostgreSQL cannot store (`\u0000`, lone surrogates) is detected before the insert and reported to the owner.

## Lock budget (the 10 s rule)

All draft writers take the store row lock first, so the lock is held for the whole publish. Every step runs under a budget (`LockBudget`, 10 s): `statement_timeout` is armed per step to the *remaining* budget, the clock is checked after each step, and a final fence runs before COMMIT; exceeding it rolls back and releases the lock with a retryable result. `lock_timeout` (5 s) bounds the wait for the lock.

Finding (verified): `statement_timeout` does **not** bound the work done at COMMIT. Protection is therefore structural: the publish path has no deferrable constraints or triggers (pinned by a test), `lockHeldMs` includes the COMMIT, and the worst-case test gate (below) fails above 10 s.

Worst case (20 MiB limit: 500 products, rich sections) measured by `worst-case.db.test.ts`; it prints one line `PUBLISH_WORST_CASE {...}` with bytes, lock-held-including-commit and the writer wait times, and fails when the hold exceeds 10 s. Local: 15.64 MiB snapshot, lock held 2.5 s including commit.

## Rate limit

At most 10 publishes per store per rolling hour, counted from `StoreVersion.createdAt` **inside the store lock** (exact and atomic: 20 concurrent requests produce exactly 10 versions).

## Slugs and redirects

* A product keeps every slug it was ever published under. Redirects are resolved dynamically against the **ACTIVE** version: the old slug redirects (real **301**, `Cache-Control: no-store`) to the slug the live version uses; after a rollback the older slug is simply the page again and the newer one redirects back.
* A deleted, archived or absent product → plain 404. Slugs stay reserved so they can never point to a different product.
* Changing the slug of a product that is live needs an explicit confirmation (checkbox in the product form; `confirmSlugChange`).
* Limits (owner-visible errors before exceeding, nothing silently discarded): 5 historical slugs per product, 2,500 redirects per version, 10,000 reserved slugs per store.

## Host routing

* Only the raw `Host` header is trusted. `X-Forwarded-Host`, `Forwarded`, `X-Original-Host` are never read (architecture test).
* `<label>.<APP_ROOT_DOMAIN>` is a store host. The proxy rewrites **every** path on a store host into the private `/store-host/<label>/…` namespace, so `/dashboard`, `/login`, `/api/*` and `/preview/*` are just storefront 404s there. The namespace itself is a neutral 404 on the platform host. The public page checks the Host again.
* Every unavailable case (unknown label, claimed but never published, unpublished, unsupported theme, unknown page, traversal or encoded-separator paths) is the **same neutral 404**.
* `/preview/...` stays on the platform root domain only.
* Hosts that are neither the root domain nor a valid single-label subdomain of it are treated as the platform (keeps `127.0.0.1` for development and CI working). They never render a store. In production only the configured domain reaches the application.
* Session cookies are host-only, so a store host never sees the dashboard session (checked in Chromium for `<label>.localhost`).

## Operations

* Statistics (counts and sizes only): `pnpm publish:stats`. All versions are retained (U5); use it to watch storage and WAL growth.
* The public side keeps a 64 MiB byte-bounded LRU of parsed snapshots keyed by the immutable version id (never stale).
* One structured log line per publish: `{"event":"publish","storeId","version","snapshotBytes","buildMs","lockHeldMs","budgetExceeded"}`.

## Test seams

`setPublishLimitsForTests`, `setPublishHooksForTests` (clock, skip no-op check, slow-step hooks) exist only for tests; production code never calls them.
