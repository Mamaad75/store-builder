# ADR 0004 — SMS provider activation at deployment; development OTP without a provider

* **Status:** Accepted (owner decision, 2026-11-24).
* **Related:** ADR 0002 §7 (Kavenegar chosen), D31-2 (customer OTP), D36-1 (order SMS), ADR 0003 (merchant verification will send OTP
  codes too), `docs/production/PRODUCTION_READINESS_CHECKLIST.md` §S.

## 1. Decision

1. The real SMS panel (Kavenegar) is created, verified and configured **only in the final deployment phase**, on the production server.
   No account, API key, line or template is needed before that.
2. Development, UI testing and automated tests **never depend** on a real Kavenegar account or credentials.
3. In development, OTP codes and order SMS are delivered by a **development-only sender** that writes them to the local API / worker log.
4. **Production never accepts fake, fixed or development codes.** There is no master code, no fixed code, no "skip OTP" switch.
5. Delivery stays **provider-independent**: services depend on small sender interfaces; Kavenegar is one adapter, selected by
   configuration at run time.
6. Real SMS delivery is **not a blocker** for architecture or UI work. Features that send SMS are built, reviewed and tested against
   the development sender and fakes; real delivery is verified once, at deployment (§5).

## 2. What exists today (verified 2026-11-24, no change needed)

| Concern | Implementation | Where |
|---|---|---|
| Provider-independent OTP delivery | `OtpSender { sendOtp(phoneE164, code) }`; the customer auth service never knows the provider | `apps/api/src/modules/customers/application/ports.ts` |
| Provider-independent order SMS | `TemplateSender { sendTemplate(phoneE164, template, tokens) }` | `apps/api/src/modules/notifications/application/ports.ts` |
| Kavenegar adapter | `KavenegarSms` (`verify/lookup`), key read from the encrypted platform secret, enabled only by platform settings | `apps/api/src/platform/sms/sms.ts`, `modules/platform/infrastructure/compose.ts` |
| Development OTP sender | `CUSTOMER_OTP_DEV_LOG=true` → `devLogOtpSender` logs `customer.otp.dev_code` with the masked phone and the code | `modules/customers/infrastructure/compose.ts` |
| Development order SMS sender | `ORDER_SMS_DEV_LOG=true` (worker) → messages are logged instead of sent | `modules/notifications/infrastructure/compose.ts` |
| Codes are random, never fixed | `randomInt(0, 1_000_000)`, 6 digits; only an HMAC of the code is stored; attempts and expiry limited; rate limits per phone / IP | `modules/customers/infrastructure/crypto.ts`, `domain/otp.ts` |
| Development senders cannot reach production | Both flags are **refused at start-up** unless `NODE_ENV` is exactly `development` or `test` (an unset or any other `NODE_ENV` counts as production); the process exits naming the variable | `apps/api/src/config/env.ts`; tests in `src/__tests__/env.test.ts` (customer OTP flag test added with this ADR) |
| Off by default in production | Platform settings default to SMS off; without the platform secret and approved template names nothing is sent | `packages/shared/src/modules/platform/settings.ts` |

The development senders do **not** weaken verification: the code is still random, stored as a hash, single-use, rate limited and
checked exactly as in production. Only the delivery channel differs (log instead of SMS).

## 3. Rules for new code (until and after deployment)

* Every new SMS use (e.g. merchant phone verification and account recovery in ADR 0003 V1, billing reminders in B2) sends through an
  existing sender interface or a new interface of the same shape, with a development sender behind a flag that `env.ts` refuses outside
  `development`/`test`, and a start-up test for that refusal.
* No code path may compare against a constant code, accept a code from configuration, or skip verification by environment.
* Tests use in-memory fakes of the sender interfaces; no test reads a provider key or calls a provider host.
* Provider-specific values (API key, template names, sender line) live only in platform secrets / settings, never in code or env files
  committed to git.

## 4. Local testing guide (no SMS account)

* `apps/api/.env`: `NODE_ENV=development` (the dev scripts set it) and `CUSTOMER_OTP_DEV_LOG=true`. Ask for a code in the storefront
  sign-in; read it in the API terminal (`customer.otp.dev_code`).
* Order SMS: run the worker with `ORDER_SMS_DEV_LOG=true`; in `/platform/settings` switch order SMS on and type any template names (they
  are only labels in development). Messages appear in the worker log. Without template names they are recorded as skipped.
* Payments have the same pattern (`ZARINPAL_DEV_BASE_URL`, `AQAYEPARDAKHT_DEV_BASE_URL` → local fake gateways, development only).

## 5. Activation at deployment (production server, final phase)

Follow checklist §S (S1–S8). In short: create and verify the Kavenegar account → sending line → template approval (OTP and each order
SMS kind) → store the API key as the platform secret in `/platform/settings` (write-only, encrypted) → enter template names → switch
customer OTP / order SMS on → verify end to end on real phones → set credit alerts and per-store caps. The development flags are **not
set** on the server (the API and worker refuse to start if they are).

## 6. Consequences

* + UI and feature work proceed without external accounts; CI needs no secrets.
* + One code path verifies codes in every environment; only delivery differs.
* − Real delivery problems (template rejections, line limits, operator filtering, latency) are discovered only at deployment; budget
  time for S1–S6 before launch.
* − Developers must read codes from the log; this is intentional (no shortcut that could leak into production).
