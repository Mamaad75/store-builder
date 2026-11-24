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
| 3.3 | Cart (guest and signed-in), shipping methods (flat, weight-based, free above an amount, pickup; owner 2026-11-24: per-province prices and cash on delivery), addresses (province list + postal code), checkout summary | done |
| 3.4 | Orders and invoices: state machine with history, item snapshots, gap-free invoice numbers per store (cash on delivery until 3.5) | done |
| 3.5 | Zarinpal: payment state machine, server-side verify, idempotent callback, reconciliation job, per-store merchant id in the encrypted secrets (2.4); then card-to-card (D35b-1) and a gateway registry with Aghaye Pardakht (D35c-1) | done |
| 3.6 | Order SMS (shopper and merchant) through the outbox and the worker; turns on with the SMS account | done |

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

## 3.3 design (D33-1): cart, shipping, addresses, checkout summary

Owner decisions of 2026-11-24: guests can check out (the mobile is verified by OTP once SMS is on); shipping gets per-province prices and
cash on delivery; the cart lives in the database; addresses use a province list and a postal-code check.

* **Cart.** `Cart(storeId, tokenHash, customerId?)` and `CartItem(cartId, productId, variantId?, quantity)`; one line per product/variant
  (`lineKey`, CHECKed against the ids), 1..1000 units, at most 50 lines (`MAX_CART_LINES`, the same as one stock hold). A line's variant is
  tied to the line's own product by a composite foreign key.
  * A guest gets a random 256-bit token in an httpOnly, SameSite=Lax cookie (`__Host-sb_cart` over https, 30 days); only its SHA-256 is
    stored. A malformed token is never looked up.
  * Signed in (customer cookie of THIS store): the customer's cart is used and the device's guest cart is folded into it (quantities add up,
    capped; both carts locked in id order). Without a session only guest carts are visible, so after signing out the next person on the
    device does not see the customer's cart.
  * Only products and variants of the PUBLISHED version can be added; a product with variants needs one. Removing is always allowed.
    Every change runs in one transaction with the cart row locked.
  * New GUEST carts are rate limited per client network (IPv6 by /64): 120 per hour per store and 1000 per hour across the platform,
    generous because many shoppers share one IPv4 address behind mobile carrier NAT. Adding to an existing cart is not limited, and a
    signed-in customer has at most one cart (a partial unique index; concurrent first adds land in the same cart). Carts untouched for
    30 days are deleted by `db-cleanup` (lines cascade; a product or variant deleted from the catalog leaves every cart the same way).
  * No stock is held by a cart. The order step (3.4) reserves stock with the 3.2 ledger; until then the cart shows shortages.
* **Prices.** No price is stored in a cart and none is accepted from a page (unknown fields are refused). Every view prices from the
  published snapshot with live gold/dollar prices applied (the same numbers the storefront shows) and reads two facts from the stock rows:
  status and sellable quantity (an architecture test pins those columns). A line that cannot be bought keeps its reason
  (`unavailable`, `choose_variant`, `out_of_stock`, `not_enough_stock`) and counts in no total.
* **Shipping methods** (`ShippingMethod`, at most 20 per store, `GET`/`PUT /api/stores/:storeId/shipping-methods`; `store.settings`,
  audited `store.shipping_methods_replaced`). An operational setting like stock: it applies to checkout at once, without a publish.
  * FLAT: the province price, else the base price. WEIGHT: the (province) price covers the first kilogram, `perKg` each further started
    kilogram; units without a weight count `defaultItemGrams`. PICKUP: always free (CHECK).
  * `provinces` ([] = all of Iran), `freeAbove` (on the subtotal of buyable lines), cash on delivery (on/off, provinces, fee).
  * Stored rows are re-validated when read; a row the rules no longer accept is left out of checkout and logged.
* **Product weight.** `Product.weightGrams` (nullable, 0..1,000,000, CHECK), set through the product API and published in the snapshot
  (older snapshots read as null). Variants share their product's weight.
