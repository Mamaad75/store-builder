# Phase 3: the commerce core (ADR 0002 §6, decisions D3-1..)

Owner decisions of 2026-11-22: **Zarinpal** is the payment gateway (for merchants' shoppers), **Kavenegar** is the SMS provider (the fastest
one was asked for; no independent delivery-time measurement exists, so the OTP-dedicated `verify/lookup` route of Kavenegar was chosen and the
provider sits behind a port: switching is one adapter). Customer sign-in by OTP is **built but off** until the SMS account exists. Platform
operators ("super admins") get their own accounts. The merchant dashboard is not changed by these steps (another session owns it): each step
ships the API, the storefront side and the tests; dashboard screens follow from the documented API.

| Step | Content | Status |
|---|---|---|
| 3.1 | Platform super-admins (role table, server command for the first one, `/api/v1/platform` API and the `/platform` pages, audited); platform settings for SMS, payment and AI with write-only encrypted keys; customer accounts per store; OTP sign-in (code, limits, session) through Kavenegar, **off** until switched on in the settings | done |
| 3.2 | Product variants (options such as colour/size, price and stock per variant); atomic stock decrement; temporary reservations | done |
| 3.2b | Prices linked to the dollar or 18k gold (owner request 2026-11-23): merchant links in toman or by the jewellery formula, hourly rates (Navasan or manual), held jumps confirmed by a super admin, live prices on the published storefront | done |
| 3.3 | Cart (guest and signed-in), shipping methods (flat, weight-based, free above an amount, pickup), addresses, checkout summary | planned |
| 3.4 | Orders and invoices: state machine with history, item snapshots, gap-free invoice numbers per store | planned |
| 3.5 | Zarinpal: payment state machine, server-side verify, idempotent callback, reconciliation job, per-store merchant id in the encrypted secrets (2.4) | planned |
| 3.6 | Order SMS (shopper and merchant) through the outbox and the worker; turns on with the SMS account | planned |

Every step: code + tests + reversible migration drilled on a disposable database + security review + docs + CHANGELOG, then a report.

## 3.1 design

* **Platform admins.** `PlatformAdmin(userId, role, grantedAt, grantedById)`; one role today, `SUPER_ADMIN`. A platform account is an
  ordinary user account (same sign-in) with a row here; the role is checked against the database on every request, so revoking takes effect
  at once. Nobody can grant themselves the role over HTTP: the first super admin is created on the server with
  `pnpm --filter @store-builder/api platform:admin grant <username>` (needs database access); super admins can then grant and revoke others
  (never the last one, never oneself). Every platform action is written to `AuditEvent` with `storeId` null (no new table). The super admin
  pages live at `/platform` in the web app (separate from the merchant dashboard): a signed-in user without the role gets the ordinary 404
  and the page title does not name the area. Caddy routes `/api/v1/platform/*` (the owner asked for the pages); every call needs the session,
  the Origin check and the role, re-read from the database on each request. Two-step sign-in for super admins is recommended next.
* **Platform settings (D31-3).** `PlatformSetting` (one validated JSON value per group: `sms`, `payment`, `ai`; a fresh platform reads as
  everything off) and `PlatformSecret` (the Kavenegar API key, the platform's own Zarinpal merchant id for merchant subscriptions, the AI
  API key): the same envelope encryption as store secrets (D24-1), bound to `platform|name:<name>`, write-only over HTTP (the pages show
  "set"/"not set" and the last 4 characters of long values), rotated together with store secrets by `pnpm secrets:rotate`. Without
  `SECRETS_MASTER_KEYS` the settings still save but keys cannot be stored. The AI group only stores configuration; nothing calls a model yet.
  Each store's own Zarinpal merchant id stays a store secret (phase 3.5).
* **Customers.** `Customer(storeId, phone, name, ...)`, unique per store and phone: a shopper of one store is unknown to every other store.
  Phones are Iranian mobiles normalised to `+989xxxxxxxxx` (database CHECK). Customers get their own session (separate cookie, separate
  token audience), never a merchant session. Merchants see their store's customers (`customers.view`).
* **OTP.** 6 random digits, only an HMAC is stored, valid 2 minutes, at most 5 attempts, one code per phone per minute and a cap per hour,
  a cap per IP; the same answer whether the phone is known or not. The code is sent through `SmsSender` (Kavenegar `verify/lookup`, the API
  key never logged). **Off** unless the super admin switches it on in the settings AND the template and the Kavenegar key are set (read with a
  30 s cache, no restart needed); while off the request endpoint answers 503 with a fixed Persian message and nothing is stored.
  Customer routes live under `/api/public/stores/:label/customer/*` and accept posts from that store's own origin too (and only those routes).

## 3.2 design (D32-1)

