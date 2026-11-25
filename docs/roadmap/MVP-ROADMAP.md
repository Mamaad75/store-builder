# Store Builder — MVP roadmap (product-first, security proportional to release risk)

* **Status:** **approved direction** (owner, 2026-11-24) with the decisions in §0. Documentation only; implementation starts after the
  owner approves the first M1/M2 tasks (§11).
* **Inspected:** branch `claude/confident-davinci-mcf5d0`, commit `961c804`.
* **Relationship to other documents:**
  * `docs/roadmap.md` (historical phases 1–15) and ADR 0002 §6 (phases 1–7) remain the record of what was done.
  * This document orders the remaining work.
  * ADR 0005 decisions are preserved unchanged. Only their **timing** is proposed here.
* **Correction to the brief:** the stack does **not** use Auth.js. Authentication is the project's own HS256 session token issued by the NestJS API (`apps/api/src/auth/*`, ADR 0001); there is no `next-auth` / `@auth/*` dependency.

---

## 0. Owner decisions (2026-11-24)

| ID | Decision | Status |
|---|---|---|
| Direction | Complete the product first; implement the security controls each release genuinely requires | Approved |
| Order | M1 → M2 → M3 → M4 → M5 → M6 → M7; M1 and M2 in parallel where safe; **M3 before any real money** | Approved |
| **D-PILOT** | A limited, invited pilot may run before phone verification, recovery and cooling-off (M6), **only** under the conditions in ADR 0005 §18 (M3 done, invited merchants only, limited scale and exposure, OWNER-only payouts, manual admin recovery review, immediate stop, no sensitive capability without its controls) | **Conditionally approved** |
| **D-STAGING-SMS** | Staging sends no real SMS; development OTP logging is **not** enabled on staging; automated tests use mocked senders; Kavenegar and real delivery are deployment-stage tasks (ADR 0004) | Approved |
| **D-PILOT-BILLING** | The pilot is free; billing is implemented and tested before charging merchants | Approved |
| **D-DOMAINS** | Platform subdomains suffice for the MVP and pilot; custom domains after MVP **provided** they do not block gateway activation, eNamad or other legal/operational requirements — investigation in §0.1 | **Conditionally approved** |

### 0.1 D-DOMAINS investigation (status: open, not finalised)

| Question | What the code shows | External status | Consequence |
|---|---|---|---|
| Can a merchant activate Zarinpal / Aghaye Pardakht for a store on `<label>.<platform domain>`? | The return address is the store subdomain (`http(s)://<label>.<root>/checkout/payment/return`, shown to the merchant in payment settings) | **Needs provider consultation** (checklist P1–P2): whether a terminal's registered site may be a subdomain of a store builder, and whether the merchant must own the domain | If not allowed, pilot stores use **COD and card-to-card only** until custom domains exist; online payment stays off for them |
| Does a merchant need eNamad on their own domain to get a gateway? | — | **Needs consultation** (checklist L4) | Same as above |
| Platform's own eNamad (on the platform domain) | — | **Needs consultation** (checklist L3) | Required before public launch if confirmed; not a pilot blocker for COD |
| Other operational needs (Torob/Emalls listing per domain) | Not built | Post-MVP | None for the pilot |

**Rule until answered:** the deferral of custom domains is provisional. The pilot does not depend on online payment; if providers
require own domains, custom domains move before G-PUBLIC (or before enabling online payment for affected merchants).

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

### M1 — Commerce journey locked down (quality) — **implemented (2026-11-25); CI 3× pending**
* **Objective:** prove the money path works end to end and keep it working.
* **Value:** confidence to demo and pilot; protects every later change.
* **Features:**
  * Playwright specs covering: cart, checkout with COD, merchant confirm / ship / deliver; card-to-card with receipt upload and merchant approval; online payment against the local fake gateway (`ZARINPAL_DEV_BASE_URL`); discount code at checkout; shopper order page on an unpublished and a suspended store.
  * Add e2e typecheck to CI.