* **Addresses.** Iran's 31 provinces (`packages/shared/src/modules/checkout/provinces.ts`, stable codes; the database checks the shape). City
  suggestions per province, but the city is free text (a town that is not listed must still be deliverable). Postal code: 10 digits,
  Persian/Arabic digits accepted, ten identical digits refused (deliberately lenient: a stricter rule that rejected one real code would cost
  a sale). Mobile in E.164 (CHECK). Signed-in customers save up to 10 (`/customer/addresses`, 401 without a session of this store);
  guests type theirs at checkout.
* **Checkout summary** (`POST /api/public/stores/:label/checkout/quote`; a POST so the address never appears in a URL). Read-only. Takes a
  typed address or a saved one (`addressId`, the signed-in owner only), a shipping method and cash on delivery; returns the priced lines, the
  methods offered for the province with their cost, the total and `ready` plus the `blockers` in the order the shopper should fix them.
* **Routes and origins.** Public routes under `/api/public/stores/:label/` (`cart`, `cart/items`, `checkout/quote`,
  `customer/addresses`); a store that is not live is the same 404 as a missing one; responses are `no-store`. Posts are accepted from the
  platform's origins and from that store's own origin only (the 3.1 rule, widened to these routes).

For 3.4 (orders): reserve stock with the ledger when the order is placed, re-price at that moment (the live-price cache is 60 s), and store
the item and address snapshot in the order; the cart is emptied only after the order exists. Order money must be stored as BigInt: a cart
subtotal can reach 50 x 1000 x 1,000,000,000 toman, beyond a 32-bit Int (shipping is capped at MAX_PRICE_TOMAN).

**Security review 3.3 (2026-11-24):** no Critical or High findings. Fixed with regression tests: the new-cart limit was per network across
the platform (shoppers behind a shared carrier-NAT address could be blocked everywhere) and now applies per store, to guests only;
concurrent first adds could give a customer two carts (now one, by a partial unique index); weight shipping at extreme values lost integer
precision (now capped); two CHECKs were tightened (NULL province entries, a line's variant tied to its product).

## 3.4 design (D34-1): orders and invoices

* **Placing** (`POST /api/public/stores/:label/checkout/orders`; body: `requestKey`, a typed address or a saved `addressId`,
  `shippingMethodId`, `paymentMethod: "COD"`, optional `note`). Prices, shipping and totals are recomputed by the checkout module exactly
  like the summary (3.3); a summary that is not `ready` orders nothing (422 with the blockers).
  1. The stock is held with the 3.2 ledger under the new order id (10 minutes; all lines or none: 409 with the short lines).
  2. ONE transaction: the hold is consumed (all lines, unexpired, or nothing), the per-store counter row (`StoreCounter`) gives the next
     number, the order, its items, its first history entry and the `order.placed` outbox event are written, the cart is emptied.
  3. Any failure releases the hold; a process that dies between 1 and 2 leaves a hold that `db-cleanup` releases when it expires.
  * The order number is gap-free per store (the counter row is locked until commit; a rollback leaves no gap) and is the invoice number.
  * `requestKey` (16..64 characters, made once per checkout page by the client) makes placing idempotent: the same key returns the same
    order and token; two simultaneous submits produce one order (unique per store) and the loser's hold is released.
  * Rate limits per store: 20 orders per hour per client network, 10 per day per phone (fake cash-on-delivery orders tie up stock).
* **The snapshot.** Items keep the name, option text, unit price, quantity, line total and weight as they were; the address, the shipping
  method's name, kind and cost, the cash-on-delivery fee, subtotal and total are stored with the order. Money is BigInt (CHECKs: line total
  = unit price x quantity, total = subtotal + shipping + fee). The customer id has no foreign key: the order outlives changes to it.
* **Life cycle.** PLACED -> CONFIRMED -> SHIPPED -> DELIVERED; CANCELLED from PLACED or CONFIRMED by the merchant, from PLACED by the
  shopper. Every change locks the order row, appends to `OrderEvent` (who, when, note) and records `order.status_changed`; a
  cancellation gives the stock back in the same transaction (consumed reservations become released; a line whose variant is gone, or
  whose product now sells only by variant, gets no stock back). The order SMS of 3.6 consumes the two events.
* **Following.** Guests get an access token when placing (HMAC-SHA256 of the order id under a key derived from the server secret; only
  its SHA-256 is stored): `GET/POST .../checkout/orders/:token[/cancel]`. Signed-in customers: `.../customer/orders[/:id[/cancel]]`.
  Responses are `no-store`.
