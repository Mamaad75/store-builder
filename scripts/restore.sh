#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into a database (phase 13). Used for the restore drill and for disaster recovery.
#
#   RESTORE_TARGET_URL=postgresql://user:pw@host/dbname  bash scripts/restore.sh backups/storebuilder-<stamp>.dump
#
# Safety: the checksum is verified first; the target database must NOT exist unless RESTORE_REPLACE=yes (then it is dropped and
# recreated). The script never reads DATABASE_URL, so it cannot hit the live database by accident: you must name the target.
# BACKUP_MODE=compose restores inside the production postgres container (RESTORE_DB = target database name, same rules).
set -euo pipefail
umask 077

DUMP="${1:?usage: restore.sh <dump file>}"
[ -f "${DUMP}" ] || { echo "no such file: ${DUMP}" >&2; exit 1; }
MODE="${BACKUP_MODE:-direct}"
REPLACE="${RESTORE_REPLACE:-no}"

log() { printf '{"ts":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}"; }

# The target name is interpolated into SQL and into `sh -c` inside the container, so only a plain identifier is accepted
# (letters, digits, underscore; PostgreSQL's 63-byte limit). Checked before any database or container is touched.
require_safe_db_name() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || { log "restore.failed" ',"reason":"invalid_database_name"'; exit 1; }
}

if [ -f "${DUMP}.sha256" ]; then
  ( cd "$(dirname "${DUMP}")" && sha256sum --check --status "$(basename "${DUMP}").sha256" ) || { log "restore.failed" ',"reason":"checksum_mismatch"'; exit 1; }
  log "restore.checksum_ok"
else
  log "restore.warning" ',"reason":"no_checksum_file"'
fi

case "${MODE}" in
  direct)
    : "${RESTORE_TARGET_URL:?RESTORE_TARGET_URL is required (the database to restore INTO)}"
    # shellcheck source=scripts/lib-pg.sh
    source "$(dirname "${BASH_SOURCE[0]}")/lib-pg.sh"
    DB_NAME="$( pg_env_from_url "${RESTORE_TARGET_URL}" && printf '%s' "${PGDATABASE}" )" || exit 1
    [ -n "${DB_NAME}" ] || { echo "cannot read the database name from RESTORE_TARGET_URL" >&2; exit 1; }
    require_safe_db_name "${DB_NAME}"
    (
      pg_env_from_url "${RESTORE_TARGET_URL}"
      export PGDATABASE=postgres
      exists="$(psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")"
      if [ "${exists}" = "1" ]; then
        [ "${REPLACE}" = "yes" ] || { log "restore.failed" ',"reason":"target_exists_set_RESTORE_REPLACE=yes_to_replace"'; exit 3; }
        psql -qc "DROP DATABASE \"${DB_NAME}\" WITH (FORCE)"
      fi
      psql -qc "CREATE DATABASE \"${DB_NAME}\""
    ) || exit 1
    # pg_restore connects through the PG* environment (-d names the database only), so no password is on the command line.
    ( pg_env_from_url "${RESTORE_TARGET_URL}" && pg_restore --no-owner --no-privileges --exit-on-error --dbname="${DB_NAME}" "${DUMP}" )
    COUNTS="$( pg_env_from_url "${RESTORE_TARGET_URL}" && psql -Atqc "SELECT (SELECT count(*) FROM \"User\") || ',' || (SELECT count(*) FROM \"Store\") || ',' || (SELECT count(*) FROM \"StoreVersion\")" )"
    ;;
  compose)
    # COMPOSE_ARGS is split on spaces on purpose (it holds flags such as: -p name -f file --env-file file)
    # shellcheck disable=SC2206
    DC=(docker compose ${COMPOSE_ARGS:--f docker-compose.prod.yml --env-file .env.production})
    DB_NAME="${RESTORE_DB:?RESTORE_DB (target database name inside the postgres container) is required}"
    require_safe_db_name "${DB_NAME}"
    PSQL=("${DC[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atq')
    exists="$(echo "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | "${PSQL[@]}")"
    if [ "${exists}" = "1" ]; then
      [ "${REPLACE}" = "yes" ] || { log "restore.failed" ',"reason":"target_exists_set_RESTORE_REPLACE=yes_to_replace"'; exit 1; }
      echo "DROP DATABASE \"${DB_NAME}\" WITH (FORCE)" | "${PSQL[@]}" >/dev/null
    fi
    echo "CREATE DATABASE \"${DB_NAME}\"" | "${PSQL[@]}" >/dev/null
    "${DC[@]}" exec -T postgres sh -c "pg_restore --no-owner --no-privileges --exit-on-error -U \"\$POSTGRES_USER\" -d '${DB_NAME}'" < "${DUMP}"
    COUNTS="$(echo "SELECT (SELECT count(*) FROM \"User\") || ',' || (SELECT count(*) FROM \"Store\") || ',' || (SELECT count(*) FROM \"StoreVersion\")" | "${DC[@]}" exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d '${DB_NAME}' -Atq")"
    ;;
  *) echo "unknown BACKUP_MODE" >&2; exit 1 ;;
esac

log "restore.done" ",\"database\":\"${DB_NAME}\",\"users_stores_versions\":\"${COUNTS}\""
