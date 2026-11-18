#!/usr/bin/env bash
# Sends one operational alert to a Bale bot (decision D14-3) from the HOST, where Node may not be installed (e.g. as the backup's
# BACKUP_FAILURE_HOOK, or from cron). Same rules as src/lib/alert.ts:
#   - BALE_BOT_TOKEN / BALE_CHAT_ID from the environment only; both unset = alerts off (exit 0 with an alert.disabled line);
#   - the token is part of the URL, so the URL goes to curl through a config on STDIN (never on the command line, which every local
#     user can read) and is never printed; https only, except a loopback BALE_API_BASE for tests; bounded by a 10 s timeout.
#   usage: notify-bale.sh "<message>"
set -euo pipefail

log() { printf '{"ts":"%s","event":"%s"%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}" >&2; }

MESSAGE="${1:?usage: notify-bale.sh <message>}"
TOKEN="${BALE_BOT_TOKEN:-}"
CHAT="${BALE_CHAT_ID:-}"
BASE="${BALE_API_BASE:-https://tapi.bale.ai}"
BASE="${BASE%/}"

if [ -z "${TOKEN}" ] && [ -z "${CHAT}" ]; then log "alert.disabled"; exit 0; fi
[[ "${TOKEN}" =~ ^[0-9]+:[A-Za-z0-9_-]{10,}$ ]] || { log "alert.failed" ',"reason":"invalid_BALE_BOT_TOKEN"'; exit 2; }
[[ "${CHAT}" =~ ^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,64})$ ]] || { log "alert.failed" ',"reason":"invalid_BALE_CHAT_ID"'; exit 2; }
[[ "${BASE}" =~ ^https:// || "${BASE}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?$ ]] || { log "alert.failed" ',"reason":"invalid_BALE_API_BASE"'; exit 2; }

# The text goes to curl through a private temporary FILE (raw UTF-8 bytes): a command-line argument would be re-encoded through the
# system code page on some platforms and garble Persian text.
TEXT_FILE="$(mktemp)"
trap 'rm -f "${TEXT_FILE}"' EXIT
chmod 600 "${TEXT_FILE}"
printf '⚠️ هشدار %s\n%s' "${APP_ROOT_DOMAIN:-store-builder}" "${MESSAGE}" | head -c 4000 > "${TEXT_FILE}"
CURL_TEXT_FILE="${TEXT_FILE}"
# Git Bash on Windows (developer machines only): native curl needs a Windows path for @file.
if command -v cygpath >/dev/null 2>&1; then CURL_TEXT_FILE="$(cygpath -m "${TEXT_FILE}")"; fi
RESPONSE="$(printf 'url = "%s/bot%s/sendMessage"\n' "${BASE}" "${TOKEN}" \
  | curl -sS --max-time 10 --proto '=https,http' -K - --data-urlencode "chat_id=${CHAT}" --data-urlencode "text@${CURL_TEXT_FILE}" 2>/dev/null)" \
  || { log "alert.failed" ',"reason":"network_or_timeout"'; exit 1; }
case "${RESPONSE}" in
  *'"ok":true'*) log "alert.sent" ;;
  *) log "alert.failed" ',"reason":"api_rejected"'; exit 1 ;;
esac
