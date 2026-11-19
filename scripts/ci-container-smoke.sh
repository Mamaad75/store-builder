#!/usr/bin/env bash
# CI only (phase 13): builds the production images, boots the production compose stack with throw-away credentials, proves it works
# end to end (readiness, headers, a real browser flow through Caddy, jobs, scheduler health, backup + restore drill) and tears it down.
# Nothing is pushed to a registry and no real secret exists: every credential below is generated for this run and discarded with it.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8443
WORK="$(mktemp -d)"
ENVF="${WORK}/smoke.env"
S3_KEY="smokekey$(openssl rand -hex 4)"
S3_SECRET="$(openssl rand -hex 16)"
BUCKET="smoke-media-test"
umask 077
cat > "${ENVF}" <<EOF
APP_ROOT_DOMAIN=localhost:${PORT}
APP_PROTOCOL=https
POSTGRES_USER=smoke
POSTGRES_DB=smoke
POSTGRES_PASSWORD=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -base64 33)
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=${BUCKET}
S3_ACCESS_KEY_ID=${S3_KEY}
S3_SECRET_ACCESS_KEY=${S3_SECRET}
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_BASE_URL=http://127.0.0.1:9000/${BUCKET}
MAIL_TRANSPORT=none
EOF
DC=(docker compose -p smoke -f docker-compose.prod.yml -f docker-compose.smoke.yml --env-file "${ENVF}")

dump_logs() { echo "::group::compose ps"; "${DC[@]}" ps -a || true; echo "::endgroup::"; echo "::group::compose logs"; "${DC[@]}" logs --no-color --tail=200 || true; echo "::endgroup::"; }
cleanup() { code=$?; [ "${code}" -ne 0 ] && dump_logs; "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "${WORK}"; exit "${code}"; }
trap cleanup EXIT

step() { echo "::group::$*"; }
endstep() { echo "::endgroup::"; }

step "build images (app, jobs, caddy)"
"${DC[@]}" build
endstep

step "image hygiene"
APP_IMG="$("${DC[@]}" images -q app | head -1)"
[ "$(docker inspect --format '{{.Config.User}}' storebuilder-app:local)" = "node" ] || { echo "app image must run as the node user" >&2; exit 1; }
docker run --rm --entrypoint sh storebuilder-app:local -c '
  set -e
  test -f server.js                       # WORKDIR /app/apps/web (pnpm workspace, ADR 0001 N1)
  ! test -e src && ! test -e scripts && ! test -e .env && ! test -e prisma/migrations
  ! test -e node_modules/typescript && ! test -e node_modules/.bin/tsx
  ! test -e /app/node_modules/typescript && ! test -e /app/node_modules/.bin/tsx && ! test -e /app/node_modules/.pnpm/typescript@*
  test "$(id -u)" != 0
' || { echo "app image contains files it must not ship or runs as root" >&2; exit 1; }
echo "app image: non-root, standalone only (${APP_IMG})"
endstep

step "start object storage and create the isolated bucket"
"${DC[@]}" up -d minio
for i in $(seq 1 45); do curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1 && break; sleep 2; done
TEST_S3_ENDPOINT=http://127.0.0.1:9000 TEST_S3_ACCESS_KEY_ID="${S3_KEY}" TEST_S3_SECRET_ACCESS_KEY="${S3_SECRET}" TEST_S3_BUCKET="${BUCKET}" \
  pnpm --filter @store-builder/web exec tsx scripts/ci-ensure-bucket.ts
endstep

step "start the production stack"
"${DC[@]}" up -d
for i in $(seq 1 90); do
  if curl -ksf "https://localhost:${PORT}/api/ready" >/dev/null 2>&1; then echo "ready after ${i} checks"; break; fi
  [ "${i}" -eq 90 ] && { echo "stack did not become ready" >&2; exit 1; }
  sleep 3
done
for svc in postgres app; do
  st="$("${DC[@]}" ps -q "${svc}" | xargs docker inspect --format '{{.State.Health.Status}}')"
  [ "${st}" = "healthy" ] || { echo "${svc} is ${st}, expected healthy" >&2; exit 1; }
done
echo "postgres and app report healthy; migrate exit code: $("${DC[@]}" ps -a -q migrate | xargs docker inspect --format '{{.State.ExitCode}}')"
endstep

step "browser smoke test through Caddy"
SMOKE_PORT="${PORT}" pnpm --filter @store-builder/web exec playwright test -c playwright.smoke.config.ts
endstep

step "jobs and scheduler"
"${DC[@]}" run --rm --no-deps scheduler pnpm media:cleanup
"${DC[@]}" run --rm --no-deps scheduler pnpm db:cleanup
for i in $(seq 1 30); do "${DC[@]}" exec -T scheduler pnpm scheduler:health >/dev/null 2>&1 && break; [ "${i}" -eq 30 ] && { echo "scheduler is not healthy" >&2; exit 1; }; sleep 2; done
"${DC[@]}" logs scheduler --no-color | grep -E '"event":"job.(finish|failed)"' | head -4
if "${DC[@]}" logs scheduler --no-color | grep -q '"event":"job.failed"'; then echo "a scheduled job failed" >&2; exit 1; fi
endstep

step "backup and restore drill (compose mode)"
BK="${WORK}/backups"
COMPOSE_ARGS="-p smoke -f docker-compose.prod.yml -f docker-compose.smoke.yml --env-file ${ENVF}" BACKUP_MODE=compose BACKUP_DIR="${BK}" bash scripts/backup.sh
DUMP="$(ls "${BK}"/*.dump)"
COMPOSE_ARGS="-p smoke -f docker-compose.prod.yml -f docker-compose.smoke.yml --env-file ${ENVF}" BACKUP_MODE=compose RESTORE_DB=restore_drill bash scripts/restore.sh "${DUMP}" | tee "${WORK}/restore.out"
LIVE="$(echo 'SELECT (SELECT count(*) FROM "User") || '"','"' || (SELECT count(*) FROM "Store") || '"','"' || (SELECT count(*) FROM "StoreVersion")' | "${DC[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq')"
grep -q "\"users_stores_versions\":\"${LIVE}\"" "${WORK}/restore.out" || { echo "restored counts differ from the live database (live: ${LIVE})" >&2; exit 1; }
echo "restore drill OK: users,stores,versions = ${LIVE}"
endstep

step "container logs contain no secret value"
printf '%s\n' "${S3_SECRET}" "$(grep '^POSTGRES_PASSWORD=' "${ENVF}" | cut -d= -f2-)" "$(grep '^AUTH_SECRET=' "${ENVF}" | cut -d= -f2-)" > "${WORK}/secrets.txt"
if "${DC[@]}" logs --no-color 2>&1 | grep -F -q -f "${WORK}/secrets.txt"; then
  echo "a secret value appears in the container logs" >&2
  exit 1
fi
endstep

echo "container smoke test passed"