* **Variants.** A product has no variants (its own price and stock) or 1..30 (`MAX_VARIANTS_PER_PRODUCT`, at most 3000 per store). Each
  variant is one combination of 1..3 options (`[{name, value}]`, e.g. رنگ = قرمز, سایز = M); all variants of a product use the same option
  names in the same order and each combination appears once (`optionsKey`, canonical JSON, is unique per product). Text is normalised (Arabic letters,
  spaces) before comparison. SKU (optional, `[A-Za-z0-9._-]`, unique within the product) never reaches the public storefront.
* **API.** `GET /api/stores/:storeId/products/:productId/variants` (`store.view`) and `PUT …/variants` (`catalog.write`, audited
  `product.variants_replaced`) replace the whole set; `{ "variants": [] }` removes them all. The write is a store mutation (store lock,
  draft revision bump), matching combinations keep their id (and their reservations), removed ones are deleted.
* **Product price and stock follow the variants**: lowest variant price and summed stock, written in the same transaction, so lists,
  sorting and old themes keep working unchanged. While a product has variants, `PATCH` of its price or stock is refused with a clear
  message (they are edited per variant). Removing all variants leaves the last values on the product, editable again.
* **Stock model.** `stockQuantity` is the SELLABLE quantity. A reservation (`StockReservation`, for the checkout of 3.3) takes its
  quantity out at once: one transaction locks the product rows and then the variant rows in id order (the same order everywhere, so
  concurrent checkouts cannot deadlock), reads the stock, and either takes out every line or nothing (`OutOfStockError` lists every short
  line with what is left). Conditional updates (`WHERE stockQuantity >= n`) and CHECK constraints (stock >= 0) are a second line of
  defence. Only ACTIVE products are sold; a product with variants only by variant.
* **Release / consume / expiry.** `release(ref)` gives the quantities back once (idempotent); `consume(ref)` turns an unexpired hold into
  an order (3.4) and its stock never comes back; holds expire (default 15 minutes, at most 60) and the `db-cleanup` job releases expired ones
  (500 per run, one small transaction each). Removing a variant drops its active holds; giving a product its first variants drops the
  product-level holds (the product total is then the variant sum).
* **Storefront.** The published data carries `variants` per product (optional with an empty default, so old snapshots stay valid; stored
  JSON is validated and a malformed variant is left out). The 8 kit themes show a captioned table of variants with price and stock on the
  product page and an "از" (from) price on cards when variant prices differ. Stock shown on the storefront is the published value; the
  checkout (3.3) reads live stock.
* **Not built here:** dashboard screens for variants (the dashboard belongs to another session; the API above is what it calls).

**3.2 security review (2026-11-23).** No cross-store access, SQL injection or XSS found. Fixed with regression tests: the expired-hold sweep
skips (and logs) a failing row instead of stopping for every store, and give-backs are clamped to the stock bound; `consume` is all or
nothing (`expectedLines` from `reserve`; a hold that lost a line throws ReservationLostError); variant stock sums are capped at 1,000,000
(validation error instead of a server error); the combination key is JSON (no separator collisions). **For 3.3:** the checkout must pass
`expectedLines`, treat ReservationLostError as "reserve again", and use a fresh `ref` per attempt. Accepted for now: the reservation's variant FK is `variantId -> ProductVariant(id)` only (Prisma cannot express
`ON DELETE SET NULL` for one column of a composite key); every ledger query is scoped by store and the variant must belong to the line's
product. Raw SQL writes to `Product` are confined to the ledger by an architecture test and may only move `stockQuantity`.

## 3.2b design (D32b-1): prices linked to the dollar or gold

Owner choices (2026-11-23): the merchant enters today's price in toman and the system converts it; gold uses the full jewellery formula;
rates come from an Iranian API (Navasan) or are typed by a super admin; a stale or jumping rate holds the price and raises an alert, and a big
jump is applied only after a super admin confirms it.

* **Links.** `PriceLink` per product (no variants) or per variant (a product with variants is linked variant by variant; a product-level
  link and variants exclude each other). Kinds:
  * **USD:** `usdCents`. Entered as today's toman price (converted once at the current rate) or directly in dollars.
  * **GOLD:** the Iranian gold-market formula. Its inputs are weight in mg, labour %, profit %, tax % (default 9%), stones in toman and a
    rounding step. It computes: gold = weight × gram rate; labour = gold × wage%; profit = (gold + labour) × profit%;
    tax = (labour + profit) × tax%; price = gold + labour + profit + tax + stones. Alternatively a toman price is converted to the
    equivalent weight, with no labour.
  * Integer arithmetic only (BigInt), half-up rounding to 1 / 100 / 1,000 / 10,000 toman. A result above the price cap keeps the last price
    and marks the link `OUT_OF_RANGE`.
* **Who owns the price.** While linked, `PATCH` of the product price is refused, and variant replacement keeps a linked variant's price. A
  product with linked variants shows the lowest variant price. Unlinking leaves the last computed price, editable again.
