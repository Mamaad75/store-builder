# Accounts and platform polish (phase 12)

## Sessions, password change, sign out everywhere
* Sessions are JWTs carrying `User.authVersion`; every read re-checks it (`src/modules/auth/callbacks.ts`).
* **Change password** (`/dashboard/account`): current password required (wrong value: field error, nothing changes), new password 8-128 characters and different from the current one, rate limited (10 per 15 min per user). Success hashes with Argon2id, bumps `authVersion`, deletes pending reset tokens and signs out: **every session, this one included, ends** and the user signs in again with the new password.
* **Sign out everywhere**: bumps `authVersion` only (the password is untouched) and signs out.

## Password reset
1. `/forgot-password`: always the same confirmation, whether the address is registered, unknown or malformed. Rate limited per IP (10/h) and per address (3/h).
2. If the address is registered: the user's single token row is created or replaced in one `INSERT ... ON CONFLICT (userId)` (the unique `userId` index makes "at most one live token per user" a database guarantee, even for simultaneous requests; an earlier emailed link then stops working). The token is 32 random bytes and **only its SHA-256 is stored** (1 h expiry), and the link `APP_PROTOCOL://APP_ROOT_DOMAIN/reset-password?token=...` is handed to the mailer. Mail failure is logged by class only and is invisible to the requester.
3. `/reset-password?token=...`: unusable links (malformed, unknown, expired, used) show one neutral message. The page is `noindex` with `referrer: no-referrer`.
4. Submitting claims the token with one conditional UPDATE (`usedAt IS NULL AND expiresAt > now`), sets the new password hash, bumps `authVersion` and deletes the user's other tokens, in one transaction. Two simultaneous submissions: exactly one succeeds. Rate limited per IP (20/h).

**Known limits.** A request for a registered address does slightly more work (token write, mail hand-off) than one for an unknown address, so response *timing* can in principle differ; the visible answer never does. Mitigations are rate limits and, in phase 13/14, sending from a background job. Email is not verified at registration (post-MVP), so a reset email only proves control of the address given at sign-up.

## Mail (decisions D12-2, D12-8 and DM2-1)
`MAIL_TRANSPORT`: `smtp` (real delivery, below), unset/`none` (fails closed; the default outside development; logs nothing), `log` (development default; prints whole messages including the reset link), `file` (needs `MAIL_OUTBOX_DIR`).

**SMTP (`src/modules/auth/smtp.ts`, DM2-1).** Provider-neutral: `SMTP_HOST`, `SMTP_PORT` (default 587), optional `SMTP_SECURE`
(default: `true` only for port 465), `SMTP_USER` + `SMTP_PASSWORD` (both or neither), `MAIL_FROM` (`addr@domain` or `Name <addr@domain>`),
optional `SMTP_TLS_CA_FILE` (adds a trust anchor). Encryption is mandatory: implicit TLS, or STARTTLS that must succeed (no plain-text
fallback); the certificate is always verified (TLS 1.2+); timeouts are bounded; messages cannot read files or URLs. An incomplete `smtp`
configuration stops the server at start-up in every environment, naming variables only. The forgot-password action hands delivery to
Next's `after()`, so the answer never waits for the SMTP round trip (no timing difference between registered and unknown addresses from
mail delivery). Tested with unit tests, DB tests and real SMTP against throw-away Mailpit servers (`pnpm test:mail`, CI job "mail").
Still for phase 14: choosing the provider, SPF/DKIM/DMARC on the sender domain and an end-to-end test in staging.

**Production guard.** `log` and `file` are refused unless `NODE_ENV` is exactly `development` or `test`: the server exits with code 1 at start-up (`src/instrumentation.ts`), and `createMailer` refuses again. Case and spaces in the value do not bypass it. The only exception is the E2E suite (a production build): `MAIL_TRANSPORT=file` with `MAIL_E2E_FILE_OUTBOX_OVERRIDE=1` and a loopback `http` root domain (`localhost`/`127.0.0.1`), which prints a warning; `log` has no override. Never set the override anywhere else. Tests inject a memory outbox. **Phase 14 gate:** a real transport, see `docs/roadmap.md`.

## Landing, legal, errors, onboarding, accessibility
* `/` is a static, indexable landing page (header with sign-in/sign-up, features, footer); `/terms` and `/privacy` are **draft** texts with a visible banner (platform host only; final text is a phase 14 gate).
* `error.tsx` / `global-error.tsx` show a fixed Persian message with retry, never the error text or stack; `not-found` links home.
* The dashboard shows a derived getting-started checklist (store, category, first product, subdomain, publish) for the newest unpublished store; it vanishes when all stores are published.
* Accessibility: skip link and `main` landmark in the dashboard, `main` on every platform page, labelled navigation, one `h1` per page, labelled controls, `role="alert"` for form errors, `lang="fa" dir="rtl"`. This is a structural pass covered by tests; it is **not** a full WCAG audit with assistive technology (colour contrast of the MUI theme and screen-reader behaviour were not measured).

## Tests
Unit (`mailer.test.ts`, `onboarding.test.ts`, architecture guards), DB (`account.db.test.ts`: hashing, single use, expiry, concurrency, replacement, rate limits, cleanup, session invalidation), E2E (`e2e/account.spec.ts`: full reset by emailed link, change password, sign out everywhere across two browsers, landing, legal, 404, skip link, labels, onboarding).