* **Merchants.** `GET /api/stores/:storeId/orders` (newest first, `status` filter, keyset `before`), `GET .../orders/:orderId`,
  `POST .../orders/:orderId/status` (audited `order.status_changed`). New permissions `orders.view` and `orders.manage`: owner and
  manager (orders carry name, phone and address).
* **Payment.** Cash on delivery only (`paymentMethod: "COD"`); online payment (Zarinpal) adds its states in 3.5.

**Security review 3.4 (2026-11-25):** no Critical or High findings. Fixed with regression tests:
* the `requestKey` is now bound to the shopper (the customer, else the cart cookie) with a server key, so the same key from anyone else
  never returns someone else's order or token;
* a store-wide ceiling of 200 orders per hour on top of the per-network and per-phone limits (guest phones are not verified while SMS is
  off, so rotating numbers could otherwise tie up a store's stock with fake cash-on-delivery orders);
* a cancellation gives stock back only to variants that still exist for that product (locked after the products);
* a double submit that loses the stock race returns the order the first submit placed instead of "out of stock".

Accepted for now, with a plan: guest cash-on-delivery orders are not phone-verified until SMS is on (3.6 can require an OTP for guest
COD orders, and a merchant setting can cap units per order); PLACED orders do not expire (the merchant cancels by hand; an automatic
cancel of unconfirmed orders after N days is a merchant setting for later); order links are HMACs of the order id under the server secret,
so rotating that secret invalidates links already sent (a key version will be added before the first rotation).

## 3.6 design (D36-1): order SMS

Owner decisions (2026-11-24): the shopper gets an SMS when the order is placed (or paid), shipped, cancelled by the store or expired, and
when a card-to-card receipt is rejected; the merchant gets one for each new order and each receipt waiting for review; the platform's
Kavenegar account pays; each store has a monthly cap and can turn order SMS off.

* **Path:** the order events already in the outbox (`order.placed`, `order.status_changed` now with the `actor`, and the new
  `order.receipt_submitted` / `order.receipt_rejected`) are consumed by the worker's notifications consumer. `kindsForEvent` maps an event to
  message kinds (a shopper's own cancellation sends nothing). Messages are Kavenegar **verify/lookup templates** approved in the platform's
  panel, one per kind (platform settings, `sms.orderSms.templates`; an empty name = that message is off): token = order number, token2 =
  the order link (shopper) or the total in toman (merchant), token10 = store name (at most 5 spaces). Nothing else (no address, no items).
* **Once per event and kind:** every decision is one `SmsMessage` row keyed by (event id, kind): claimed PENDING under the store row's lock
  (which also serialises the monthly count), then SENT or FAILED; skipped ones (platform/store off, no template, no phone, no key, cap)
  are SKIPPED with a reason. A re-delivered event finds the row and sends nothing; a FAILED send makes the handler throw and the queue
  retries only that kind. A worker crash between send and mark leaves PENDING: never resent (at most once beats a double SMS).
* **Cap and switches:** `sms.orderSms.enabled` (platform), `monthlyCapPerStore` (default 500 per calendar month, UTC), and the store's
  own switch and merchant mobile (`StoreSmsSetting`, dashboard "پیامک سفارش", `store.settings`, audited) with this month's usage.
* **Worker configuration:** the worker now needs the API's `AUTH_SECRET`, `APP_ROOT_DOMAIN`, `APP_PROTOCOL` (order links) and the secrets
  master keys (the Kavenegar key is a platform secret); the production compose file already gives it the API's environment. Development:
  `ORDER_SMS_DEV_LOG=true` writes the kind, the template, the masked phone and the order number to the log instead of sending.
* **Personal data:** `SmsMessage` holds no phone and no text (only a SHA-256 of the recipient for the daily limit); logs carry masked phones
  only; the order link (it contains the guest access token) goes only to the order's own phone (and through Kavenegar: a third-party
  processor to name in the privacy notes).
* **Security review (2026-11-24), fixed with tests:** guest phones are not verified, so a fake-order flood could send SMS to any number
  or use up a store's quota: one phone gets at most 6 SMS a day from the platform across all stores, and the monthly cap is counted
  separately for shopper and merchant messages. The store name is stripped of links, domains, e-mails and digits before it goes into an
  SMS (no phishing from the platform's line). A link too long for a Kavenegar token is never cut (skipped, `link_too_long`); SMS links use
  the short `/o/<token>` form of the order page. A timeout or network error counts as sent ("uncertain") and is never retried; only a 5xx
  is. Messages that no longer fit the order (e.g. "placed" after it expired) are skipped (`stale`); the merchant gets no "new order" SMS
  for a card-to-card order they approved themselves. Counts use advisory locks (never the Store row checkouts share). Known and
  accepted: the merchant's own mobile is not OTP-verified (owner/manager only, audited); `SmsMessage` has no retention job yet; rolling
  back to a build before 3.6 makes the stored "sms" group unreadable there (customer OTP falls back to off until re-saved).

## 3.5 design (D35-1): online payment with Zarinpal

Read from Zarinpal's own documentation (REST v4, 2026-11-24). No SDK: the official `zarinpal-node-sdk` adds axios; the four calls are plain
`fetch` in `apps/api/src/modules/orders/infrastructure/zarinpal.ts` (fixed hosts `payment.zarinpal.com` / `sandbox.zarinpal.com`, HTTPS,
redirects refused, 15 s timeout, answers capped at 64 KiB, both error shapes parsed, no provider text or merchant id in errors or logs).

* **Who gets the money:** each store's OWN Zarinpal terminal. The merchant id is the store secret `payment.zarinpal.merchant_id`
  (envelope-encrypted, write-only, D24-1), set on the dashboard page "پرداخت آنلاین". Online payment is offered only when the platform
  switch `payment.zarinpalEnabled` is on AND the store's merchant id is a well-formed UUID. `payment.sandbox` sends every payment to the sandbox.
* **Order life:** an ONLINE order is placed like a COD one (same pricing, stock consumed, cart emptied, no COD fee) but starts
  `AWAITING_PAYMENT` with `paymentDeadline` = now + 20 min and **no** `order.placed` event. It becomes `PLACED` (actor SYSTEM, history
  note, `order.placed`) only in the transaction that records a verified payment, or `EXPIRED` (stock back) 15 min after the deadline.
  Shoppers and merchants may cancel it while unpaid, except while a payment is being verified (409).
* **Paying:** `POST checkout/orders/:token/pay` (guests) or `customer/orders/:id/pay` opens a session: amount = the order's stored total
  × 10 in **rial** (`currency: IRR`; never a client value), `metadata.auto_verify = false`, `order_id` = order number, the mobile, and
  `callback_url = <protocol>://<label>.<root>/checkout/payment/return`. Its domain must be the domain registered for the merchant's terminal
  (Zarinpal error -14); the settings page shows it. At most 5 attempts per order, only before the deadline, rate limited per network.
* **Return:** the page posts `{authority, status}` to `checkout/payments/verify`. `Status=NOK` changes nothing (a forged NOK must not
  cancel a real payment). `OK` only triggers a server-side verify: the attempt (looked up within this store) is **claimed** under the order
  row lock (Order → Payment, one verification per order at a time, only while the order awaits payment), verified with the STORED amount,
  then settled: 100/101 with a reference → PAID + order PLACED in one transaction; -50/-54 → that attempt FAILED (the order stays
  payable); anything else → back to CREATED, checked again later. A partial unique index allows one PAID payment per order.
* **Reconciler** (`payments-reconcile`, every 5 min, `pnpm payments:reconcile`): CREATED attempts older than 2 min are asked about
  (`inquiry`): PAID/VERIFIED → verify and settle; FAILED/REVERSED → FAILED; IN_BANK/no answer → next run. Verifications interrupted for
  3 min are resumed (101 counts as paid). Attempts of orders already paid, cancelled or expired are closed WITHOUT verifying (unless a
  verify answer was lost), so Zarinpal returns that money to the buyer by itself. Unpaid orders 15 min past their deadline get a last
  check of their attempts and expire (stock back).
* **Security review (2026-11-24), all fixed with regression tests** (`payments.db.test.ts`):
  * *High — a lost verify answer:* a verify that reached Zarinpal but whose answer was lost could let the order be cancelled or expired
    with the money captured. The claim now marks `verifySentAt`; an attempt with that mark blocks cancel and expiry and is never closed
    unverified, until a definite answer (verify 100/101, -50/-54, or inquiry FAILED/REVERSED). Money captured on an order that is no longer
    payable (cancelled, expired or paid by another attempt) is recorded as `REFUND_REQUIRED` and shown to the merchant, never dropped.
  * *High — the authority is not a secret:* the order link is returned from the return page only to the browser that opened the payment
    (`sb_pay` HttpOnly cookie with a random return key; only its SHA-256 is stored) or to the order's own signed-in customer; and -51
    ("not paid", also what a forged early `OK` gets) no longer fails the attempt (only -50 and -54 do).
  * *Medium:* the attempt stores the fingerprint of the merchant id that opened it and is verified only with that id (-53 is not final);
    the reconciler works in a time budget with 4 parallel checks, handles overdue orders first (last check, then expiry), and backs off per
    attempt (`nextCheckAt`, 1→10 min) so abandoned sessions do not starve new ones; a PAID online order is no longer cancellable by the
    shopper (the merchant may cancel it, with a warning to refund from the Zarinpal panel).
  * *Low:* the attempt is re-checked under the order lock when it is recorded (5-attempt cap, no session recorded for a closed order);
    release and failure are compare-and-set on the claim.
* **Development:** `ZARINPAL_DEV_BASE_URL=http://127.0.0.1:PORT` (development/test only, loopback only) sends the calls to a local fake
  gateway; the browser follows only the two Zarinpal hosts (and a loopback one outside production).
* **Not in this phase:** refunds through `reverse.json` (needs the server IP registered at Zarinpal), `cart_data`, the platform's own
  merchant id (merchant subscriptions), payment SMS (3.6).

## D35c-1: several online gateways; Aghaye Pardakht (2026-11-24)

Read from Aghaye Pardakht's own documentation (API v2: create, startpay, return, verify; plus balance, transaction inquiry, reports,
payouts, bank accounts, merchant onboarding and referral, which need the merchant's ACCOUNT number and key and are not used).

* **Registry:** `GATEWAYS = ZARINPAL | AQAYEPARDAKHT` (packages/shared). Each has a platform switch (`payment.zarinpalEnabled`,
  `payment.aqayepardakhtEnabled`; an older stored value without the second reads it as off), a store credential kept as a write-only
  store secret (`payment.zarinpal.merchant_id` UUID; `payment.aqayepardakht.pin`, letters and digits), an amount range in toman (Zarinpal
  100..100,000,000; Aghaye Pardakht 1,000..400,000,000) and a session-id shape (Zarinpal authority; Aghaye Pardakht transid). The shopper
  sees every gateway the store can use (`payment-methods.gateways`) and picks one; the ONLINE order stores it (`Order.paymentGateway`,
  CHECKed) and every payment attempt records its `provider`. Adding a gateway = one adapter file + one row in each table.
* **Aghaye Pardakht flow:** `create` with the amount in **toman** (the service passes rial, the adapter divides by 10),
  `callback_method=GET`, `invoice_id` = order number; the buyer goes to `/startpay/{transid}` (sandbox: `/startpay/sandbox/…` with pin
  `sandbox`); the return comes to `/checkout/payment/return/aqayepardakht?transid=…&status=1|0`; only transid and status are forwarded,
  and status 1 only triggers a server-side `verify` (1 = verified now, 2 = verified before: both paid; 0 = not paid yet: the attempt stays
  open; -8/-10 settle it as failed; anything else is unclear). Verify returns no reference of its own: the transid is the reference.
* **Referer:** Aghaye Pardakht's payment page refuses a visit whose Referer is not the gateway's registered domain (-16). The browser goes
  to every gateway through a link with `referrerpolicy="origin"`: the gateway gets the store's origin, never a page path (order pages keep
  their secret link out of referrers).
* **Reconciler:** Aghaye Pardakht has no inquiry with the gateway pin, so open attempts are verified directly (harmless when unpaid: code 0
  leaves them open, with back-off). Its documentation does not say whether an unverified payment is returned to the buyer automatically
  (Zarinpal's is): see the open question below.
* **Unverified payments:** a gateway that does not (or does not document that it does) return unverified payments to the buyer —
  Aghaye Pardakht — is marked `GATEWAY_AUTO_REFUNDS = false`. Its attempts are never closed unverified: they are verified even on an order
  that was paid by another attempt, cancelled or expired (captured money becomes REFUND_REQUIRED for the merchant), until 24 hours after
  they were opened. Open question for Aghaye Pardakht support: is an unverified payment returned automatically, and after how long?
* **Custom domains:** Aghaye Pardakht checks the Referer against the registered domain; the return address is the store's subdomain, so a
  storefront served on a custom domain needs that domain registered at the gateway instead (to revisit when custom domains go live).
* **Security review (2026-11-24), fixed with tests:** the High finding was the one above (attempts of a non-refunding gateway closed
  unverified); also: an unknown verify answer keeps the "verify sent" mark for every gateway; the credential fingerprint keeps the case of
  Aghaye Pardakht pins; the gateway CHECK accepts an ONLINE order without a gateway (read as Zarinpal) so the migration stays expand-only
  during a deploy; a sandbox session never places an order after the platform leaves sandbox mode; Aghaye Pardakht invoice ids are unique
  per attempt; per-gateway amount CHECKs; the pin `sandbox` can never be stored as a store credential.

## D35b-1: card-to-card payment (2026-11-24)

Owner decisions: shoppers pick among every enabled method; 24 hours to send the receipt; proof = image + bank tracking number + last 4
digits of the paying card.

* **Cards:** the merchant lists up to 5 bank cards (`PUT stores/:id/bank-cards`, `store.settings`, audited): 16 digits with a Luhn check
  (Persian digits, spaces and dashes accepted), holder name, bank name (filled from the card prefix when empty). A card number is shown to
  a shopper only on their own unpaid card-to-card order. Card-to-card is offered (`payment-methods.cardTransfer`) only while the store has a card.
* **Order life:** a `CARD_TRANSFER` order is placed like a COD one (stock consumed, cart emptied, no COD fee) but waits `AWAITING_PAYMENT`
  with a 24-hour `paymentDeadline` and no `order.placed`. The merchant's approval places it (actor MERCHANT, `order.placed`).
* **Receipt** (`POST checkout/orders/:token/receipt` or `customer/orders/:id/receipt`): the image is the raw body; the tracking number
  and the payer's last 4 digits come in the `x-receipt-tracking-code` / `x-receipt-payer-last4` headers (percent-encoded), never in the
  URL that proxies log. The order's state is checked before any image work. The image goes through the media pipeline (real format from the bytes, no trailing data, no animation,
  pixel limits, re-encoded WebP ≤ 1600 px: EXIF/GPS stripped) and is stored in PostgreSQL (`TransferReceipt.image`), never in the public
  bucket. Only one receipt under review at a time, at most 5 per order, 10 per network per store per hour.
* **Review** (`GET/POST stores/:id/orders/:orderId/receipts…`): the image is served only to the store's staff (`orders.view`) with
  `private, no-store`, `nosniff` and a sandbox CSP. Approve: under the order lock the receipt becomes APPROVED and the order PLACED.
  Reject with a note (shown to the shopper): the shopper may send a corrected receipt, and the deadline is moved to at least 24 h from now.
* **Expiry and cancel:** the reconciler expires unpaid card-to-card orders 15 minutes after the deadline (stock back), except while a receipt
  waits for the merchant. The shopper cannot cancel while a receipt is under review; the merchant can (the receipt is rejected in the same
  transaction). An approved card-to-card order is cancelled only by the merchant (who returns the money).
* **Security review (2026-11-24), fixed with tests:** a gateway session could be opened on a card-to-card order (double payment) — only
  ONLINE orders reach the gateway now, and approval refuses an order with a gateway payment in progress; no deadline extension after the
  5th receipt; receipt fields moved out of the URL; state checked before image processing, plus a per-order rate limit; concurrent card
  saves serialised on the store row; lists no longer offer "cancel" on card-to-card orders.
* **The shopper sees** their receipts' status, date, payer last-4 and the rejection note, never the tracking number (the order link can be
  shared).