* **Rates.** `ExchangeRate` is an append-only history; the current rate is the latest APPLIED row.
  * Sources: `manual` (a super admin types it in `/platform/rates`; applied at once, audited) or `navasan` (hourly job).
  * An automatic reading is **rejected** outside a plausibility band (USD 10,000..10,000,000; gold 100,000..1,000,000,000 toman per gram),
    and **held** (PENDING) when it moves more than `jumpPercent` (default 10%) from the applied rate. The very first automatic rate is
    always held. A slow drift is bounded too: a move of more than twice the threshold against the rate of 24 hours earlier is held.
    Over plain HTTP the threshold is halved.
  * A super admin confirms or rejects a held rate in `/platform/rates` (audited). A newer reading supersedes an older held one.
  * Older than `maxAgeHours` (default 6) is **stale**: prices stay on the last applied rate and sales continue.
* **Hourly job `rates-refresh`** (worker, `pnpm rates:refresh`): fetch → decide → reprice every link of every store, one transaction per store.
  * Product rows are locked by id, the same order as the stock ledger. The store lock is never taken and the draft revision never moves:
    linked prices are not merchant edits.
  * Exit 2 when a person is needed (stale, held, rejected, provider failure): the worker health turns red and the Bale alert of the worker
    fires.
* **Live prices on the storefront.** The published snapshot is immutable, so repricing also writes `LivePrice`, a public projection.
  * The public read overlays it on a COPY of the snapshot, only for products and variants that are in the published version, cached
    60 s per store. A product with variants shows the lowest of its PUBLISHED variants (computed at read time); a draft-only variant never
    counts.
  * Because a link changes the live price without a publish, creating or removing one needs the `publish` permission (owner and manager;
    not the operator).
  * Checkout (3.3) must price from the database, never from the page.
  * After unlinking, the storefront shows the published price until the next publish.
* **Navasan.** Documented as plain HTTP with the key in the query string; the free plan (120 requests/month, 2-hour updates) is not enough
  for hourly runs (Standard plan: 1,000/day). Owner actions: buying the plan and checking the unit (toman or rial) on one real answer.
  The adapter:
  * uses HTTPS by default and sends the key over HTTP only if a super admin switches "allow HTTP" on (with a warning);
  * has a fixed host and refuses redirects;
  * caps the answer at 256 KiB;
  * never puts the URL, the key or the provider's error text in an error or a log line.
* **API.**
  * Merchant: `GET /stores/:storeId/rates`, `GET …/products/:productId/price-links` (`store.view`);
    `PUT …/price-link`, `POST …/price-link/delete` (`publish`, audited).
  * Super admin: `GET/POST /platform/rates`, `POST /platform/rates/:rateId/confirm|reject`, and the settings group `rates` with the
    secret `rates.navasan.api_key`.
  * The merchant dashboard screens are not built here (the dashboard belongs to another session).

**3.2b security review (2026-11-24).** No cross-store access, injection or XSS found. Fixed with regression tests:
* linking needs `publish` (a link changes the live price without a publish);
* the live lowest-variant price comes from the published variants only;
* live rows of removed variants go at once, and leftovers go in the next run;
* a failing store is isolated and reported (exit 2);
* slow drift is held, and the HTTP threshold is halved;
* the provider answer is cut while streaming;
* rates are read under the product locks.
* a second review added more checks: removing a linked variant needs `publish`; automatic readings stay within 3x the threshold of the last rate a person confirmed; the cleanup of leftover live rows is best effort.

Accepted for now: a super admin's manual entry or confirmation reprices inside the request (stores are isolated; the hourly run catches
up).

## 3.1 security review (2026-11-23) and what it leaves for later

No path to super admin escalation was found. Fixed with tests: a global per-phone cap across stores (10/h, 20/day) and a platform-wide SMS
budget (600/h) on top of the per-store cap, IPv6 limits keyed by /64; grant and revoke re-check the ACTOR inside the locked transaction
(an operator revoked meanwhile gets PlatformForbiddenError); obviously internal AI addresses (localhost, single-label names, private and
link-local IPs) are refused at save time.

**Requirements before production** (phase 4 gate, not optional):
1. Two-step sign-in for super admins (WebAuthn or TOTP) and re-authentication for grant/revoke and for changing platform secrets; a notice
   to every super admin when one of those happens; if possible an IP allowlist on `/platform` and `/api/v1/platform/*` in Caddy.
2. The AI client (when it is built) resolves the host and refuses private, loopback and link-local addresses at CALL time, with no
   redirects and a timeout; preferably an allowlist of provider hosts.
3. Store hosts: when the storefront gets the customer sign-in screens, Caddy routes ONLY `/api/public/stores/<that label>/customer/*` on a
   store host (the customer cookie then lives on the store's own host).
4. A cheap challenge (CAPTCHA or proof of work) after a threshold of code requests, and an alert on repeatedly exhausted codes (mobile
   CGNAT shares IPs; a known phone can be locked out for an hour today).
