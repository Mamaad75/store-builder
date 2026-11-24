# Store Builder — MVP roadmap (product-first, security proportional to release risk)

* **Status:** proposal for owner review, 2026-11-24. Analysis and documentation only; no code, schema or behaviour was changed.
* **Inspected:** branch `claude/confident-davinci-mcf5d0`, commit `961c804`.
* **Relationship to other documents:**
  * `docs/roadmap.md` (historical phases 1–15) and ADR 0002 §6 (phases 1–7) remain the record of what was done.
  * This document orders the remaining work.
  * ADR 0005 decisions are preserved unchanged. Only their **timing** is proposed here.
* **Correction to the brief:** the stack does **not** use Auth.js. Authentication is the project's own HS256 session token issued by the NestJS API (`apps/api/src/auth/*`, ADR 0001); there is no `next-auth` / `@auth/*` dependency.

---

## 1. Executive summary

The platform is further along than a typical MVP: a merchant can register, create a store from 12 themes, add products with variants, stock and linked prices, edit pages, publish to a subdomain, and take orders through cart and checkout with cash on delivery, card-to-card (with receipt review) or online payment (Zarinpal / Aghaye Pardakht, verified server-side against fake gateways only). Orders have a full lifecycle with SMS notifications (development log only), discount codes, customers, and a platform admin with store suspension.

**What is genuinely missing for an operable MVP is small:**
1. Merchant sales overview (no reporting at all).
2. End-to-end tests of the commerce journey: E2E covers the builder, storefront and auth, but **not** cart, checkout, orders or payments.
3. A few P0 payment-safety fixes before real money: manager payout changes, the production sandbox default.
4. Staging deployment with real provider sandboxes.
5. Final legal text.

Subscription billing, custom domains, merchant phone verification and recovery, and identity verification are **not** needed to *build* the product. They are release gates for real merchants or public launch, as set out in §9.

---

## 2. Verified implementation inventory

Legend:

| Label | Meaning |
|---|---|
| **V** | Implemented and verified by tests (unit / DB / E2E) |
| **I** | Implemented, incomplete |
| **P** | Partial |
| **N** | Not implemented |
| **B** | Blocked by a dependency |
| **?** | Needs investigation |

Test totals at the last full run (this session): DB 734, API 473, web 947, shared 310 (all passing). Type checks pass for shared, API, web and e2e. CI typecheck excludes e2e.

### Platform foundation

| Capability | State | Evidence |
|---|---|---|
| Authentication (username + password, sessions, change password, sign out everywhere) | V | `apps/api/src/auth/*`; `e2e/auth.spec.ts`; rate limits |
| Account recovery / password reset | N | Email reset removed (ADR 0001 U1); no SMS recovery (ADR 0005 V2) |
| Store roles & permissions (OWNER / MANAGER / OPERATOR, 16 permissions, fail-closed guard) | V | `modules/access`, architecture test "every :storeId route guarded" |
| Multi-tenancy / isolation | V | Owner-scoped services, `StoreAccessGuard`, cross-store tests in DB suites (orders, discounts, receipts, suspension) |
| Platform admin (SUPER_ADMIN, overview, stores, settings, secrets, rates, admins) | V | `modules/platform`, `/platform/*`; browser-verified G2 |
| Store suspension (independent of publishing) | V | ADR 0003 G2; DB + browser verification |
| Billing restrictions / plans | N | ADR 0003 Part C design only |
| Account-level restriction | N | ADR 0003 D2 |
| Admin MFA | N | — |

### Store builder

| Capability | State | Evidence |
|---|---|---|
| Templates / themes (12 business themes, theme switch with report) | V | `packages/shared/src/templates`, `e2e/themes.spec.ts`, `theme-switch.spec.ts` |
| Renderer (published snapshot, sections, listing) | V | `templates/engine/*`, `e2e/storefront.spec.ts` |
| Store creation (with sample content), settings, business category, logo | V | `modules/stores`, `e2e/stores.spec.ts`, `media.spec.ts` |
| Page / section editing, preview | V | `modules/pages`, `e2e/pages.spec.ts`, preview routes |
| Publish / unpublish / rollback / republish | V | `modules/publishing`, `e2e/publishing.spec.ts` |
| Subdomain routing (host policy) | V | `apps/web/src/lib/host-policy.ts`, `e2e/host-policy.spec.ts` |
| Custom domains | P | `Domain.kind = CUSTOM` exists; no verification, no TLS for foreign hosts, host policy accepts only `*.root` |
| SEO (metadata, sitemap, robots, JSON-LD, slug redirects) | V | `docs/seo.md`, `e2e/seo.spec.ts` |
| Static & dynamic pages | V | Pages module + renderer |

