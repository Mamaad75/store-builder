#!/usr/bin/env bash
# Starts the PRODUCTION build the way the container does: the Next.js standalone bundle, copied OUT of the repository first, so that
# anything the bundle needs but did not trace (a native module, the Prisma engine, a file) fails here instead of resolving by
# accident from the repository's node_modules. Used by the E2E suite (playwright.config.ts) and available for local checks.
#
#   pnpm build && bash scripts/run-standalone.sh 3100
set -euo pipefail

PORT="${1:-3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${STANDALONE_DIR:-${TMPDIR:-/tmp}/store-builder-standalone-${PORT}}"

[ -f "${ROOT}/.next/standalone/server.js" ] || { echo "run 'pnpm build' first (next.config.ts sets output: standalone)" >&2; exit 1; }

# Fresh copy every start (a stale bundle from an older build must never be served).
node -e 'const fs=require("fs");const d=process.argv[1];fs.rmSync(d,{recursive:true,force:true});fs.mkdirSync(d,{recursive:true})' "${DEST}"
cp -r "${ROOT}/.next/standalone/." "${DEST}/"
mkdir -p "${DEST}/.next"
cp -r "${ROOT}/.next/static" "${DEST}/.next/static"

cd "${DEST}"
exec env PORT="${PORT}" HOSTNAME="${HOSTNAME_BIND:-0.0.0.0}" node server.js