## Storefront and dashboard screens for 3.3/3.4 (2026-11-25)

* **How the store page reaches the API.** The browser on a STORE host calls `/api/shop/<route>` on that same host. The web proxy
  (`apps/web/src/proxy.ts`, `lib/shop/shop-route.ts`) forwards it to the API's `/api/public/stores/<label>/<route>`, with the label taken
  from the HOST, never from the path, and only for an allowlist of shopper routes (cart, checkout, order links, customer). Headers pass
  through unchanged: the cart and customer cookies stay host-only cookies of the store, the API's Origin rule accepts the store's own
  origin, and the client address Caddy set reaches the API's rate limits. No Caddy change is needed (store hosts already go to the web app).
* **Buying.** `RenderContext.commerce` is true only on the live store page, so previews and theme demos show no buy controls. Every theme's
  product page shows "add to cart" (variant choice for products with variants, quantity) through one component (`templates/commerce`);
  sold-out products show none. A floating "cart (n)" link appears on the live store when the cart is not empty.
* **Pages on the store host, inside the store's own theme** (its Layout: header, menu, footer), never indexed or cached: `/cart`,
  `/checkout` (address with the province list and city suggestions, then the shipping methods for that province with their cost, cash on
  delivery, note, totals from the server, place order with a per-page request key) and `/orders/<token>` (status, items, totals, history,
  cancel while allowed; no referrer is sent).
