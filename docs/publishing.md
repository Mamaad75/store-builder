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

## Lock-hold guarantees (the 10 s budget): what is enforced and what is only measured

All draft writers take the store row lock first, so the lock is held for the whole publish and every writer waits for it. The budget is **10 s** (`lockBudgetMs`), started when the lock is acquired. The 10 s figure is a hard, server-enforced bound **up to the commit fence**; it is **not** a hard guarantee for the COMMIT itself.

| Phase of the transaction | Bounded at runtime? | By what |
|---|---|---|
| Waiting for the lock | Yes, 5 s | `lock_timeout` -> retryable "busy" result, nothing written |
| Every SQL statement (including the large snapshot INSERT) | **Yes** | `statement_timeout` re-armed before each step to the *remaining* budget; PostgreSQL cancels the statement, the transaction rolls back, the lock is released |
| Application-side (CPU) steps: read-draft, build, serialize, no-op check | Checked, **not pre-emptible** | the clock is checked after every step and before the next statement; measured 0.3-0.4 s, capped by the 20 MiB snapshot limit |
| Gaps between statements / a frozen application process | **Yes**, budget + 2 s | `idle_in_transaction_session_timeout` is set transaction-locally; if the connection sits idle holding the lock longer, PostgreSQL ends the session (rollback, lock released) |
| Deferred constraint / trigger work | **Yes** (none exists today) | `SET CONSTRAINTS ALL IMMEDIATE` runs it as an explicit budgeted statement *before* the fence |
| `COMMIT` itself (WAL flush; a synchronous-standby wait if one is ever configured) | **No** | cannot be cancelled; measured and reported |

Answers to the specific questions:

* **Deadline exceeded before COMMIT** - the next step (or the final fence) throws `PublishTimedOutError`; a statement still running is cancelled by PostgreSQL (SQLSTATE 57014) first. Prisma rolls the transaction back, nothing is visible, the lock is released, and the owner gets a retryable message. Tested for every step including the fence and the deferred-work step.
* **Can the transaction always be rolled back safely before COMMIT?** Yes. Nothing is visible until COMMIT; a rollback (or the server ending the session) discards every write, including the version, product index, slug reservations and the live pointer.
* **COMMIT unusually slow** - once COMMIT has been sent it cannot be cancelled by `statement_timeout` (verified on PostgreSQL 16: with a 1 s timeout, a 4 s deferred trigger ran to completion at COMMIT and the transaction committed; Prisma's own transaction timeout also does not interrupt a statement already running, verified). The commit is atomic (either fully committed or not at all) but the lock is held until it finishes. The real hold including COMMIT is measured on every publish (`lockHeldMs`, `budgetExceeded`, logged) and gated at 10 s by the worst-case test (CI: about 3 s for a 15.6 MiB snapshot).
* **What stops extra commit work from appearing later?** (1) the publish path has no deferrable constraint or trigger today (a test reads the catalog and fails if one is added on the touched tables); (2) even if one is added by mistake, `settleDeferred` forces its work to run before the fence under the budget (tested with a deliberately slow deferred trigger: cancelled at the budget, everything rolled back, lock free); (3) the worst-case test measures the real hold including COMMIT.
* **Remaining risk** - the residual commit-time work is the WAL flush (milliseconds on a single node; fsync stalls or a slow disk can extend it) and, only if a synchronous standby is configured later, the standby acknowledgement. Neither can be cancelled from the application. PostgreSQL 17's `transaction_timeout` would add a whole-transaction bound; the project runs 16.

### Draft writers: 5-second lock timeout (D10-11)

A draft writer waiting for the store lock used to be bounded only by how long the lock was held (verified: Prisma's 15 s transaction timeout does not interrupt a statement blocked on a lock, and draft writers set no `lock_timeout`). Now `withStoreMutation` sets a transaction-local `lock_timeout` of **5 s** as its first statement, before it touches the store row:

* a change that cannot get the lock in time fails with the typed, **retryable** `DraftBusyError` (PostgreSQL `55P03`); the transaction is rolled back, so nothing is written and `draftRevision` is not bumped; it is **never retried automatically**;
* the same timeout bounds any later lock wait inside the mutation (a product or category row); earlier writes of that mutation are rolled back with it;
* the settings save (`updateStore` -> `StoreRepository.updateDraft`, a single optimistic UPDATE that is not part of `withStoreMutation`) gets the same bound through the same helper (`withDraftLockTimeout`);
* the dashboard shows the Persian message "فروشگاه در حال انجام عملیات دیگری است ... دوباره تلاش کنید" (form actions) or the `busy` notice (redirect-style actions: product status, product delete, category delete);
* **publishing is unchanged**: `withStoreLock` keeps its own 5 s lock timeout and `PublishBusyError`; draft writers giving up never affects a running publish;
* the timeout is transaction-local (`set_config(..., true)`): pooled connections keep PostgreSQL's default (tested).

Not covered by this timeout (single-statement writers on the store row that are not draft content): the business-category change and store deletion. They can still wait for the lock for as long as it is held (at most the publish budget plus commit). Known edge: after a media attach/detach has committed, the follow-up release of the replaced image is a second mutation; if that one times out, the action reports "busy" although the attach succeeded and the replaced image stays unreferenced.

Worst case (20 MiB limit: 500 products, rich sections) measured by `worst-case.db.test.ts`; it prints one line `PUBLISH_WORST_CASE {...}` with bytes, lock-held-including-commit and the writer wait times, and fails when the hold exceeds 10 s. CI run 17: 15.64 MiB snapshot, lock held 3.06 s including commit.

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
* **Accepted hosts (enforced in the application, whatever sits in front of it):** only the configured `APP_ROOT_DOMAIN` (port included), `www.<root>` and valid single-label store subdomains `<label>.<root>`. Everything else - a foreign domain, an IP address, a nested label, a wrong or missing port, a missing or malformed Host - gets the neutral 404 on **every** path (page, `/api/*`, `/login`, `/dashboard`, `/preview/*`), and the platform-only guards reject it as well.
* **Development and tests:** the root domain you configure (default `localhost:3000`) works as before. The loopback names `localhost`, `127.0.0.1` and `[::1]` (with the root's port) are additionally accepted **only** when `NODE_ENV` is exactly `development` or `test`. Production, staging, an unset or a misspelled `NODE_ENV` are strict. The E2E suite runs a production build, so it exercises the strict policy.
* **Operations note:** health or readiness probes must send `Host: <APP_ROOT_DOMAIN>`; a probe addressed by IP is rejected on purpose.
* Static build assets under `/_next/static` and `/_next/image` are not host-checked (they are public files).
* Session cookies are host-only, so a store host never sees the dashboard session (checked in Chromium for `<label>.localhost`).

## Operations

* Statistics (counts and sizes only): `pnpm publish:stats`. All versions are retained (U5); use it to watch storage and WAL growth.
* The public side keeps a 64 MiB byte-bounded LRU of parsed snapshots keyed by the immutable version id (never stale).
* One structured log line per publish: `{"event":"publish","storeId","version","snapshotBytes","buildMs","lockHeldMs","budgetExceeded"}`.

## Test seams

`setPublishLimitsForTests`, `setPublishHooksForTests` (clock, skip no-op check, slow-step hooks) exist only for tests; production code never calls them.
