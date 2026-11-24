# Production readiness and external dependencies checklist

> **Status of this document:** living checklist, created 2026-11-24, reviewed against the code the same day (§R). Nothing here has been bought, created, registered or deployed.
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
| Valkey (Redis-compatible) | Yes: BullMQ queue for the outbox relay, event handlers and scheduled maintenance jobs; self-hosted container, AOF on, `noeviction` (`docs/async.md`) | `docker-compose.prod.yml`, `apps/api/src/worker` | `REDIS_URL`, `VALKEY_PASSWORD` | — |
| Rate limiting | Yes, in PostgreSQL (`RateLimitBucket`, one upsert per limited request) | `apps/api/src/lib/rate-limit.ts` | `RATE_LIMIT_BACKEND=postgres` | — |
| S3-compatible object storage | Yes (product/store images) | `apps/api/src/lib/storage`, `docs/media.md` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL` | — |
| Caddy reverse proxy + TLS (ACME DNS-01 wildcard) | Yes (config + Dockerfile) | `docker/caddy/`, `docker-compose.prod.yml` | `CADDY_DNS_MODULE`, `DNS_API_TOKEN`, `CADDY_TLS_DIR` | TLS snippet per DNS provider still to generate (phase14 K2) |
| Domain + DNS (root, `www`, `*` wildcard) | Platform subdomains: yes. **Custom merchant domains: data model only** (`Domain` rows with `kind CUSTOM`, `host`, `verifiedAt` exist; nothing creates or verifies them, the host policy accepts only the root domain and its subdomains, and Caddy serves only `{root}, www.{root}, *.{root}`) | `apps/web/src/lib/host-policy.ts`, `docker/caddy/Caddyfile` | `APP_ROOT_DOMAIN`, `APP_PROTOCOL` | — |
| Kavenegar SMS | Yes: customer OTP (`verify/lookup`) and order SMS (templates) | `apps/api/src/platform/sms`, `modules/notifications` | Platform secret (Kavenegar API key) + template names in `/platform` | **Off** |
| Zarinpal (REST v4) | Yes: per-store merchant id, verify, inquiry, reconciler; refund via `reverse` **not** implemented | `modules/orders/infrastructure/zarinpal.ts` | Store secret `payment.zarinpal.merchant_id`; platform switch + sandbox flag | **Off**, sandbox on |
| Aghaye Pardakht | Yes: per-store gateway pin; no automatic refund | `modules/orders/infrastructure` | Store secret (gateway pin); platform switch | **Off** |
| Card-to-card | Yes (no external provider; receipts stored in PostgreSQL) | `modules/orders` | — | Per store |
| Navasan (gold/USD rates) | Yes: hourly reader, jump/stale guard; documented API is plain HTTP | `modules/pricing/infrastructure/navasan.ts` | Platform secret `rates.navasan.api_key` | **Off** (`provider: off`) |
| Bale bot (ops alerts) | Yes | `apps/api/src/lib/alert.ts` | `BALE_BOT_TOKEN`, `BALE_CHAT_ID`, optional `BALE_API_BASE` | Off when unset |
| Error tracking (Sentry protocol, GlitchTip planned) | **Partial:** reporter in API, worker and web; no server installed by this repo | `packages/shared/src/observability` | `ERROR_TRACKING_DSN`, `ERROR_TRACKING_ENVIRONMENT` | Off when unset |
| Prometheus metrics | **Partial:** `/metrics` on a separate port in API and worker; Prometheus only in the optional `docker-compose.observability.yml`; no dashboards, no metric-based alert rules | `docs/observability.md` | `METRICS_PORT`, `METRICS_HOST` | — |
| Container logs | **Partial:** JSON logs, Docker `json-file` rotation (20 MB × 5 per container); no central log store, no retention policy beyond rotation | `docker-compose.prod.yml` | — | — |
| SMTP email | Transport implemented (`smtp.ts`), **no user-facing flow currently sends email** (sign-in is by username since ADR 0001 U1; password reset by email is not wired) | `apps/web/src/modules/auth` | `MAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM` | `none` |
| AI provider | **Settings only**; nothing calls a model | `packages/shared/src/modules/platform/settings.ts` | Platform secret (AI key) | **Off** |
| Torob (Product API v3, webhook, Shop Generator, Shop API) | **Not implemented** | — | — | — |
| Emalls feed | **Not implemented**; no documentation obtained | — | — | — |
| eNamad / Samandehi badges | **Not implemented** (no badge slot in footer/themes) | — | — | — |
| Merchant subscription billing / plans | **Missing.** No plan, subscription or invoice model. Limits are global constants, not per plan: 10 stores per user, 500 products and 100 MB media per store, 200 discount codes per store. A platform-own Zarinpal merchant id secret slot exists, unused | `packages/shared/src/modules/*/schemas.ts` | — | — |
| Merchant identity / verification | **Missing.** Open self-registration with username + password; merchants have no phone, email or identity on record; no 2FA for merchants or platform admins | `apps/web/src/app/(auth)/register` | — | — |
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

> **ADR 0004 (owner decision 2026-11-24):** the Kavenegar account, line, templates and key are set up **only in the final deployment
> phase**, on the production server. Until then development and UI testing use the development-only senders (`CUSTOMER_OTP_DEV_LOG`,
> `ORDER_SMS_DEV_LOG`, refused outside development/test); none of S1–S8 blocks development. Production never accepts fixed or
> development codes.

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

## K. Multi-tenant custom domains (missing; product + infrastructure)

Today every store is `<label>.<root>`; one wildcard certificate covers all of them. A merchant's own domain changes TLS, routing, cookies,
payments and feeds, so it needs a design decision before code.

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| K1 | Decide whether custom domains are in the launch scope | Merchants with eNamad / their own gateway terminal usually need their own domain **[CONFIRM L4, P1]** | Owner decision | First merchants who need it | Before merchant onboarding | Not started | Decision recorded |
| K2 | Domain verification design | Prevent claiming someone else's domain | TXT record with a per-store token (or CNAME to `<label>.<root>`), re-check schedule, removal when the record disappears | — | Design phase | Not started | Design approved (ADR) |
| K3 | Certificates for arbitrary hosts | Wildcard DNS-01 cannot cover foreign domains | Caddy `on_demand_tls` with an `ask` endpoint that answers yes only for verified `Domain` rows; rate limit; HTTP-01/TLS-ALPN-01 reachable on 80/443; Let's Encrypt rate limits (per registered domain, per account) | — | Design phase | Not started | A verified test domain gets a certificate; an unverified one gets none |
| K4 | Host routing and security | Host policy, CSRF/origin checks, cookies, CSP, canonical/sitemap, `sb_pay` return cookie | List of every place that assumes `*.root` (`host-policy.ts`, `origin.guard.ts`, proxy, SEO) | — | Design phase | Not started | Tests cover a custom host end to end |
| K5 | Provider side effects | Zarinpal/AP callback domain, Torob `shop_domain`, Emalls, eNamad all key on the domain | Answers from P1, T Q4, M3, L4 | — | With K2 | Not started | Each provider's rule recorded |
| K6 | DNS instructions and support load | Merchants must set records themselves | Persian help page, status display in dashboard | — | Before release of K | Not started | Help page published |

## BL. Subscription billing and plan enforcement (missing; product decision first)

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| BL1 | Pricing and plans (free/trial/paid; what each includes) | Revenue; "300 paying stores" needs it | Owner decision: prices, limits per plan (products, media, staff, SMS cap, gateways, custom domain), trial length | Paid stores | Before first paying merchant | Not started | Plan table approved |
| BL2 | Plan model and enforcement in code | Today limits are global constants | Design: `Plan`, `Subscription` (status, period, grace), per-plan limits read where constants are used today | Paid stores | After BL1 | Not started | Limits come from the plan; tests for downgrade/over-limit |
| BL3 | Payment of subscriptions | Platform's own terminal | P4, L1–L3 | Paid stores | After BL1 | Blocked (L1) | A subscription paid in sandbox, then live |
| BL4 | Invoices and tax | Merchants (businesses) may need official invoices **[CONFIRM L2, and whether the tax authority's e-invoice system (سامانه مودیان) applies]** | Accountant | Paid stores | Before charging | Not started | Invoice format and obligation confirmed |
| BL5 | Non-payment policy | What happens to the storefront and data when a subscription lapses | Owner decision: grace days, read-only dashboard, storefront off, data retention | Paid stores | With BL1 | Not started | Policy in terms (C3) and in code |
| BL6 | Refunds / cancellation of subscriptions | Consumer and contract rules | Lawyer | Paid stores | With C3 | Not started | Policy published |

## MO. Merchant onboarding, verification and abuse

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| MO1 | Decide the merchant verification level | Today anyone can register and publish a store on our domain; fraudulent stores harm shoppers and the platform's domain reputation and provider relations | Owner + lawyer decision: none / verified mobile / national ID; what is required before publishing, taking online payment or card-to-card | First real merchant | Before onboarding | Not started | Policy recorded |
| MO2 | Verified merchant contact | No merchant phone or email on record today (the merchant SMS phone is a per-store setting) | Design: verified mobile on the user account | Support, billing | Before onboarding | Not started | Every merchant has a verified contact |
| MO3 | Abuse and takedown process | Phishing/scam stores, counterfeit goods, illegal products **[CONFIRM legal obligations]** | Report channel, who decides, evidence retention, and a **platform-level store suspension** (missing today: `StoreStatus` has only DRAFT / PUBLISHED / UNPUBLISHED, set by the merchant; platform admins have no suspend action) | Public launch | Before D | Not started | Procedure documented and rehearsed |
| MO4 | Prohibited goods / acceptable use policy | Part of terms; providers may require it | Lawyer | Public launch | With C3 | Not started | Published |
| MO5 | Onboarding guide | Merchants must set up gateway terminal, card-to-card cards, shipping, SMS | Persian help pages | First merchant | Before onboarding | Not started | Guide reviewed with one pilot merchant |

## SEC. Security, secrets and production access

| ID | Task | Why | Needs | Blocks | When | Status | Done when |
|---|---|---|---|---|---|---|---|
| SEC1 | Production access list | Who can SSH, who holds provider logins and master keys | Named people, one key per person, no shared accounts | Yes | B2 | Not started | Access list in a private place; revocation procedure written |
| SEC2 | 2FA on every provider account | Domain, DNS, server, storage, Kavenegar, Zarinpal, Torob, Bale | — | Yes | At account creation | Not started | Verified per account |
| SEC3 | 2FA (or equivalent) for platform super admins | Super admins can read settings, change platform secrets and see all stores; today password only | Product decision + code | Public launch | Before D | Not started | Decision recorded; implemented or risk accepted |
| SEC4 | Master-key custody and break-glass | Losing `SECRETS_MASTER_KEYS` loses every stored provider key | Offline copy in two places held by the owner | Yes | B11 | Not started | Restore of secrets from the offline copy rehearsed |
| SEC5 | Independent security review / penetration test | Money and personal data | External reviewer | Public launch | Before D | Not started | Findings fixed or accepted |
| SEC6 | Vulnerability disclosure contact | Reports must reach someone | `security.txt` / contact address | No | Before D | Not started | Published |
| SEC7 | Personal data handling | Shopper phones, addresses, receipts (images of bank transfers) | Retention periods (receipts, orders, OTP, audit 365 days already), export and deletion on request, store deletion behaviour **[CONFIRM legal retention for order/financial records]** | Public launch | With C3 | Not started | Retention table approved; deletion path tested |

## MON. Monitoring, logging and alerting (additions to B8)

| ID | Task | Why | Done when | Status |
|---|---|---|---|---|
| MON1 | Business alerts | Payment reconciler stuck, `REFUND_REQUIRED` orders, SMS send failures, Kavenegar low credit, receipt reviews waiting too long | Each raises a Bale alert in a staging drill | Not started |
| MON2 | Central logs | Container rotation keeps only ~100 MB per service; incidents need longer history | Decision: Loki/hosted/none; retention set | Not started |
| MON3 | Capacity metrics | Disk (DB + receipts + backups), Postgres connections, Valkey memory (`noeviction` stops the queue when full), queue depth | Dashboards + threshold alerts | Not started |
| MON4 | Certificate expiry and domain renewal alerts | International outage can block renewal | Alert ≥ 21 days before expiry | Not started |

## SC. Scaling to ~300 paying stores

The current design is a single server (Caddy, web, API, worker, PostgreSQL, Valkey). Nothing below is a known problem today; each item is
a measurement to make before that size, not a rewrite.

| ID | Task | Why | Done when | Status |
|---|---|---|---|---|
| SC1 | Load test with realistic data | 300 stores × up to 500 products, storefront traffic, checkout | p95 latency and CPU/RAM recorded; server size chosen from data | Not started |
| SC2 | Database growth plan | Card-to-card receipt images are stored in PostgreSQL (`bytea`): DB and every backup grow with them | Size projection; decision to keep or move receipts to private object storage | Not started |
| SC3 | Rate-limit table load | Every limited request writes to `RateLimitBucket` in PostgreSQL | Measured under load; Valkey backend considered if needed | Not started |
| SC4 | Image delivery | Bucket egress cost and latency | CDN in front of `S3_PUBLIC_BASE_URL` decided | Not started |
| SC5 | External crawlers | Torob/Emalls feeds and search engines read 300 stores | Feed endpoint cached / rate limited; measured | Not started |
| SC6 | Backup and restore time at size | Restore time grows with DB size | Restore drill at projected size meets RTO | Not started |
| SC7 | SMS and support cost | Platform pays order SMS; support load per merchant | Budget per store matches plan prices (BL1) | Not started |
| SC8 | Second server / managed DB decision | Single point of failure | Decision recorded with RPO/RTO (B10) | Not started |

## R. Review of this checklist (2026-11-24)

**Corrections made:** the queue is self-hosted **Valkey** (not "Redis"); rate limiting runs in PostgreSQL; custom domains have a data model
(not "nothing"); error tracking, metrics and logs are **partial**; billing and merchant verification are **missing**, not just "not
implemented".

**Classification of external dependencies**

| Dependency | Classification |
|---|---|
| PostgreSQL, Valkey, S3 storage, Caddy | Implemented (needs production provisioning) |
| Kavenegar (OTP, order SMS), Zarinpal, Aghaye Pardakht, Navasan | Implemented, **disabled by default** |
| Bale alerts | Implemented, disabled until configured |
| Caddy wildcard TLS | Partially implemented (DNS-provider snippet to generate, phase14 K2) |
| Error tracking, metrics, logs | Partially implemented |
| SMTP email | Implemented but unused by any flow |
| AI provider | Disabled placeholder (settings only) |
| Custom domains | Partially implemented (data model only) |
| Torob, Emalls, eNamad badge, subscription billing, merchant verification, 2FA, platform store suspension | Missing |

**Duplicates (kept on purpose, cross-referenced):** A7 is the umbrella for T1, M1, S1, P1–P2; C2 overlaps S4/O1 (C2 is the general rule);
E7 is T5 after launch; D1–D3 point to §P, §S and L3.

**Assumptions that are still unverified:** that each store using its own gateway terminal needs no platform licence (L6); that platform
subdomains are acceptable to Zarinpal, eNamad and Torob as a merchant's site (L4, P1, T Q4); that ParsPack's public bucket blocks anonymous
LIST (A2); that the server's outbound IP equals its public IP (A5); that Navasan offers HTTPS (O1).

**Unresolved decisions (owner):** legal form (L1); launch scope of custom domains (K1); plans and prices (BL1); merchant verification level
(MO1); non-payment policy (BL5); RPO/RTO (B10); central logging (MON2); 2FA for admins (SEC3); receipts storage location (SC2); T8, T10, T12
from phase14.

## G. Gates: what must be done before each milestone

**1. Internal staging** (team only, sandbox gateways, no real shoppers)
A1–A5, A2 tests, B1–B9, B11, SEC1, SEC2, SEC4, O2, O6. Legal and provider items not required.

**2. First real merchant onboarding** (pilot, real orders)
Everything in gate 1, plus: B10, C1, C2, C4; MO1, MO2, MO5; K1 decided (and K built if the pilot needs its own domain); L1, L3/L4 answers,
L6, L7; C3 legal pages; P1 + P3 if online payment is offered (else COD/card-to-card only); S1–S3, S6–S8 if SMS is on; MON1; BL1 decided and
BL5 written even if the pilot is free.

**3. Public launch** (open registration)
Everything in gate 2, plus: MO3, MO4, SEC3, SEC5, SEC6, SEC7, D4, D5, MON2–MON4, L3 issued for the platform, BL2–BL4 if paid plans start at
launch, E2 reminders in place.

**4. Scaling to 300 paying stores**
Everything above, plus: BL2–BL6 live, SC1–SC8, quarterly restore drills (E1), payment and SMS reviews (E3, E4), Torob/Emalls only if their
access is granted (§T, §M), K built if a meaningful share of merchants needs their own domain.

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