* **Dashboard.** "سفارش‌ها" (orders: status tabs, newest first, older pages; order detail with items, delivery, history and the next steps
  with an optional note) and "روش‌های ارسال" (shipping methods: every field of 3.3, saved as a whole and applied at once).

## Shopper accounts and the header (D33b-1, 2026-11-25)

* **Sign-in.** Phone + password (`POST .../customer/register`, `.../customer/login`; Argon2id like the merchant sign-in; one answer for
  unknown phone and wrong password, with the same cost; limits: 30 attempts per 15 minutes per network, 10 per phone per store, 10 new
  accounts per hour per network) or phone + SMS code (3.1). Both set the same store-bound customer cookie.
* **What a password proves.** Nothing about the phone. Guest orders are attached to the store's customer with the same phone
  (`Order.linkedByPhone = true`, the customer created unverified when missing, in the order's transaction with one atomic
  `INSERT ... ON CONFLICT`), but such orders are listed and opened only by a customer whose phone was verified by an SMS code. Orders placed
  while signed in belong to the account either way. The first SMS verification drops a password set before it and ends its sessions
  (whoever set it never proved the phone); registering a phone that already has a password, or was verified, is refused.
* **Development.** `CUSTOMER_OTP_DEV_LOG=true` (API, development/test only; the API refuses to start with it in production) writes
  sign-in codes to the API log, so SMS sign-in can be tried before the Kavenegar account exists.
