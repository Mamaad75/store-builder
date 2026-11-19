# Accounts and platform polish (phase 12)

## Sessions, password change, sign out everywhere
* Sessions are HS256 JWTs in an httpOnly `SameSite=Lax` cookie (`__Host-sb_session` over https) carrying `User.authVersion`; since N3 they are issued and verified by the NestJS API (`apps/api/src/auth`), which re-checks the version on every read. The web app asks the API who is signed in (`src/auth.ts`).
* **Change password** (`/dashboard/account`): current password required (wrong value: field error, nothing changes), new password 8-128 characters and different from the current one, rate limited (10 per 15 min per user). Success hashes with Argon2id, bumps `authVersion` and signs out: **every session, this one included, ends** and the user signs in again with the new password.
* **Sign out everywhere**: bumps `authVersion` only (the password is untouched) and signs out.

## Sign-in by username (ADR 0001, U1, 2026-11-19)
* Registration asks for a display name, a **username** and a password; there is **no e-mail** anywhere in sign-up or sign-in.
* Username: lower-case `a-z`, `0-9` and `_`, starts with a letter, 3-30 characters; input is normalised first (spaces trimmed, Persian and
  Arabic-Indic digits converted, lower-cased), a short list of reserved names is refused, and a database CHECK enforces the same pattern.
* A **taken username is reported** on the registration form (the person must choose another one; a username is not secret). Login keeps one
  generic error for unknown name, wrong password and malformed input, pays one Argon2 verification for unknown names (no timing
  difference) and is rate limited per IP (30 / 15 min) and per username (10 / 15 min).
* **No password recovery until OTP:** the former e-mail reset flow (`/forgot-password`, `/reset-password`) was removed and both paths
  are a real 404. The `PasswordResetToken` table and the optional `User.email` column are no longer used by any code; dropping them is a
  separate contract migration that needs explicit approval (`prisma/migrations/20261119090000_u1_username`, reverse in its `down.sql`).

## Mail (decisions D12-2, D12-8 and DM2-1)
`MAIL_TRANSPORT`: `smtp` (real delivery, below), unset/`none` (fails closed; the default outside development; logs nothing), `log` (development default; prints whole messages), `file` (needs `MAIL_OUTBOX_DIR`).

**SMTP (`src/modules/auth/smtp.ts`, DM2-1).** Provider-neutral: `SMTP_HOST`, `SMTP_PORT` (default 587), optional `SMTP_SECURE`
(default: `true` only for port 465), `SMTP_USER` + `SMTP_PASSWORD` (both or neither), `MAIL_FROM` (`addr@domain` or `Name <addr@domain>`),
optional `SMTP_TLS_CA_FILE` (adds a trust anchor). Encryption is mandatory: implicit TLS, or STARTTLS that must succeed (no plain-text
fallback); the certificate is always verified (TLS 1.2+); timeouts are bounded; messages cannot read files or URLs. An incomplete `smtp`
configuration stops the server at start-up in every environment, naming variables only. Since U1 nothing in the application sends
mail (password reset was removed with the e-mail address); the transport stays for future notifications or OTP. Tested with unit tests, DB tests and real SMTP against throw-away Mailpit servers (`pnpm test:mail`, CI job "mail").
Still for phase 14: choosing the provider, SPF/DKIM/DMARC on the sender domain and an end-to-end test in staging.

**Production guard.** `log` and `file` are refused unless `NODE_ENV` is exactly `development` or `test`: the server exits with code 1 at start-up (`src/instrumentation.ts`), and `createMailer` refuses again. Case and spaces in the value do not bypass it. The only exception is the E2E suite (a production build): `MAIL_TRANSPORT=file` with `MAIL_E2E_FILE_OUTBOX_OVERRIDE=1` and a loopback `http` root domain (`localhost`/`127.0.0.1`), which prints a warning; `log` has no override. Never set the override anywhere else. Tests inject a memory outbox. **Phase 14 gate:** a real transport, see `docs/roadmap.md`.

## Landing, legal, errors, onboarding, accessibility
* `/` is a static, indexable landing page (header with sign-in/sign-up, features, footer); `/terms` and `/privacy` are **draft** texts with a visible banner (platform host only; final text is a phase 14 gate).
* `error.tsx` / `global-error.tsx` show a fixed Persian message with retry, never the error text or stack; `not-found` links home.
* The dashboard shows a derived getting-started checklist (store, category, first product, subdomain, publish) for the newest unpublished store; it vanishes when all stores are published.
* Accessibility: skip link and `main` landmark in the dashboard, `main` on every platform page, labelled navigation, one `h1` per page, labelled controls, `role="alert"` for form errors, `lang="fa" dir="rtl"`. This is a structural pass covered by tests; it is **not** a full WCAG audit with assistive technology (colour contrast of the MUI theme and screen-reader behaviour were not measured).

## Tests
Unit (API: `auth-unit.test.ts` username rules, token, cookie; `auth-http.test.ts` the whole REST flow; web: `rate-limit.test.ts`, `mailer.test.ts`, `onboarding.test.ts`, architecture guards), DB (API `auth.db.test.ts`: registration races, login, password change and session invalidation on real PostgreSQL; web `session.db.test.ts`, `rate-limit.db.test.ts`; `schema.db.test.ts` username CHECK and uniqueness), E2E (`e2e/auth.spec.ts` username forms and the 404 of the old reset pages; `e2e/account.spec.ts` change password, sign out everywhere across two browsers, landing, legal, 404, skip link, labels, onboarding).