### Commerce

| Capability | State | Evidence |
|---|---|---|
| Products CRUD, specs, variants, stock ledger | V | `modules/products`, `inventory`; DB tests; `e2e/catalog.spec.ts` |
| Categories | V | `modules/categories` |
| Images / media (re-encode, quotas, public bucket policy) | V | `modules/media`, storage tests (MinIO) in CI |
| Linked prices (USD / gold) | V | `modules/pricing`; Navasan off by default |
| Discount codes | V | `modules/discounts`, DB tests (browser-verified) |
| Storefront catalog, search, category filter, sort, pagination | V | `templates/engine/listing.ts`, storefront E2E |
| Cart, checkout, shipping methods, addresses | I | API DB-tested; UI browser-verified manually; **no E2E spec** |
| Orders (place, lifecycle, merchant management, shopper tracking, offline-store access) | I | DB-tested; **no E2E spec** |
| Payments: COD | I | DB-tested; no E2E |
| Payments: card-to-card (receipts, review) | I | DB-tested; no E2E; P0 finding V0-1 (manager can swap cards) |
| Payments: online (Zarinpal / Aghaye Pardakht verify, reconcile, expire) | I / B | DB-tested against **fake** gateways only; real sandbox never exercised (needs staging + credentials); P0 finding V0-4 (sandbox default) |
| Order SMS | I / B | Implemented with dev log; real delivery blocked until production deployment (ADR 0004) |
| Customer accounts (password, SMS code, addresses, my orders) | V | DB tests; browser-verified |

### Operations

| Capability | State | Evidence |
|---|---|---|
| Merchant dashboard (catalog, orders, customers, payments, shipping, SMS, discounts, pages, theme, publish) | V | `apps/web/src/app/dashboard/stores/[storeId]/*` |
| Sales overview / reports | N | No aggregation endpoint (only `orders/customer-stats` per customer) |
| Customer management | V (basic) | `/customers` list with order stats |
| Subscription & billing | N | ADR 0003 Part C |
| Email | P | SMTP transport exists and CI-tested; **no product flow sends email** |
| SMS | I / B | ADR 0004 |
| File storage | V | S3/MinIO abstraction (public media only) |
| Logging / metrics / error tracking | P | JSON logs, metrics endpoints, Sentry-protocol reporter; no central store, dashboards or alert rules beyond Bale |

### Infrastructure

| Capability | State | Evidence |
|---|---|---|
| Docker (dev, prod compose, smoke compose), production Dockerfile | V | `Dockerfile`, `docker-compose.prod.yml`, CI container job |
| Reverse proxy + TLS (Caddy, wildcard via DNS-01) | P | Caddyfile exists; DNS-provider snippet not generated (phase 14 K2) |
| Migrations (expand-only, `down.sql`, drills) | V | `apps/api/prisma/migrations` (28) |
| Backup / restore scripts and runbook | P | Scripts + drill documented; off-server target and scheduled drill pending (checklist B7) |
| Health / readiness | V | `/api/ready`, `/api/health` |
| CI | V (gap) | Typecheck, lint, unit, DB, queue, storage, mail, E2E, audit; **e2e typecheck not in CI** |
| Environment / secrets | V | Startup refusals, envelope encryption; `APP_ENV` not yet (ADR 0005 §17.2) |
| Deployment / rollback docs | P | `docs/runbook.md`; real deployment never performed |

---

## 3. Missing and incomplete product capabilities (prioritised)

1. **Commerce E2E coverage.** Cart → checkout → COD order → merchant fulfils; card-to-card with receipt review; online payment against the fake gateway; discount; offline-store order access. This is the most important regression net and is absent.
2. **Merchant sales overview.** Today's / 7-day / 30-day orders and revenue; pending actions (receipts waiting, orders to confirm or ship); low stock.
3. **Real payment sandbox validation.** Zarinpal and Aghaye Pardakht sandboxes on staging (needs staging and credentials).
4. **Final legal pages.** `/terms` and `/privacy` are still drafts (checklist C3).
5. **Subscription billing.** Needed only before charging merchants.
6. **Custom domains.** Post-MVP unless pilot merchants require them.
7. **Email flows.** None needed for MVP; the platform has no email identity anymore.

