# Phase 3: the commerce core (ADR 0002 §6, decisions D3-1..)

Owner decisions of 2026-11-22: **Zarinpal** is the payment gateway (for merchants' shoppers), **Kavenegar** is the SMS provider (the fastest
one was asked for; no independent delivery-time measurement exists, so the OTP-dedicated `verify/lookup` route of Kavenegar was chosen and the
provider sits behind a port: switching is one adapter). Customer sign-in by OTP is **built but off** until the SMS account exists. Platform
operators ("super admins") get their own accounts. The merchant dashboard is not changed by these steps (another session owns it): each step
ships the API, the storefront side and the tests; dashboard screens follow from the documented API.

| Step | Content | Status |
|---|---|---|
| 3.1 | Platform super-admins (role table, server command for the first one, `/api/v1/platform` API and the `/platform` pages, audited); platform settings for SMS, payment and AI with write-only encrypted keys; customer accounts per store; OTP sign-in (code, limits, session) through Kavenegar, **off** until switched on in the settings | done |
| 3.2 | Product variants (options such as colour/size, price and stock per variant); atomic stock decrement; temporary reservations | planned |
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