* **Current status:** implemented: `apps/e2e/e2e/checkout.spec.ts` (COD, card-to-card, discount, offline/suspended), `apps/e2e/e2e-payments/online.spec.ts` on the isolated stack (§12.1), e2e typecheck in `pnpm typecheck`. CI: runs 110, 111, 112 green; run 110 and 111 had 0 flaky retries, run 112 had **1 flaky retry** (`e2e/publishing.spec.ts:47`, a pre-existing page-editor spec: «بخش حذف شد.» not visible within 15 s on the first attempt). The DoD (three consecutive green runs with zero flaky retries) is **not met**; the count restarts.
* **Dependencies:** none.
* **Security controls:** none new; the specs include the isolation checks (another store's token → 404).
* **Tests:** the new E2E specs; existing suites unchanged.
* **Technical constraint found:** the E2E API runs as a production build with `NODE_ENV=production`
  (`apps/e2e/playwright.config.ts:41-58`). The local fake gateway (`ZARINPAL_DEV_BASE_URL`) is refused outside development/test
  (`apps/api/src/config/env.ts:231-236`), and gateway credentials need `SECRETS_MASTER_KEYS` (not set for E2E). The production refusal
  must **not** be weakened. Online-payment E2E therefore needs a separate, test-only API instance (`NODE_ENV=test`, test master key,
  fake gateway on loopback) used only by the payment spec, or it stays covered by the existing DB tests. Decision recorded in §11.
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
* **Current status:** implemented (2026-11-25): `GET /api/stores/:storeId/overview`; rules in `packages/shared/src/modules/orders/overview.ts`;
  dashboard section `apps/web/src/components/orders/StoreOverview.tsx` on the store home; DB tests `overview.db.test.ts`; E2E `overview.spec.ts`.
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
* **Deferred:** Kavenegar (production only, ADR 0004). **D-STAGING-SMS (Approved):** staging sends no SMS, development OTP logging is
  not enabled there (it is refused anyway under `NODE_ENV=production`), order SMS are recorded as skipped, and SMS behaviour is covered
  by automated tests with mocked senders.

### M5 — Limited invited pilot (G-PILOT)

**Pilot controls that do not exist today (verified) and must ship in M5, before the first invited merchant:**
* **Invite-only registration:** `POST /api/auth/register` is public (`apps/api/src/auth/auth.controller.ts`); a platform switch that
  closes public sign-up plus single-use invitation codes issued by a SUPER_ADMIN.
* **Administrator-assisted recovery:** no tool exists to reset a merchant's password. A server-side command (like
  `pnpm platform:admin`) that sets a temporary password, bumps `authVersion` (all sessions end) and writes an audit row; used only after
  the out-of-band identity check of ADR 0005 §18.
* **Exposure limits:** see ADR 0005 §18 (number of stores, payment methods, per-order cap decision).
* **Immediate stop:** exists — per-store suspension (ADR 0003 G2) and the platform payment switches; add a documented "stop the pilot"
  runbook step.

The original M5 text follows.

### M5 (original text) — Pilot (G-PILOT): first real merchants
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
| D-PILOT | Pilot before M6 | **Conditionally approved** (§0, ADR 0005 §18) |
| D-STAGING-SMS | No real SMS on staging | **Approved** |
| D-PILOT-BILLING | Free pilot | **Approved** |
| D-DOMAINS | Subdomains for MVP | **Conditionally approved**; provider/legal questions open (§0.1) |
| D-PILOT-CAP | Per-order amount cap during the pilot (implementation) or an operational limit only (monitoring)? | **Pending** |
| D-E2E-PAY | Online-payment E2E through a separate test-only API instance, or keep online payment covered by DB tests only | **Pending** (recommended: separate instance) |
| A-1 | Real gateway behaviour was never exercised (fake gateways only) | Risk until M4 sandbox runs |
| A-2 | Manual browser checks are not regression protection | Addressed by M1 |
| A-3 | `APP_ENV` changes the start-up contract of every deployment file | Must land atomically in M3 |
| A-4 | Stack description in the brief (Auth.js) does not match the code | Documented in the header |

---

## 11. First implementation tasks (awaiting approval)

### M1 — Purchase-flow E2E reliability

