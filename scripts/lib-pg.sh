# Sourced by backup.sh / restore.sh. Turns a postgres URL into PG* environment variables so that passwords never appear in a
# process argument list (visible to every local user). Exports PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (and PGSSLMODE when given).
pg_env_from_url() {
  local url="$1" re='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]*)(\?(.*))?$'
  [[ "${url}" =~ ${re} ]] || { echo "not a postgres URL" >&2; return 1; }
  local pw="${BASH_REMATCH[4]}"
  PGUSER="$(printf '%b' "${BASH_REMATCH[2]//%/\\x}")"
  PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
  PGHOST="${BASH_REMATCH[5]}"
  PGPORT="${BASH_REMATCH[7]:-5432}"
  PGDATABASE="${BASH_REMATCH[8]}"
  local q="${BASH_REMATCH[10]}"
  if [[ "${q}" =~ sslmode=([a-z-]+) ]]; then export PGSSLMODE="${BASH_REMATCH[1]}"; fi
  export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
}
