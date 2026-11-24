# Production readiness and external dependencies checklist

> **Status of this document:** living checklist, created 2026-11-24. Nothing here has been bought, created, registered or deployed.
> Product development continues **without** waiting for any item below; every external service sits behind an interface with a
> development/mock implementation (see §1).
>
> **Rules that apply to every item**
> * Secrets (API keys, tokens, merchant ids, passwords, private keys) never go into git, chat, CI logs or images. They live only in the
>   server's `.env.production` (mode 600) or in the platform's encrypted secret store (`PlatformSecret` / store secrets, written through the
>   `/platform` and dashboard screens, envelope-encrypted with `SECRETS_MASTER_KEYS`).
> * Staging and production are separate: separate server, database, bucket, `AUTH_SECRET`, secret master keys and provider credentials
>   (sandbox credentials on staging wherever the provider offers them).
> * Every purchase, account creation, provider contract and deployment is done by the project owner (or with the owner's explicit approval).
> * Legal items are **research items**: this document does not state legal requirements as facts. Anything marked **[CONFIRM]** must be
>   confirmed with the named authority or provider before it is relied on.
>
> **Related documents (reused, not duplicated):** `docs/phase14-checklist.md` (hosting decisions T1–T12, provider comparison, staging order),
> `docs/deployment.md`, `docs/runbook.md` (deploy, rollback, backups, restore drill, alerts), `docs/security.md`, `docs/observability.md`,
> `docs/media.md`, `docs/commerce.md` (payments, SMS, discounts), `docs/decisions.md`.

---

## 0. Status legend and task format

Status: **Not started** · **In progress** · **Blocked** · **Completed**.
"Blocks deploy" means: production cannot go live (or the named feature cannot be switched on) until this is done.
**Feature-gated** means the platform can launch with the feature switched off; every provider-backed feature in this codebase is **off by
default** and switched on per platform setting.

Each task has: **Why** · **Needs** (information/documents) · **Provider** · **Blocks deploy** · **When** · **Status** · **Done when**
(verification / acceptance).

---

## 1. Inventory: what the codebase actually uses (inspected 2026-11-24, commit `9be339e`)

| Service / dependency | Implemented in code? | Where | Credentials / config | Default |
|---|---|---|---|---|
| PostgreSQL 16 | Yes (only datastore of record) | Prisma, `apps/api/prisma` | `DATABASE_URL`, `POSTGRES_*` | — |
| Redis | Yes (BullMQ job queue / worker) | `apps/api/src/config/env.ts`, worker | `REDIS_URL` (password in URL) | — |
| S3-compatible object storage | Yes (product/store images) | `apps/api/src/lib/storage`, `docs/media.md` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL` | — |
| Caddy reverse proxy + TLS (ACME DNS-01 wildcard) | Yes (config + Dockerfile) | `docker/caddy/`, `docker-compose.prod.yml` | `CADDY_DNS_MODULE`, `DNS_API_TOKEN`, `CADDY_TLS_DIR` | TLS snippet per DNS provider still to generate (phase14 K2) |
| Domain + DNS (root, `www`, `*` wildcard) | Platform subdomains: yes. **Custom merchant domains: not implemented** (only a `CUSTOM` value in the `DomainKind` enum) | `apps/web/src/lib/host-policy.ts` | `APP_ROOT_DOMAIN`, `APP_PROTOCOL` | — |
| Kavenegar SMS | Yes: customer OTP (`verify/lookup`) and order SMS (templates) | `apps/api/src/platform/sms`, `modules/notifications` | Platform secret (Kavenegar API key) + template names in `/platform` | **Off** |
| Zarinpal (REST v4) | Yes: per-store merchant id, verify, inquiry, reconciler; refund via `reverse` **not** implemented | `modules/orders/infrastructure/zarinpal.ts` | Store secret `payment.zarinpal.merchant_id`; platform switch + sandbox flag | **Off**, sandbox on |
| Aghaye Pardakht | Yes: per-store gateway pin; no automatic refund | `modules/orders/infrastructure` | Store secret (gateway pin); platform switch | **Off** |
| Card-to-card | Yes (no external provider; receipts stored in PostgreSQL) | `modules/orders` | — | Per store |
| Navasan (gold/USD rates) | Yes: hourly reader, jump/stale guard; documented API is plain HTTP | `modules/pricing/infrastructure/navasan.ts` | Platform secret `rates.navasan.api_key` | **Off** (`provider: off`) |
| Bale bot (ops alerts) | Yes | `apps/api/src/lib/alert.ts` | `BALE_BOT_TOKEN`, `BALE_CHAT_ID`, optional `BALE_API_BASE` | Off when unset |
| Error tracking (Sentry protocol, GlitchTip planned) | Yes (reporter); server not installed by this repo | `packages/shared/src/observability` | `ERROR_TRACKING_DSN`, `ERROR_TRACKING_ENVIRONMENT` | Off when unset |
| Prometheus metrics | Yes (separate port) | `docs/observability.md` | `METRICS_PORT`, `METRICS_HOST` | — |
| SMTP email | Transport implemented (`smtp.ts`), **no user-facing flow currently sends email** (sign-in is by username since ADR 0001 U1; password reset by email is not wired) | `apps/web/src/modules/auth` | `MAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM` | `none` |
| AI provider | **Settings only**; nothing calls a model | `packages/shared/src/modules/platform/settings.ts` | Platform secret (AI key) | **Off** |
| Torob (Product API v3, webhook, Shop Generator, Shop API) | **Not implemented** | — | — | — |
| Emalls feed | **Not implemented**; no documentation obtained | — | — | — |
| eNamad / Samandehi badges | **Not implemented** (no badge slot in footer/themes) | — | — | — |
| Merchant subscription billing | **Not implemented** (a platform-own Zarinpal merchant id secret exists for it) | — | — | — |
| Container registry / base images | Docker Hub returned 403 from an Iranian network (2026-11-18); `ghcr.io` reachable | `docs/phase14-checklist.md` §2.1 | — | — |

---

## A. Before purchasing the server

### A1. Confirm hosting decisions already taken and close the open ones
* **Why:** server, DNS, storage and email choices drive everything below. T1 (Iran), T2 (`.ir`), T3–T6 (ParsPack) and T9 (Bale) are decided in
  `docs/phase14-checklist.md` §9; T7 (off-server backup at the same provider) is an accepted risk.
* **Needs:** owner decision on T8 (monitoring), T10 (image build location), T12 (HSTS preload, later).
* **Provider:** ParsPack (decided) · **Blocks deploy:** Yes · **When:** now · **Status:** In progress
* **Done when:** every T-row in phase14 §1 has a decision recorded with date.

### A2. Answer ParsPack's four open questions (phase14 §9)
* **Why:** public bucket must allow anonymous GET only; wildcard DNS + least-privilege DNS token; SMTP with mandatory TLS + DKIM/DMARC;
  server reachability to a Docker mirror, `ghcr.io` and Let's Encrypt.
* **Needs:** support ticket; an hourly test server and a test bucket.
* **Provider:** ParsPack · **Blocks deploy:** Yes · **When:** before any monthly purchase · **Status:** Not started
* **Done when:** storage security tests pass against the test bucket with `STORAGE_TEST_ENFORCES_POLICY=1` (anonymous List/Put/Delete =
  403); wildcard certificate issued on the test server; mirror/`ghcr.io`/ACME reachable from it.

### A3. Size the production server
* **Why:** decide CPU, RAM, NVMe and bandwidth before buying.
* **Needs:** expected stores and traffic for the first 6 months (owner estimate). Baseline from phase14 §2.3: staging 2 vCPU / 4 GB / 40 GB+;
  production estimate 4 vCPU / 8 GB / 80 GB+ NVMe. Runs: Caddy, web (Next.js), API, worker, scheduler, PostgreSQL 16, Redis. Images are in
  object storage, not on the disk; receipts (card-to-card) are in PostgreSQL (`bytea`), which grows the DB and its backups.
* **To decide:** bandwidth/traffic quota (storefront pages + images if the bucket is not behind a CDN), static IPv4 (required, see A5), IPv6
  (optional), snapshots, separate DB server or not (not needed at launch).
* **Provider:** ParsPack (or other, undecided) · **Blocks deploy:** Yes · **When:** before purchase · **Status:** Not started
* **Done when:** a written spec with quote (pre-invoice) is approved by the owner; phase14 §6 cost table filled in.

### A4. Purchase the platform's main domain
* **Why:** `APP_ROOT_DOMAIN`; merchant stores are `<label>.<domain>`; certificates, email sender, Torob/Zarinpal callback URLs and SMS links
  depend on it.
* **Needs:** chosen name; registrant identity for `.ir` (IRNIC rules for natural/legal persons) **[CONFIRM with IRNIC/registrar]**.
* **Provider:** IRNIC via a registrar (ParsPack offers `.ir`) · **Blocks deploy:** Yes · **When:** before server setup · **Status:** Not started
* **Done when:** domain registered **in the owner's/company's name** (not a contractor's), registrar account secured with 2FA, renewal date in
  the calendar, `whois` shows the right holder.

### A5. Static outbound IP requirements
* **Why:** Torob's Shop Generator token works **only from registered IPs** (401 otherwise). Other providers may also whitelist **[CONFIRM per
  provider: Kavenegar, Zarinpal, Aghaye Pardakht, Navasan, Emalls]**.
* **Needs:** a server plan with a fixed public IPv4 that does not change on reboot/resize; know whether outbound traffic leaves from the same IP.
* **Provider:** server provider · **Blocks deploy:** Only for IP-restricted integrations (Torob Shop Generator) · **When:** before purchase
  (a plan requirement), registration in C/D · **Status:** Not started
* **Done when:** provider confirms the IP is static; `curl ifconfig.me`-style check from the server equals the documented IP; the IP is
  recorded in the runbook (not a secret).

### A6. Business identity research (Iran) — see section L for the full legal list
* **Why:** domain holder, payment gateways, eNamad and SMS sender line usually ask for a natural or legal person identity.
* **Needs:** owner decision: operate as an individual or register a company. **[CONFIRM with an Iranian business lawyer/accountant]**
* **Provider:** — · **Blocks deploy:** Indirectly (A4, L-items) · **When:** now (long lead time) · **Status:** Not started
* **Done when:** decision recorded with the documents that identity will use.

### A7. Contact external providers early (long lead times)
* **Why:** partner access and approvals take weeks and must not wait for the server.
* **Needs:** a short platform description, expected volume, company identity (A6), contact person.
* **Items:** Torob partner access (T1 in §T), Emalls documentation (E1), Kavenegar account (S1), Zarinpal/Aghaye Pardakht questions (P1–P2).
* **Blocks deploy:** No (features gated) · **When:** now · **Status:** Not started
* **Done when:** each provider has an open ticket/contact and an answer log in this document.

---

## B. During infrastructure setup

### B1. Staging environment first
* **Why:** every step is rehearsed on staging before production (phase14 §5).
* **Needs:** A1–A5. · **Provider:** server provider · **Blocks deploy:** Yes · **When:** first purchase · **Status:** Not started
* **Done when:** phase14 §5 steps 3–12 completed and recorded.

### B2. Server hardening
* **Why:** baseline security (`docs/security.md`, runbook).
* **Needs:** deploy user, restricted SSH key (never shared in chat), firewall 22/80/443 only, unattended security updates, Docker Engine +
  Compose v2.
* **Blocks deploy:** Yes · **When:** server day 1 · **Status:** Not started
* **Done when:** password SSH disabled; `ss -tlnp` shows only Caddy (80/443) and SSH public; metrics port (9464) not public.

### B3. DNS records and TLS
* **Why:** platform, `www` and every store subdomain need valid certificates (wildcard via ACME DNS-01, D13-7).
* **Needs:** A records for `@`, `www`, `*`; DNS API token limited to this zone if possible; Caddy TLS snippet for the chosen DNS module (phase14
  K2); CAA record allowing the chosen CA.
* **Provider:** DNS provider (ParsPack decided) · **Blocks deploy:** Yes · **When:** with B1 · **Status:** Not started
* **Done when:** `https://<domain>`, `https://www.<domain>` and `https://test-store.<domain>` serve valid certificates; a renewal was
  observed or forced on staging; certificate-expiry alert configured (Let's Encrypt may be unreachable during international outages; ~30 days
  margin — phase14 §2.1).

### B4. Reverse proxy and client IP
* **Why:** rate limits and fraud checks depend on the real client IP (`docs/deployment.md`).
* **Needs:** `TRUST_PROXY_HOPS`/`TRUSTED_PROXY_HOPS` matching the real chain (Caddy only, or CDN → Caddy).
* **Blocks deploy:** Yes · **When:** B1 · **Status:** Not started
* **Done when:** a request from a known IP shows that IP in the rate-limit key/logs; spoofed `X-Forwarded-For` is ignored.

### B5. PostgreSQL and Redis
* **Why:** data of record; job queue.
* **Needs:** strong generated passwords on the server; Redis password; no public ports; `prisma migrate deploy` in the release procedure.
* **Blocks deploy:** Yes · **When:** B1 · **Status:** Not started
* **Done when:** `/api/ready` = ready; migrations applied; Redis and Postgres not reachable from outside.

### B6. Object storage bucket
* **Why:** product and store images; `S3_PUBLIC_BASE_URL` is the only external image origin in the CSP.
* **Needs:** bucket, policy (anonymous GetObject only), key limited to this bucket, stable public URL, versioning if available.
* **Blocks deploy:** Yes · **When:** B1 · **Status:** Not started
* **Done when:** storage tests pass with policy enforcement (A2); an image uploaded from the dashboard is visible on the storefront.

### B7. Backups off the server and restore drill
* **Why:** `docs/runbook.md` §Backups / §Restore drill; card-to-card receipts and orders exist only in PostgreSQL.
* **Needs:** destination bucket/server (T7), `BACKUP_DIR`, `RETENTION_DAYS`, `BACKUP_AFTER_HOOK` (phase14 K3), schedule (daily suggested),
  object-storage backup for images.
* **Blocks deploy:** Yes · **When:** B1 · **Status:** Not started
* **Done when:** a restore onto a fresh server succeeded and its duration is recorded; missing-backup (>26 h) and failed-backup alerts fire.

### B8. Monitoring, alerts, error tracking
* **Why:** alert events listed in phase14 §2.7 (`job.failed`, `worker.unhealthy`, `backup.failed`, …) plus payment reconciler and SMS
  failures.
* **Needs:** Bale bot token + chat id (T9), external uptime monitor on `/api/ready`, optional GlitchTip (`ERROR_TRACKING_DSN`), Prometheus
  scrape (optional).
* **Blocks deploy:** Yes (alerts) · **When:** B1 · **Status:** Not started
* **Done when:** `pnpm alert:test` reaches the Bale chat; an injected failure (phase14 §5 step 10) raises an alert.

### B9. Deployment and rollback procedure
* **Why:** repeatable releases; expand-only migrations allow app rollback without DB rollback.
* **Needs:** image build location (T10: on server vs CI → `ghcr.io`), Docker mirror for base images (Docker Hub blocked), `docs/runbook.md`
  §Deploy / §Roll back filled with real values (no secrets).
* **Blocks deploy:** Yes · **When:** B1 · **Status:** Not started
* **Done when:** one deploy and one rollback performed on staging following the runbook word for word; backup taken before deploy.

### B10. Disaster recovery plan
* **Why:** server loss, provider account suspension (accepted risk T7), international internet outage.
* **Needs:** RPO/RTO targets (owner decision), documented rebuild-from-scratch steps, copies of non-secret config, secret master keys stored
  offline by the owner, git hosting fallback (phase14 T1 mentions a domestic mirror).
* **Blocks deploy:** Yes for production · **When:** before C · **Status:** Not started
* **Done when:** a full rebuild on a new server from backups + repo was rehearsed once on staging and timed.

### B11. Secret master keys and platform bootstrap
* **Why:** platform and store secrets are envelope-encrypted with `SECRETS_MASTER_KEYS` / `SECRETS_ACTIVE_KEY_ID`; losing them makes every
  stored provider key unreadable.
* **Needs:** keys generated on the server, offline copy held by the owner, rotation procedure (`pnpm secrets:rotate`); first super admin
  created by the server command (phase 3.1).
* **Blocks deploy:** Yes · **When:** B1 · **Status:** Not started
* **Done when:** the app refuses to start without them (startup refusal check); a rotation was rehearsed on staging.

---

## C. Before production deployment

### C1. Production environment separate from staging
* **Why:** isolation (rules at top). · **Blocks deploy:** Yes · **Status:** Not started
* **Done when:** no credential, bucket or database is shared between staging and production; payment platform setting `sandbox=false` only
  in production.

### C2. Provider credentials entered through the platform screens (not env)
* **Why:** Kavenegar key, Navasan key, AI key are **platform secrets**; Zarinpal merchant id and Aghaye Pardakht pin are **store secrets**
  entered by each merchant.
* **Blocks deploy:** No (features stay off) · **When:** before switching each feature on · **Status:** Not started
* **Done when:** each secret shows "set" in `/platform` without being readable back; feature switched on only after its acceptance test (S6,
  P3, R1).

### C3. Legal pages
* **Why:** `/terms` and `/privacy` are drafts (phase14 T11); payment providers and eNamad typically review them **[CONFIRM]**.
* **Needs:** text approved by a person with legal responsibility; the "draft" banner removed.
* **Blocks deploy:** Yes for public launch · **When:** before D · **Status:** Not started
* **Done when:** final text published; contact details on the site match the business identity (A6).

### C4. Release gate (phase14 §7)
* **Why:** single go/no-go list. · **Blocks deploy:** Yes · **Status:** Not started
* **Done when:** every box in phase14 §7 is ticked, CI green on the release commit.

---

## D. Before public launch

### D1. Payment gateways live (see §P)
### D2. SMS live (see §S)
### D3. eNamad for the platform's own site (see L3)
### D4. Load and abuse check
* **Why:** rate limits and the order/OTP/SMS caps must hold under real traffic.
* **Done when:** a basic load test on staging with production sizing shows acceptable latency; OTP/SMS/discount caps verified once more.
* **Blocks deploy:** Yes · **Status:** Not started
### D5. Support and incident contacts
* **Why:** merchants and shoppers need a contact; providers need a technical contact.
* **Done when:** support channel published; incident "first five minutes" (`docs/runbook.md`) owners named.
* **Blocks deploy:** Yes · **Status:** Not started

---

## E. Post-launch

| Task | Why | When | Done when | Status |
|---|---|---|---|---|
| E1. Quarterly restore drill | runbook | every quarter | drill recorded | Not started |
| E2. Domain, certificate, eNamad, provider-contract renewals | expiry breaks the site/payments | calendar | reminders exist 30 days ahead | Not started |
| E3. SMS spend and per-store caps review | the platform pays for order SMS | monthly | usage vs budget recorded | Not started |
| E4. Payment reconciliation review (REFUND_REQUIRED, unverified attempts) | money correctness | weekly at first | zero unexplained items | Not started |
| E5. Dependency audit and security updates | `docs/security.md` | monthly | `pnpm audit` reviewed | Not started |
| E6. Secret rotation | hygiene / staff changes | yearly or on incident | rotation recorded | Not started |
| E7. Torob Shop API features (status, clicks, price reports) after partner access | merchant value | after T5 | see §T | Not started |
| E8. HSTS preload decision | irreversible | after domain is stable | decision recorded | Not started |

---

## L. Iranian business and legal requirements (research checklist)

**Nothing in this section is a statement of law.** Each item is a question to research and confirm with the named authority, a lawyer or the
provider. Classification: **Mandatory?** = believed generally required, still **[CONFIRM]**; **Conditional** = depends on business model or
provider; **Provider-specific** = a provider's own onboarding requirement.

| ID | Task | Why | Needs | Authority / provider | Class | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|---|---|
| L1 | Decide legal form (individual vs company) | Identity for domain, gateways, eNamad, SMS line, contracts | Lawyer/accountant advice | Company registration office (ilenc.ir) **[CONFIRM]** | Conditional | Indirect | Now | Not started | Decision + documents list recorded |
| L2 | Tax registration / economic code for a SaaS selling subscriptions | Invoicing merchants | National ID or company ID | Iranian tax authority (INTA) **[CONFIRM]** | Mandatory? **[CONFIRM]** | Before charging merchants | Before billing exists | Not started | Confirmed requirement + registration number on file |
| L3 | eNamad for the platform's own site | Trust badge; payment providers often require it **[CONFIRM per provider]** | Domain (A4), identity, address, phone, site with legal pages (C3) | eNamad (enamad.ir) | Mandatory? for gateway onboarding **[CONFIRM]** | Platform billing / gateways | After domain + site live | Not started | eNamad issued for the platform domain; badge shown on the platform site |
| L4 | eNamad for **merchant stores** on our subdomains / custom domains | Merchants may need their own eNamad to get their own Zarinpal terminal **[CONFIRM with eNamad and Zarinpal how subdomains of a store builder are treated]** | Store's domain, merchant identity | eNamad, Zarinpal | Conditional | Per merchant, not platform launch | Before merchants onboard gateways | Not started | Written answer; merchant help page; product needs (badge slot in themes, custom domains) added to roadmap |
| L5 | Samandehi (Ministry of Culture media registration) | Some sites are asked to register **[CONFIRM if applicable to a SaaS / to stores]** | Identity, domain | samandehi.ir | Conditional **[CONFIRM]** | Unknown | Research now | Not started | Answer recorded |
| L6 | Payment-facilitator / PSP rules for a platform | We do **not** hold merchant money: each store uses its own gateway terminal (D35-1). Confirm this model needs no platform-level licence **[CONFIRM with Zarinpal and a lawyer]** | Description of the money flow | Zarinpal, Shaparak rules via PSP | Conditional | Online payment feature | Before switching payments on in production | Not started | Written confirmation from the PSP |
| L7 | Privacy / consumer-protection obligations for shopper data (phones, addresses) | We store personal data for merchants | Lawyer review of `/privacy` | Lawyer **[CONFIRM]** | Mandatory? | Public launch | Before D | Not started | Approved privacy text (C3) |
| L8 | Domain holder requirements for `.ir` | Holder identity, possible verification | National ID / company docs | IRNIC **[CONFIRM]** | Provider-specific | Yes (A4) | Before A4 | Not started | Domain registered to the right holder |
| L9 | Document custody | Who holds originals, scans, provider logins | — | Owner | — | — | Now | Not started | Responsible person per document listed below |

**Documents likely to be requested (collect once; each provider confirms its own list) [CONFIRM]:** national card (owner/CEO), company
registration notice and latest changes (if company), economic code / national ID of the company, postal code and address proof, landline
number, bank account (Sheba) in the holder's name, domain ownership proof, site with legal pages and contact details.
**Responsible party:** project owner (all submissions and accounts); developer only supplies technical answers (IPs, callback URLs, flows).

---

## P. Payment gateways

| ID | Task | Why | Needs | Provider | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|---|
| P1 | Confirm Zarinpal merchant onboarding for **merchants** of a store builder (subdomain vs own domain, eNamad, callback domain registration) | Each store enters its own merchant id; callbacks come to `https://<store>.<domain>/checkout/payment/return` **[CONFIRM callback domain must match the terminal's registered site]** | Example store URL, flow description | Zarinpal | Online payment (gated) | Before enabling | Not started | Written answer; merchant help text updated |
| P2 | Same questions for Aghaye Pardakht | Same | Same | Aghaye Pardakht | Gated | Before enabling | Not started | Written answer |
| P3 | Production payment test | Real money path | One real store, real terminal, small amount | Zarinpal / AP | Gated | Before enabling in production | Not started | Paid → verified → order PLACED; cancelled/unverified case returned by the gateway; reconciler run observed |
| P4 | Platform's own Zarinpal terminal (merchant subscriptions) | Billing merchants; secret slot already exists | L1–L3 | Zarinpal | Only billing | When billing is built | Not started | Terminal active; billing feature designed |
| P5 | Refund process | `reverse` not implemented; REFUND_REQUIRED orders need a manual path | Merchant procedure | Zarinpal / merchant | No | Before launch | Not started | Procedure documented for merchants |

---

## S. SMS (Kavenegar)

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| S1 | Create and verify the platform's Kavenegar account | One platform account sends OTP and order SMS (D31-2, D36-1) | Identity (L1), phone, documents **[CONFIRM Kavenegar's verification list]** | OTP + order SMS (gated) | Early (A7) | Not started | Account verified; 2FA on |
| S2 | Obtain/activate a sending line suitable for templates/OTP | `verify/lookup` uses Kavenegar's service lines **[CONFIRM whether a dedicated line is needed]** | Kavenegar advice | Gated | After S1 | Not started | Line active |
| S3 | Get templates (patterns) approved | Code uses `verify/lookup` templates: OTP + one per order-SMS kind (placed/paid, shipped, cancelled by store, expired, receipt rejected; merchant: new order, receipt waiting) with `token`, `token2`, `token10` | Template texts (see `docs/commerce.md` §3.6) | Gated | After S1 | Not started | Each template approved; names entered in `/platform` |
| S4 | API key handling | Key is a platform secret (write-only, encrypted); never in env/git | `SECRETS_MASTER_KEYS` (B11) | Gated | C2 | Not started | Key "set" in `/platform`; logs contain no key |
| S5 | IP restriction on the API key (if offered) | Defence in depth | Static IP (A5) **[CONFIRM Kavenegar supports IP allowlists]** | No | C2 | Not started | Allowlist set or "not available" recorded |
| S6 | End-to-end tests | OTP sign-in; each order SMS kind; dev log off (`CUSTOMER_OTP_DEV_LOG`, `ORDER_SMS_DEV_LOG` unset in production) | Test phone | Gated | Before enabling | Not started | Each message received on a real phone; IDs recorded |
| S7 | Failures, retries, limits | Order SMS via outbox → worker (at-least-once, idempotent per event+kind); OTP has per-phone/IP caps; platform cap 6 SMS/phone/day; per-store monthly cap | Kavenegar error codes and credit alerts | No | Before enabling | Not started | Low-credit alert set in Kavenegar; a failed send visible in logs/alerts; caps verified |
| S8 | Budget | Platform pays for order SMS | Price per SMS, expected volume | No | Before enabling | Not started | Monthly cap per store set from the budget |

---

## T. Torob — future action (two separate integration paths)

**Do not merge these paths.** The Partner (Shop Generator) token is **not** a replacement for the product feed.

| Path | Direction | Purpose | Auth | Source |
|---|---|---|---|---|
| **Product API v3** | Torob → **our** endpoint (`POST`, per store) | Torob reads each store's products (`page_urls` / `page_uniques` / `page`+`sort` / cursor) | JWT in `X-Torob-Token` + `X-Torob-Token-Version: 1`, verified with **Torob's public key** (details in `torob_api_token_guide.md`, **not yet read**) | `github.com/torob/Torob-Sync/product_api_v3.md` |
| Product webhook (optional) | Our server → `https://api.torob.com/update/webhook/v1/` | Tell Torob a product changed (≤100 items/request, 20 req/min per shop, same host per request) | `Authorization: Bearer <token>` — "contact Torob support"; whether the partner token works here is **unknown** | `product_webhook.md` |
| **Shop Generator connection** | Our server → `https://api.torob.com/shop-generator/v1/` | Per-store approval: `POST connections/` → merchant approves at `approve_url` → callback `?connection_id&code` → `POST connections/{id}/confirm/`; `GET`, `DELETE` | Platform **partner token**, **only from registered IPs** (401 otherwise) | `shop_generator_connection.md` |
| **Shop API** | Our server → `https://api.torob.com/shop-api/v1/` | Per connected store: status, activate/deactivate, clicks, price reports (not charge transfer) | Same partner token + `domain` parameter; 5 req/s per shop | `shop_api.md` + the Torob panel PDF |

### Tasks

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| T1 | Request official Shop Generator partner access | Required for connections and Shop API | Platform description, company identity (L1), expected stores, contact | Torob features only | Now (A7) | Not started | Written approval from Torob |
| T2 | Obtain the platform partner token | Auth for Shop Generator + Shop API | T1 | Same | After T1 | Blocked (T1) | Token stored as a platform secret (never env/git); a `GET` on a test connection returns 200 from the server |
| T3 | Register production (and staging?) outbound IPs | Token only works from registered IPs | Static IP (A5) | Same | After server purchase | Blocked (A5) | Calls from the server succeed; calls from elsewhere get 401 |
| T4 | Implement per-store connection flow | Merchant approval per domain | Design below | Same | After T2 can be tested | Not started | Connect/confirm/disconnect works against Torob (or the mock) and states are shown in the dashboard |
| T5 | Use the token for Shop API | Status, clicks, price reports in the dashboard | T4 | No | After T4 | Not started | Dashboard shows Torob status for a connected store |
| T6 | Product API v3 endpoint, verified separately | Torob must be able to read products | Token guide (JWT public key, claims), Torob's registration of each store's endpoint URL | Torob listing | Can be built now against the published spec + mock JWT | Not started | Torob's validation of a test store succeeds; JWT verified with the official key |

### Design constraints (for implementation, independent of partner access)
* **Two modules, one boundary each:** (1) `feeds` (Product API v3 endpoint, pure mapping from the published snapshot + live prices; no
  Torob credentials needed except the public key for JWT verification); (2) `torob-connection` (connections + Shop API client behind a
  `TorobPartnerClient` port).
* **One platform token, per-store connection rows:** a `TorobConnection` row per store (`connectionId` UUID, `shopDomain`, `status`
  pending/approved/active/revoked/expired, `requestedBy`, timestamps). The token is a platform secret; nothing per store is secret.
* **Callback safety (from Torob's doc):** the callback is bound to the merchant's browser session; store the `connection_id` with the
  session/request and refuse a callback whose `connection_id` does not match; check the merchant has `store owner/manager` permission on the
  store whose domain was requested; 15-minute window; HTTPS `return_url` on the platform domain.
* **Domain ownership:** request a connection only for a domain the store actually serves (its platform subdomain, or a verified custom
  domain once custom domains exist). **[CONFIRM with Torob]** whether platform subdomains are accepted as separate Torob shops.
* **Revocation:** the shop can disconnect from Torob's panel; Shop API then returns 403 → mark the connection `revoked` on 403 and on
  periodic `GET`.
* **Until access is granted:** a fake Torob server for tests (like the existing fake Zarinpal/AP servers), the real client behind a platform
  switch that is **off**, no hardcoded token, no production code path that assumes undocumented behaviour.

### Questions to ask Torob before production
1. What is the process and are there requirements (company registration, eNamad, contract, minimum number of shops) for Shop Generator
   partner access?
2. How is the partner token issued, rotated and revoked? Can we have separate tokens for staging and production?
3. How many IPs can be registered, IPv4 only or also IPv6, and how long does a change take? Can staging be registered too?
4. Are store builder **subdomains** (`<store>.<ourdomain>.ir`) accepted as separate Torob shops, or must each store have its own domain?
   How does `shop_domain` matching treat subdomains?
5. Must each store first register as a shop in Torob (the connection returns 404 "No shop has this domain." otherwise)? Can a store
   builder register shops on behalf of merchants, or must each merchant sign up?
6. Product API v3 for store builders: one endpoint per store (`https://<store>/torob_api/v3/products`) or one platform endpoint with a shop
   identifier? How do we register the endpoint URL for each store?
7. Token guide: JWT algorithm, public key distribution and rotation, claims (does the JWT identify the shop/domain?), clock skew, and the
   IP ranges Torob calls from.
8. Is `date_updated_desc` mandatory for us as a store builder (the spec says so for "shop builders")? Is cursor mode (`product_id_desc`)
   expected?
9. Webhook: does the partner token work for `update/webhook/v1/` for connected shops, or does each shop need its own webhook token? Is the
   20 req/min limit per shop or per token?
10. Rate limits for the Shop Generator API; is the Shop API 5 req/s limit per shop shared across all our calls?
11. Is there a sandbox or test shop for integration testing?
12. Is a shop-initiated disconnect notified to us (callback/webhook), or only visible as 403 / `GET` status?
13. Order tracking API (`order_tracking_api.md`): is it expected from store builders for TorobPay/guarantee programmes?
14. Variants: should each variant be a separate `page_unique` with a shared `product_group_id`, and must each variant have its own
    `page_url`?

---

## M. Emalls

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| M1 | Contact Emalls | No documentation in hand; nothing implemented | Platform description | Emalls listing only | Now (A7) | Not started | Contact established |
| M2 | Obtain official merchant / product-feed documentation | Do not build on guesses | M1 | Same | After M1 | Blocked (M1) | Spec file stored with the project docs |
| M3 | Confirm registration and access requirements (per store vs store builder, eNamad, auth, IPs) | Same questions as Torob §T Q1–Q6 | M2 | Same | After M2 | Blocked (M2) | Written answers |
| M4 | Implement and test the feed | Reuse the `feeds` module mapping | M2–M3 | Same | After M3 | Blocked (M2) | Emalls validates a test store's feed |

---

## O. Other external services and accounts

| ID | Task | Why | Needs | Provider | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|---|
| O1 | Navasan account and key | Linked gold/USD prices (provider `navasan`) | Paid plan **[CONFIRM]**; the documented API is plain HTTP (key travels unencrypted unless HTTPS works) — confirm HTTPS endpoint and price unit (toman/rial) | Navasan | Only rate-linked prices (manual mode works without it) | Before enabling | Not started | One live answer checked; unit set; HTTPS confirmed or risk accepted |
| O2 | Bale bot for alerts | Ops alerts (D14-3) | Bot token + chat id | Bale | Yes (alerts) | B8 | Not started | `pnpm alert:test` received |
| O3 | Email (SMTP) | Transport exists; **no live flow sends email today**. Needed only if password reset by email or merchant notifications are added | SMTP host, TLS, SPF/DKIM/DMARC | ParsPack (decided) | No (today) | When a flow needs it | Not started | Decision recorded; if used, delivery to Gmail/Outlook verified |
| O4 | Error tracking server (GlitchTip) | Error reports (`ERROR_TRACKING_DSN`) | Separate host or hosted service | Self-hosted / provider | No | B8 | Not started | Test error appears |
| O5 | Uptime monitor | External check of `/api/ready` | Service reachable from inside and outside Iran | Provider TBD | Yes | B8 | Not started | Alert on simulated downtime |
| O6 | Docker mirror / registry | Docker Hub blocked from Iran | Mirror (ArvanCloud/ParsPack) or `ghcr.io` | Provider | Yes | B9 | Not started | Build/pull works from the server |
| O7 | AI provider | Settings only; nothing calls a model | — | TBD | No | When an AI feature is built | Not started | — |
| O8 | Custom domains for merchants | **Not implemented**; needs on-demand TLS (Caddy `on_demand` with an `ask` endpoint), DNS verification (TXT/CNAME), abuse limits | Design + Caddy config | — | No | Product roadmap (phase 5) | Not started | Design approved; verified domain gets a certificate |
| O9 | Git hosting fallback | International outage | Domestic mirror (phase14 T1) | TBD | No | B10 | Not started | Mirror updated by CI or manually documented |

---

## Summary: main blockers and recommended order

**Hard blockers for any production deployment:** business identity decision (A6/L1) → domain (A4) → ParsPack questions answered and tested
(A2) → static-IP server (A3/A5) → staging with TLS wildcard, storage policy, backups + restore drill, alerts (B1–B11) → legal pages (C3) →
release gate (C4).

**Feature blockers (platform can launch with these switched off):** Kavenegar account + approved templates (S1–S3) for OTP/order SMS;
Zarinpal/Aghaye Pardakht onboarding answers and a real payment test (P1–P3); Torob partner access + IP registration (T1–T3); Emalls
documentation (M1–M2); eNamad questions for the platform and for merchants (L3–L4).

**Recommended execution order**
1. Now, in parallel with development: L1/A6 identity decision; open conversations with Torob (T1, questions above), Emalls (M1), Kavenegar
   (S1), Zarinpal/AP (P1–P2); collect documents (L9).
2. Continue development with mocks: Product API v3 feed endpoint (T6) against the published spec, Torob connection module behind a fake
   server (T4), custom domains design (O8).
3. Domain purchase (A4), ParsPack tests on an hourly server (A2), then server purchase with static IP (A3/A5).
4. Staging setup and drills (B1–B11).
5. Register IPs with Torob (T3), enter platform secrets (C2), templates/payment tests (S6, P3).
6. Production environment (C1–C4), eNamad for the platform (L3), public launch (D), then post-launch routines (E).