---

## 4. Prioritised security backlog

Sources: ADR 0005 §15–§17 findings, ADR 0003 reviews, the checklist. Priorities are justified against the **affected capability**.

| ID | Finding / control | Priority | Why this priority | Gate |
|---|---|---|---|---|
| V0-1 | MANAGER can replace bank cards (`PUT /stores/:id/bank-cards`, `store.settings`) | **P0** | Unauthorised payout change: money redirection by staff | Before card-to-card is used by any real store that has staff |
| V0-4 / D-19 | Sandbox default `true`; SUPER_ADMIN can enable sandbox; no environment identity | **P0** | Orders marked paid without money in production | Before real online payments |
| D-22 / V0-6 | OPERATOR / MANAGER receive full card numbers (`GET bank-cards`) | **P1** | Numbers are already shown to shoppers of unpaid orders, so exposure is limited; still an approved control | Before real merchants with staff |
| V0-2 | Bank-card audit weak (after-success interceptor, no before/after); no owner notice | **P1** (audit part P0 with V0-1) | Audit-in-transaction must ship with the permission fix; notices can follow | Audit with V0-1; notices before public launch |
| V0-3 | Gateway-credential change: no notice / cooling-off | **P1** | Owner-only already; risk is account takeover, addressed by V1/V2 | Before public launch |
| CO-1, D-2/D-24 | Cooling-off | **P1** | Only meaningful once phone change / recovery exist | Ships with V1/V2 |
| V1 | Merchant phone verification, D-4, D-11, D-12c | **P1** | Needed for recovery and notices; no breach without it | Before public launch (pilot: see D-PILOT, §10) |
| V2 / SE-2 | Account recovery | **P1** | Lockout risk and support load, not a breach | Before public launch |
| SE-2 | SUPER_ADMIN MFA | **P1** | Platform-wide impact of one phished account | Before public launch |
| D-20 | Password re-entry for cooling-off lift | **P1** | Depends on cooling-off | With V1/V2 |
| D-25 | Security-event visibility for MANAGER | **P1** | Only relevant once security events exist | With V0 notices |
| D-27 | Shopper sees cards after the payment deadline until the expiry job | **P2** | Window of minutes; same shopper; low impact | Post-MVP (or trivial fix whenever touched) |
| D-28 | Outbox delivery of owner SMS notices | **P1** | Reliability of notices | With notices |
| DOC-1/2, V3–V5, D-21 | Identity-document storage, verification workflows | **P2** | No documents are accepted; capability stays disabled | Before enabling identity verification |
| Admin store-list mobile scroll, deleted-store history UI | **P2** | Usability | — |
| E2E typecheck not in CI | **P1 (quality)** | Test code can rot silently | Next milestone |

**Verified to have no open P0 today:**
* Tenant isolation: guards plus cross-store DB tests.
* Authentication bypass: guard tests.
* Suspension bypass: G2 review and tests.
* Upload pipeline: re-encoding and storage-policy tests.
* Payment verification against the fake gateway: amount from the server, fingerprinted merchant id, idempotent verify.

Each of these could still regress, which is why item 1 of §3 matters.

---

## 5. Revised V0 / V1 scope and deferrals

All ADR 0005 decisions stay approved as written. Only the timing below is proposed.

| Bucket | Controls | Deferral justification / remaining risk / what stays disabled |
|---|---|---|
| **A. Next development milestones** | None of V0/V1 is required to keep building | Development runs with fake gateways, dev SMS log and no real money; no risk to real users |
| **B. Before real payments or real customer data (pilot gate G-PILOT)** | **V0-core:** `payout.manage` OWNER-only (D-3); masked card reads (D-22); payout audit inside the transaction; D-19 via `APP_ENV` + sandbox default `false` + API refusal; `PayoutGuard` with permission + suspension (cooling-off check present but inactive until V1) | Until done: no real gateway credentials and no real bank cards on any deployment; staging uses sandbox only |
| **C. Before public launch (G-PUBLIC)** | V0-notices (in-app + outbox SMS, D-28), refused-attempt security events, D-25; V1 (phone verify / change, D-4, D-11, D-12c); cooling-off D-2 / D-2s / D-24 / D-20; V2 self-service recovery; SUPER_ADMIN MFA; real SMS at production deployment (ADR 0004) | Remaining risk during the pilot: account takeover by stolen password is not slowed by cooling-off and not notified by SMS; no self-service recovery. Mitigated by a small, known pilot group and manual support (decision D-PILOT) |
| **D. After MVP** | V3–V5 identity and business verification, documents (D-6, D-21), D-27, advanced monitoring, retention automation | Identity verification, document upload and anything gated by D-1 (card-to-card requiring identity) stay **disabled**; card-to-card remains available under D-13 / D-1 Pending |