* **Storefront.** Every theme's header shows an account icon and a cart icon with the number of items (live, updated when the cart
  changes). `/account`: sign in, register or SMS code; then the customer's orders (`/account/orders/<id>`), saved addresses and sign-out.
  Checkout offers saved addresses, prefills name and phone, can save a new address, and links guests to sign in (`?next=/checkout`, same
  site only).
* **Dashboard.** "مشتری‌ها": every customer with order count, spending (not cancelled) and last order
  (`GET /api/stores/:storeId/orders/customer-stats?ids=`, `customers.view`), linking to that customer's orders (`orders?customerId=`).
* **Security review 3.3b (2026-11-25):** no Critical or High findings. Fixed with regression tests: SMS verification and registration
  of one phone now decide on the same locked row, created by one atomic insert-if-missing (a password registered during a verification
  could otherwise survive it, and concurrent first creations collided); orders attached only by phone are read-only in the account (the
  phone on an order may be a gift recipient's; the buyer cancels with the order link); password attempts are limited per phone and
  network (10 per 15 minutes) with a looser per-phone ceiling (50), so a stranger cannot lock the owner out; registrations are limited per
  phone (5 per day per store). Accepted: registering over a guest-only record replaces its name (keeping the old name would show the guest
  buyer's real name to whoever typed the number); the merchant sees such a customer as not verified.
* **Error text.** A domain error rebuilt from an API answer carries only its class name; `domainErrorMessage` gives back the class's fixed
  Persian message, so shop and dashboard screens show it.

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