1. **M1-1 Test fixtures:** an E2E helper that creates a published store through the real API (owner, product with stock, shipping method
   with cash on delivery, subdomain, publish) and a shopper browser context on `<label>.localhost:3100`. Reuse `apps/e2e/e2e/helpers.ts`;
   no direct DB writes except reading results.
2. **M1-2 COD journey spec** (`e2e/checkout.spec.ts`): add to cart → cart page → checkout with address and shipping → place COD order →
   order page with access token → merchant dashboard confirms, ships, delivers → shopper sees each status; stock decremented once.
3. **M1-3 Card-to-card spec:** owner adds a bank card → shopper orders with card-to-card → sees card and amount → uploads a receipt image →
   merchant approves → order becomes PLACED; a second store's label with the same token → 404.
4. **M1-4 Discount spec:** a percentage code applied at checkout → line and total shown → order snapshot shows the discount; an invalid
   code shows the error and blocks ordering.
5. **M1-5 Offline-store order access spec:** merchant unpublishes → shopper order link still works with the notice; platform suspends →
   order page works, card numbers hidden, storefront 404.
6. **M1-6 CI typecheck for e2e:** add `@store-builder/e2e` typecheck to the root `typecheck` script (CI runs it).
7. **M1-7 Online payment (after D-E2E-PAY):** test-only API instance with the fake gateway, or document the DB-test coverage.

Acceptance: specs green in CI three consecutive runs; no existing test removed or weakened; no production configuration rule relaxed.

### M2 — Merchant sales overview

1. **M2-1 Aggregation service + endpoint** `GET /api/stores/:storeId/overview` (`orders.view`): orders and revenue for today / 7 days /
   30 days (paid or COD orders counted by an explicit rule, cancelled/expired excluded), counts of receipts awaiting review, orders
   PLACED (to confirm) and CONFIRMED (to ship), products with low stock (threshold constant). Store-scoped SQL; no new table.
2. **M2-2 Contract, schema, OpenAPI** entries.
3. **M2-3 DB tests:** numbers match seeded orders across statuses and dates; other store's data excluded; OPERATOR refused (403),
   stranger 404; suspended store still readable (GET).
4. **M2-4 Dashboard home section** on `/dashboard/stores/[storeId]` showing the figures and links to the filtered lists; empty state for
   new stores.
5. **M2-5 E2E:** after M1-2's order, the overview shows one order and its revenue.

Open product choices for M2 (defaults if not decided): revenue counts delivered + confirmed + shipped + placed paid orders (not
cancelled/expired/awaiting payment); low-stock threshold 3.

---

## 12. Clarifications approved for M1/M2 (owner, 2026-11-24)

### 12.1 D-E2E-PAY — isolated online-payment test stack (Approved)

**Configuration (compatible with D-19; no production rule changed):**

| Part | Setting |
|---|---|
| Fake gateway | A loopback-only Node HTTP server started by Playwright (`127.0.0.1`, fixed test port), implementing only the Zarinpal v4 paths the adapter uses (`/pg/v4/payment/request.json`, `verify.json`, `inquiry.json`, `/pg/StartPay/:authority` → redirect to the callback with `Authority` and `Status=OK`). It accepts only one fixed **test** merchant id and moves no money. |
| Test API | Second API process with `NODE_ENV=test`, bound to `127.0.0.1`, own port, `ZARINPAL_DEV_BASE_URL=http://127.0.0.1:<fake port>` (accepted only because `NODE_ENV` is `test`, `config/env.ts:231-236`), test-only `AUTH_SECRET`, test-only `SECRETS_MASTER_KEYS` / `SECRETS_ACTIVE_KEY_ID` generated for the suite (not a secret, never reused). |
| Test database | Its own database whose name ends in `_e2e` (the global setup refuses any other name), created and migrated by the suite. |
| Test web | Second standalone web server on its own port, bound to loopback, pointing only at the test API. |
| Payment platform setting | Zarinpal enabled with `sandbox: true` in the **test** database only. |