Previously stated: "V0, V1, V2 before the first real merchant" (ADR 0005 §15.8). **Proposed change:** that applies to **public onboarding**. A small pilot needs only bucket B. This needs owner approval (D-PILOT) and is **not** assumed.

---

## 6. Milestones

### M1 — Commerce journey locked down (quality)
* **Objective:** prove the money path works end to end and keep it working.
* **Value:** confidence to demo and pilot; protects every later change.
* **Features:**
  * Playwright specs covering: cart, checkout with COD, merchant confirm / ship / deliver; card-to-card with receipt upload and merchant approval; online payment against the local fake gateway (`ZARINPAL_DEV_BASE_URL`); discount code at checkout; shopper order page on an unpublished and a suspended store.
  * Add e2e typecheck to CI.
* **Current status:** API covered by DB tests; manual browser runs only.
* **Dependencies:** none.
* **Security controls:** none new; the specs include the isolation checks (another store's token → 404).
* **Tests:** the new E2E specs; existing suites unchanged.
* **Definition of Done:** the specs pass in CI three runs in a row with no flaky retries; e2e typecheck is a CI step.
* **Deferred:** real gateway sandboxes (M4).

### M2 — Merchant operations essentials
* **Objective:** a merchant can see how the store is doing and what needs action.
* **Value:** daily usability; the first thing pilot merchants ask for.
* **Features:**
  * Dashboard overview: orders and revenue (today, 7 days, 30 days).
  * Action items: receipts waiting, orders to confirm or ship.
  * Low-stock list.
  * One aggregation endpoint behind `orders.view`.
* **Current status:** N.
* **Dependencies:** none.
* **Security controls:** permission `orders.view`; store-scoped queries; cross-store test.
* **Tests:** DB tests (numbers, isolation, role); one E2E.
* **Definition of Done:** the numbers match seeded orders; OPERATOR is refused.
* **Deferred:** charts, exports, advanced analytics.

### M3 — Payment safety core (V0-core, bucket B)
* **Objective:** close the P0 payment findings before any real money.
* **Features:** D-3 `payout.manage`; D-22 masking; transactional payout audit; D-19 `APP_ENV` validation, effective-sandbox rule, default `false`, API refusal and audit; `PayoutGuard` (cooling-off hook inactive).
* **Current status:** N (specified in ADR 0005 §16.1 and §17.2).
* **Dependencies:** none. The deployment files and the smoke compose file must set `APP_ENV` in the same change.
* **Security controls:** as listed.
* **Tests:**
  * Role matrix and masking DTO tests.
  * Audit rollback test.
  * No full card number in audit or logs.
  * `APP_ENV` validation table.
  * Production refuses sandbox.
  * Architecture test: only the guard writes payout data.
* **Definition of Done:** all bucket-B controls are implemented and tested; the integration review is recorded.
* **Deferred:** notices, security events, cooling-off activation (M6).

### M4 — Staging and pilot readiness (infrastructure)
* **Objective:** a real, private staging environment that mirrors production.
* **Features (checklist A–B):**
  * Server and domain.
  * Wildcard TLS.
  * Storage bucket policy tests.
  * Backups with an off-server copy and a restore drill.
  * Bale alerts.
  * `APP_ENV=staging`.
  * Zarinpal and Aghaye Pardakht **sandbox** runs.
  * Final legal pages (needed before the pilot, see G-PILOT).
* **Dependencies:** M3 (`APP_ENV`), owner purchases (checklist A).
* **Security controls:** checklist B2–B11.
* **Tests:**
  * Smoke tests on staging.
  * Restore drill.
  * Sandbox payment E2E on staging.
* **Definition of Done:** checklist §5 steps 3–12 are recorded.
* **Deferred:** Kavenegar (production only, ADR 0004). Staging runs with `NODE_ENV=production`, so the dev SMS log is refused there and staging sends **no** SMS; order SMS stays recorded as skipped.

### M5 — Pilot (G-PILOT): first real merchants
* **Objective:** a few real stores with real orders.
* **Features:**
  * Production deployment (checklist C).
  * Real payment credentials entered by merchants.
  * Kavenegar configured at production deployment (ADR 0004).
  * Grace reminders for phone verification shown once V1 exists (D-13).
* **Dependencies:** M1, M3, M4; PSP answers (checklist P1–P3); legal pages.
* **Security controls:** bucket B plus checklist C.
* **Definition of Done:** one real payment of each enabled method completed and reconciled; backups verified in production.

### M6 — Account security for public launch (bucket C)
* **Features:**
  * V1: phone verify / change, D-4, D-11, D-12c, with the failure case recorded.
  * Cooling-off: D-2, D-2s, D-24, D-20.
  * V2 recovery.
  * Notices via the outbox (D-28) and security events (D-25 decision).
  * SUPER_ADMIN MFA.
* **Dependencies:** M3. M5 is not required for development but is for real-SMS validation.
* **Tests:** ADR 0005 §16.6 and §17.7 matrix.
* **Definition of Done:** the matrix passes; the integration review (D-15) is recorded; real SMS is verified in production.

### M7 — Public launch (G-PUBLIC)
* Open registration.
* Abuse and takedown process (checklist MO3).
* Pending decision D-16 (new merchants must verify a phone to publish).
* Billing, if paid plans start at launch (ADR 0003 B1–B3).

### Post-MVP (unscheduled)
Custom domains (checklist K), Torob product feed (ADR draft), Emalls, abandoned-cart SMS, identity / business verification (V3–V5), advanced analytics, D-27.

---

## 7. Dependencies and critical path

```
M1 ─┐
M2 ─┼──────────────────────────────┐
M3 ─┴─► M4 (staging) ─► M5 (pilot) ─┴─► M7 (public)
         └─────────────── M6 (account security) ──┘
```

* **Critical path to the pilot:** M3 → M4 (owner purchases) → M5.
* **Parallel work:** M1 and M2 do not block M3 and should run first or in parallel.
* **Critical path to public launch:** M5 and M6 → M7.

## 8. Quality gates per milestone

| Gate | M1 | M2 | M3 | M4 | M6 |
|---|---|---|---|---|---|
| Typecheck (incl. e2e) + lint | ✓ | ✓ | ✓ | ✓ | ✓ |
| Unit | — | ✓ | ✓ | — | ✓ |
| DB / integration | existing | ✓ | ✓ | — | ✓ |
| Architecture tests | — | — | ✓ (payout writers) | — | ✓ (cooling-off writer) |
| E2E | ✓ (new) | ✓ | ✓ (owner vs manager) | staging smoke | ✓ |
| Security tests | isolation in E2E | isolation | payout, masking, sandbox | storage policy, TLS | sessions, OTP, cooling-off |

No existing test is removed or weakened; every milestone ends with all suites green.

## 9. Launch gates

* **G-PILOT (real money, real shoppers, invited merchants):**
  * M1, M3 done.
  * Staging verified (M4).
  * Legal pages final.
  * PSP onboarding answers.
  * Backups and restore drill.
  * No real gateway credentials or bank cards before M3.
* **G-PUBLIC (open registration):**
  * Everything in G-PILOT.
  * M6.
  * SUPER_ADMIN MFA.
  * Abuse process.
  * D-16 decided.
  * eNamad for the platform (checklist L3).
  * Billing (if charging).

## 10. Risks, assumptions and decisions needed

| # | Item | Proposal |
|---|---|---|
| D-PILOT | Can the pilot run with only bucket B (no phone verification, recovery or cooling-off), using a small known merchant group and manual support? | Yes, with written pilot terms. **Needs approval**; ADR 0005 §15.8 said otherwise |
| D-STAGING-SMS | Staging sends no SMS (dev log refused under `NODE_ENV=production`; Kavenegar only in production per ADR 0004) | Accept; test SMS flows in development and at production deployment |
| D-PILOT-BILLING | Pilot is free; billing before charging | Confirm |
| D-DOMAINS | Custom domains post-MVP | Confirm (affects merchants who need their own eNamad) |
| A-1 | Real gateway behaviour was never exercised (fake gateways only) | Risk until M4 sandbox runs |
| A-2 | Manual browser checks are not regression protection | Addressed by M1 |
| A-3 | `APP_ENV` changes the start-up contract of every deployment file | Must land atomically in M3 |
| A-4 | Stack description in the brief (Auth.js) does not match the code | Documented in the header |
