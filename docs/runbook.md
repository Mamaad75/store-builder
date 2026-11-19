# Operations runbook (phase 13)

Written and tested against the **CI smoke stack** (`scripts/ci-container-smoke.sh`). Nothing here has been run on a real server: the real
deployment is phase 14 and starts only after your explicit approval and the purchasing checklist. Commands assume the repository checkout
on the server, `.env.production` filled in (mode 600, never committed) and Docker Compose v2.

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
```

## Stack
`caddy` (TLS edge, only published ports 80/443) → `app` (Next.js standalone, port 3000 on the edge network) → `api` (NestJS, port 4000, internal network only: sign-in, sessions) → `postgres` (internal network only). `app` starts only when `api` is healthy.
`migrate` is a one-shot job (`prisma migrate deploy` + idempotent theme seed) that must finish before `app` and `scheduler` start. `scheduler` runs
the media cleanup every 30 min and the db cleanup every 15 min (the same scripts as `pnpm media:cleanup` / `pnpm db:cleanup`, started through `tsx`
directly). Object storage is external (`S3_*`).
`/api/ready` results are shared for 5 s per app process (concurrent requests share one probe), so a dependency coming back or going away shows
up within 5 s; it is public, and this keeps request volume from driving database queries and billed object-store LIST calls.

## Deploy / update
1. `git fetch && git checkout <release commit>` (a commit whose CI run is green, including the container job).
2. Take a backup first (below). `$DC build`.
3. `$DC up -d`. Compose reruns `migrate` (a no-op when nothing is pending), then recreates `app`/`scheduler` whose image changed.
4. Verify: `curl -fsS https://<root>/api/ready` → `{"status":"ready",…}`; `$DC ps` shows `api`, `app`, `postgres` healthy; `$DC logs --since 5m app scheduler | grep '"level":"error"'` is empty.

Migrations are forward-only. A migration that cannot be undone by the application version before it must say so in its pull request; take the backup immediately before.

## Roll back the application
`git checkout <previous release>`, `$DC build`, `$DC up -d`. This is safe when the newer release added **no migration**, or only additive ones (new tables/columns the old code ignores).
If a destructive migration shipped, roll back by **restoring the pre-deploy backup** (below) and the previous code together; data written since is lost, so decide with the backup's timestamp in hand.

## Backups
```bash
BACKUP_MODE=compose COMPOSE_ARGS="-f docker-compose.prod.yml --env-file .env.production" BACKUP_DIR=/var/backups/storebuilder bash scripts/backup.sh
```
Runs `pg_dump -Fc` **inside the postgres container** (matching server version), proves the dump is readable (`pg_restore --list`), writes `<file>.sha256`, deletes dumps older than `RETENTION_DAYS` (14) and logs JSON lines (`backup.created` / `backup.failed`). A failed or unreadable dump leaves no file and exits 1.
* **Off-server copy is mandatory** and not done by the script: set `BACKUP_AFTER_HOOK=/path/to/executable` (called with the dump path; a non-zero exit fails the backup). The destination, schedule and credentials are phase 14 decisions.
* The database holds everything except **images**: those are objects in the S3 bucket. Back them up with the provider's versioning/replication or an `mc mirror`/`rclone sync` of the bucket. A restored database references image keys; without the objects those images are gone.
* Schedule the backup like any other job (cron/systemd timer) and alert on a non-zero exit or a missing file older than 26 h.

## Restore drill (do it before launch and every quarter)
Restore into a **new** database first and inspect it; never into the live one.
```bash
BACKUP_MODE=compose COMPOSE_ARGS="-f docker-compose.prod.yml --env-file .env.production" RESTORE_DB=restore_drill bash scripts/restore.sh /var/backups/storebuilder/storebuilder-<stamp>.dump
```
The target name must be a plain identifier (letters, digits, underscore). It verifies the checksum, refuses an existing database unless `RESTORE_REPLACE=yes`, restores with `--exit-on-error` and prints `restore.done` with the user/store/version counts, which you compare with production. Then `DROP DATABASE restore_drill`.
**Disaster recovery** (live database lost): bring up `postgres` alone, restore into the real database name (`RESTORE_DB=<POSTGRES_DB>`, `RESTORE_REPLACE=yes` if it exists), then `$DC up -d` (migrate verifies the schema). Record the time it took: that is the real recovery time.
The same flow runs automatically in CI against the smoke stack (counts compared with the live smoke database).