**Why this does not weaken D-19:** the existing production rule (`ZARINPAL_DEV_BASE_URL` refused unless `NODE_ENV` is `development`
or `test`) is used as is. Under the future `APP_ENV` rule (ADR 0005 §17.2) this stack runs as `APP_ENV=test`. Production keeps
rejecting fake gateways (`ZARINPAL_DEV_BASE_URL` / `AQAYEPARDAKHT_DEV_BASE_URL`) unconditionally. The main E2E stack keeps running the production build with
`NODE_ENV=production`. No environment rule needs to change, so none is proposed.

**Correction (M1 implementation):** production does **not** yet refuse sandbox *mode*: a SUPER_ADMIN can still switch
`payment.sandbox` on (finding V0-4). Refusing it categorically is D-19, scheduled in M3 (payment safety core, pilot gate B),
and is **not** part of M1/M2. The test stack neither depends on nor changes that gap.

**Not exposed:** the test API and the fake gateway bind to `127.0.0.1`; nothing is published outside the CI job or the developer's machine.

**As implemented (M1-7):** `apps/e2e/playwright.payments.config.ts`, `apps/e2e/e2e-payments/`, `apps/e2e/src/fake-zarinpal.mjs`;
run with `pnpm test:e2e:payments` (CI: a separate step after the main E2E suite). Deviations from the plan above, each for a concrete reason:

* **Same ports as the main stack, run one after the other** (not a second web on another port): the web build fixes its `/api/*` proxy
  target at build time (`next.config.ts` rewrites), so a second web server would still have talked to the main API. Found when the
  first attempt's merchant calls were refused by the main API (403) — it failed closed.
* **The web binds like the main E2E web (`0.0.0.0`)**: the Next standalone server's host-based store routing answers 404 for every store
  host when bound to `127.0.0.1`. The web holds no secret and no gateway access. CI runners accept no inbound connections.
* **Browser-side route for the payment page:** the production web build sends the browser only to the real gateway hosts
  (`client/shop.ts` `goToGateway`) and refuses a loopback one. The test shows the browser the real sandbox address and serves it from
  the fake (Playwright `page.route`, in place of DNS/TLS). The web's allow-list runs unchanged; server-to-server request/verify calls go to
  the fake through `ZARINPAL_DEV_BASE_URL`.
