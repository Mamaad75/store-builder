#!/usr/bin/env bash
# Starts the PRODUCTION build the way the container does: the Next.js standalone bundle, copied OUT of the repository first, so that
# anything the bundle needs but did not trace (a native module, the Prisma engine, a file) fails here instead of resolving by
# accident from the repository's node_modules. Used by the E2E suite (playwright.config.ts) and available for local checks.
# In the pnpm workspace (ADR 0001, N1) the bundle mirrors the repository layout: the server is apps/web/server.js inside it.
#
#   pnpm build && bash scripts/run-standalone.sh 3100
set -euo pipefail

PORT="${1:-3000}"
APP="$(cd "$(dirname "$0")/.." && pwd)"               # apps/web
DEST="${STANDALONE_DIR:-${TMPDIR:-/tmp}/store-builder-standalone-${PORT}}"
SERVER_DIR="${DEST}/apps/web"

[ -f "${APP}/.next/standalone/apps/web/server.js" ] || { echo "run 'pnpm build' first (next.config.ts sets output: standalone)" >&2; exit 1; }

# Fresh copy every start (a stale bundle from an older build must never be served).
node -e 'const fs=require("fs");const d=process.argv[1];fs.rmSync(d,{recursive:true,force:true});fs.mkdirSync(d,{recursive:true})' "${DEST}"
cp -r "${APP}/.next/standalone/." "${DEST}/"
mkdir -p "${SERVER_DIR}/.next"
cp -r "${APP}/.next/static" "${SERVER_DIR}/.next/static"

cd "${SERVER_DIR}"
exec env PORT="${PORT}" HOSTNAME="${HOSTNAME_BIND:-0.0.0.0}" node server.js
