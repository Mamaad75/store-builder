#!/usr/bin/env bash
# Database backup (phase 13). Produces a verified, checksummed pg_dump custom-format file and prunes old ones.
#
# Modes (BACKUP_MODE):
#   direct  (default) uses a local pg_dump and DATABASE_URL           - development, tests, a host with the right client version
#   compose           runs pg_dump INSIDE the production postgres container (always the matching server version)
#                     COMPOSE_ARGS selects the stack (default: -f docker-compose.prod.yml --env-file .env.production)
# Settings: BACKUP_DIR (default ./backups), RETENTION_DAYS (default 14, 0 = keep everything),
#           BACKUP_AFTER_HOOK (optional executable called as: hook <dump file>; use it to copy the file OFF the server),
#           BACKUP_FAILURE_HOOK (optional executable called as: hook "backup.failed: <reason>" on ANY failure, e.g.
#                                scripts/notify-bale.sh for a Bale alert; its own failure never changes the exit code, which stays 1).
# The database URL/password is never printed. A backup that cannot be read back by pg_restore --list is deleted and fails the run.
set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MODE="${BACKUP_MODE:-direct}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/storebuilder-${STAMP}.dump"
mkdir -p "${BACKUP_DIR}"

log() { printf '{"ts":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}"; }
fail() {
  log "backup.failed" ",\"reason\":\"$1\""
  rm -f "${OUT}.partial"
  if [ -n "${BACKUP_FAILURE_HOOK:-}" ]; then "${BACKUP_FAILURE_HOOK}" "backup.failed: $1" >&2 || true; fi
  exit 1
}

case "${MODE}" in
  direct)
    : "${DATABASE_URL:?DATABASE_URL is required for BACKUP_MODE=direct}"
    # shellcheck source=scripts/lib-pg.sh
    source "$(dirname "${BASH_SOURCE[0]}")/lib-pg.sh"
    ( pg_env_from_url "${DATABASE_URL}" && pg_dump --format=custom --no-owner --no-privileges > "${OUT}.partial" ) || fail "pg_dump_failed"
    verify() { pg_restore --list "$1" >/dev/null; }
    ;;
  compose)
    # COMPOSE_ARGS is split on spaces on purpose (it holds flags such as: -p name -f file --env-file file)
    # shellcheck disable=SC2206
    DC=(docker compose ${COMPOSE_ARGS:--f docker-compose.prod.yml --env-file .env.production})
    "${DC[@]}" exec -T postgres sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' > "${OUT}.partial" || fail "pg_dump_failed"
    verify() { "${DC[@]}" exec -T postgres pg_restore --list < "$1" >/dev/null; }
    ;;
  *) fail "unknown_backup_mode" ;;
esac

[ -s "${OUT}.partial" ] || fail "empty_dump"
verify "${OUT}.partial" || fail "dump_not_readable"
mv "${OUT}.partial" "${OUT}"
( cd "${BACKUP_DIR}" && sha256sum "$(basename "${OUT}")" > "$(basename "${OUT}").sha256" )
SIZE="$(wc -c < "${OUT}" | tr -d ' ')"
log "backup.created" ",\"file\":\"$(basename "${OUT}")\",\"bytes\":${SIZE}"

if [ "${RETENTION_DAYS}" != "0" ]; then
  PRUNED="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'storebuilder-*.dump*' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
  log "backup.pruned" ",\"files\":${PRUNED},\"olderThanDays\":${RETENTION_DAYS}"
fi

if [ -n "${BACKUP_AFTER_HOOK:-}" ]; then
  "${BACKUP_AFTER_HOOK}" "${OUT}" || fail "after_hook_failed"
  log "backup.hook_ok"
fi