## Scheduler and the media-cleanup gate
`$DC logs scheduler` shows one JSON line per run: `job.start`, then `job.finish` (info) or `job.failed` (**error**, with `exitCode`, `class`: `failed_items` = exit 2, `crashed`, `timeout`, and `consecutiveFailures`). A failed run is simply retried at the next interval; a failed item stays in the database and is retried too.
Each job runs in its own process group: a `timeout` kills the whole job tree (no orphaned job can keep running into the next run), and stopping the container sends SIGTERM to every running job (`init: true` forwards signals and reaps processes).
Health: `$DC exec scheduler pnpm scheduler:health` (exit 1 when a job has not **succeeded** for 3 intervals; compose uses it as the container health check). Manual run: `$DC run --rm --no-deps scheduler pnpm media:cleanup`.
This covers items 1 and 2 of the phase 14 gate (D10-13) mechanically. **Still phase 14:** shipping the `job.failed` / `scheduler.unhealthy` / `media.*_failed` lines to a log pipeline with an alert, proving recovery of an injected failure in staging, and testing the scheduled job in staging before production.

## Alerts (Bale, D14-3)
* **Set up:** create a bot with `@botfather` in Bale, put `BALE_BOT_TOKEN` and `BALE_CHAT_ID` (the chat or group that receives alerts) into `.env.production`, `$DC up -d scheduler`, then prove the channel: `$DC run --rm --no-deps scheduler pnpm alert:test` (exit 0 only when Bale accepted the message).
* **What alerts today:** every failed scheduled run (`job.failed`, with job, exit code, class and failure streak) and the first success after failures (`job.recovered`), from the scheduler; a failed backup through `BACKUP_FAILURE_HOOK=scripts/notify-bale.sh` (host side, needs `curl` and the same two variables in the host environment of the backup cron job).
* **Not yet alerting:** a scheduler that is down altogether, `scanTruncated` on consecutive runs and readiness failures: add an external uptime monitor on `https://<root>/api/ready` and keep the container health check; these remain items of the phase 14 monitoring checklist.
* Both variables empty = alerts off (the scheduler logs `alert.disabled`); half or malformed values stop the scheduler at start (`startup.refused`, names only). The token is part of the request URL, so no URL is ever logged; a failed delivery is one `alert.failed` line and never fails the job.

## Secrets
Live only in `.env.production` on the server (mode 600) and in the provider consoles. Never in git, CI, chat or the image (the build context excludes `.env*`; a CI step greps all container logs for the generated secrets).
* **AUTH_SECRET** (read by the `api` service only) rotation signs everyone out (all session tokens become invalid): `openssl rand -base64 32`, edit `.env.production`, `$DC up -d api`.
* **POSTGRES_PASSWORD**: `ALTER USER … PASSWORD …` in the container, then update `.env.production` and `$DC up -d`.
* **S3 keys**: create the new key pair at the provider, update `.env.production`, `$DC up -d app scheduler`, check `/api/ready` (it lists the bucket with the new key), revoke the old key.
* A suspected leak: rotate first, investigate second.

## Incidents: first five minutes
1. `curl -fsS https://<root>/api/ready` and `$DC ps`. `503` names the failing dependency (`database` / `storage`).
2. `$DC logs --since 15m app | grep '"level":"error"'`; `startup.refused` lines name the invalid variable. Caddy: `$DC logs caddy`.
3. Database down → check disk (`df -h`, `docker system df`), then `$DC restart postgres`; restore only if the data directory is damaged.
4. Bad release → roll back as above.
5. Publishing stuck/slow → `pnpm publish:stats`-style investigation in `docs/publishing.md`; the draft lock timeout (5 s) and the publish lock budget keep the platform responsive meanwhile.

## What this runbook does not cover (phase 14)
Server provisioning and hardening, DNS and wildcard certificates (Caddy needs the DNS-provider module and token), the off-server backup target, monitoring and alert routing, mail transport, final legal text, the first real deployment.