* **Fake gateway port 4180** (not 4190: on the Fetch standard's blocked-port list).

### 12.2 D-PILOT-CAP — server-side pilot order limit (Approved; implemented in M5, not now)

* Platform setting `pilot.maxOrderTotalToman` (integer or `null` = no limit), edited only by SUPER_ADMIN in `/platform/settings`.
  Changes are audited by the existing `platform.settings_updated` row, with before/after values (as D-19 requires for settings).
* `OrdersService.place` refuses an order whose server-computed total exceeds the active limit with a domain error (`422`) **before** stock
  is reserved; the check also covers online and card-to-card orders. The storefront shows the message; the UI is not the control.
* **Initial value: PENDING (owner).** No amount is assumed.

### 12.3 Pilot admin-assisted recovery (specification for M5; follows D-10, D-20)

* No unrestricted password-reset command. A platform route `POST /api/v1/platform/users/:userId/recovery` for SUPER_ADMIN only, with the
  admin's password re-entered (D-20), a required reason, and an attestation that identity was checked **outside** the application
  (D-10, ADR 0005 §18.2).
* One transaction: issue a single-use, short-lived recovery link (or temporary password that must be changed at the next sign-in), bump
  the merchant's `authVersion` (every previous session ends), write the platform audit row `platform.account_recovered`
  `{ userId, reason }`. Never log or store the temporary credential in clear.
* Notify the account owner (in-app; SMS once V1 provides a verified phone and production SMS exists, ADR 0004).
* When cooling-off exists (M6), recovery is a qualifying event (D-24).

### 12.4 M2 metrics — exact rules (**approved by the owner 2026-11-25**, implemented)

Facts in the schema: `OrderStatus = AWAITING_PAYMENT | PLACED | CONFIRMED | SHIPPED | DELIVERED | CANCELLED | EXPIRED`;
`OrderPaymentMethod = COD | ONLINE | CARD_TRANSFER`. Invariants in the code: an ONLINE order becomes `PLACED` only in the transaction that
records a verified gateway payment (D35-1); a CARD_TRANSFER order becomes `PLACED` only when the merchant approves a receipt (D35b-1).

| Metric | COD | ONLINE | CARD_TRANSFER |
|---|---|---|---|
| **Order value** (valid orders) | status ∈ PLACED, CONFIRMED, SHIPPED, DELIVERED | same (implies verified payment) | same (implies approved receipt) |
| **Paid revenue** (money received and verified) | status = DELIVERED (cash collected on delivery; the merchant's "delivered" is the only signal available) | status ∈ PLACED…DELIVERED | status ∈ PLACED…DELIVERED |
| **Pending payments** | status ∈ PLACED, CONFIRMED, SHIPPED (to be collected on delivery) | status = AWAITING_PAYMENT (awaiting the customer) | status = AWAITING_PAYMENT, split into "receipt awaiting your review" (a SUBMITTED receipt exists) and "awaiting the customer" |

* **Excluded everywhere:** `CANCELLED` and `EXPIRED`. A cancelled order whose money was already received is not counted as revenue (the
  merchant owes it back); payments in `REFUND_REQUIRED` are never revenue. A separate "refunds owed" figure is post-MVP.
* **Amount:** `Order.total` (after discount, including shipping and the COD fee).
* **Periods:** today, last 7 days, last 30 days, by order creation time, with day boundaries in `Asia/Tehran`.
* **Action items:** receipts awaiting review, orders `PLACED` (to confirm), orders `CONFIRMED` (to ship).
* **Low stock (Approved):** ACTIVE products whose stock is **3 or fewer** (for a product with variants, any variant at 3 or fewer), up
  to 10 listed.
* **Confirmed (2026-11-25):** COD counts as paid only at DELIVERED; a merchant who marks delivery late shows late revenue.
* **Implementation notes:** pending payments are the money still expected **whatever the order date** (not per period); "receipts to
  review" counts card-to-card orders awaiting payment with a SUBMITTED receipt (its link opens the order list with
  `?review=receipt`, the same condition); low stock lists at most 10 of the lowest (product stock, or its lowest variant), with the exact total.
* **Verification (2026-11-25):**
  * **Refunds — data-model gap (not implemented, needs a decision).** The schema has no record of a *completed* refund: no refunded
    status, amount, date or partial-refund field on `Order` or `Payment`. `REFUND_REQUIRED` (on a `Payment` attempt) only means "captured
    money the merchant must return"; nothing marks it returned. Consequences, all by design of the current data and covered by tests:
    * REFUND_REQUIRED money is never revenue: the overview counts `Order.total` once per order and never reads `Payment` amounts, so a
      duplicate capture on a paid order is not counted twice, and a capture on an expired/cancelled order is not counted at all.
    * Completed refunds cannot be deducted (none are recorded); partial refunds are not supported by the schema; double deduction is
      impossible because nothing is deducted.
    * An order **paid and then cancelled** (merchant: PLACED/CONFIRMED → CANCELLED; customer: PLACED → CANCELLED) drops out of order value
      and paid revenue for its period. Historical reports therefore do not show "received then refunded" money, and whether the merchant
      actually refunded is unknown. The dashboard states this.
    * Closing this needs an owner decision on a refund record (state, amount, date, who), i.e. a schema change — not done here.
    * **Owner decision (2026-11-25):** M2's timezone, receipt filter, layout and approved metric rules are accepted. Until refund records
      exist, the dashboard shows **gross** paid revenue only, never calls it net, and states that completed refunds are not deducted.
      The refund data model is in `docs/adr/0006-refund-records.md`: core architecture and D-REF-1..9 approved; revision 3 (adjustment
      mechanism for D-REF-10, lock ordering, invariant under concurrency, legacy-backfill provenance) awaits review. Not implemented.
  * **Dates:** periods start at Tehran midnight (fixed UTC+03:30), inclusive of the first millisecond; checked against the IANA
    `Asia/Tehran` zone for every hour of 2024-2027 (a future clock-rule change fails the test) and on real PostgreSQL at the exact
    boundaries. Paid revenue is grouped by **order creation date**, not payment date (tested); the dashboard says so.
