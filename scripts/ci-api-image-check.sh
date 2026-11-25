#!/usr/bin/env bash
# CI only (ADR 0001, N2): builds the API image and proves it boots from the image alone against a throw-away PostgreSQL:
# non-root, no sources or dev tools shipped, /api/health and /api/ready answer, readiness turns 503 when the database goes away,
# and no secret value reaches the logs. Everything is generated for this run and deleted at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

NET="apicheck-$$"
PW="$(openssl rand -hex 16)"
SECRET="$(openssl rand -base64 33)"
IMG="storebuilder-api:check"
cleanup() { code=$?; [ "${code}" -ne 0 ] && { docker logs apicheck-api 2>&1 | tail -50 || true; }; docker rm -f apicheck-api apicheck-db >/dev/null 2>&1 || true; docker network rm "${NET}" >/dev/null 2>&1 || true; exit "${code}"; }
trap cleanup EXIT

docker build --target api -t "${IMG}" .

[ "$(docker inspect --format '{{.Config.User}}' "${IMG}")" = "node" ] || { echo "api image must run as the node user" >&2; exit 1; }
docker run --rm --entrypoint sh "${IMG}" -c '
  set -e
  test -f dist/main.js
  ! test -e src && ! test -e .env && ! test -e tsconfig.json && ! test -e eslint.config.mjs
  ! test -e node_modules/typescript && ! test -e node_modules/.bin/tsx && ! test -e node_modules/vitest
  test "$(id -u)" != 0
' || { echo "api image ships files it must not or runs as root" >&2; exit 1; }

docker network create "${NET}" >/dev/null
docker run -d --name apicheck-db --network "${NET}" -e POSTGRES_PASSWORD="${PW}" -e POSTGRES_USER=api -e POSTGRES_DB=api postgres:16-bookworm >/dev/null
for i in $(seq 1 30); do docker exec apicheck-db pg_isready -U api -d api >/dev/null 2>&1 && break; [ "${i}" -eq 30 ] && { echo "database did not start" >&2; exit 1; }; sleep 1; done

# D-19 (ADR 0005 §17.2): without APP_ENV a production image must refuse to start, naming the variable only.
if docker run --rm --network "${NET}" -e NODE_ENV=production -e APP_ROOT_DOMAIN=example.com -e APP_PROTOCOL=https -e TRUST_PROXY_HOPS=1 -e "AUTH_SECRET=${SECRET}" -e RATE_LIMIT_BACKEND=postgres \
  -e S3_ENDPOINT=http://127.0.0.1:1 -e S3_BUCKET=unreachable-bucket -e S3_ACCESS_KEY_ID=check -e S3_SECRET_ACCESS_KEY="${SECRET}" -e S3_PUBLIC_BASE_URL=http://127.0.0.1:1/unreachable-bucket \
  -e "DATABASE_URL=postgresql://api:${PW}@apicheck-db:5432/api" "${IMG}" > /tmp/apicheck-noenv.log 2>&1; then
  echo "the API started without APP_ENV" >&2; exit 1
fi
grep -q '"APP_ENV: required' /tmp/apicheck-noenv.log || { echo "missing APP_ENV was not reported" >&2; cat /tmp/apicheck-noenv.log >&2; exit 1; }
echo "a production image without APP_ENV refuses to start"

docker run -d --name apicheck-api --network "${NET}" -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=production -e APP_ENV=production -e APP_ROOT_DOMAIN=example.com -e APP_PROTOCOL=https -e TRUST_PROXY_HOPS=1 -e "AUTH_SECRET=${SECRET}" -e RATE_LIMIT_BACKEND=postgres \
  -e S3_ENDPOINT=http://127.0.0.1:1 -e S3_BUCKET=unreachable-bucket -e S3_ACCESS_KEY_ID=check -e S3_SECRET_ACCESS_KEY="${SECRET}" -e S3_PUBLIC_BASE_URL=http://127.0.0.1:1/unreachable-bucket \
  -e "DATABASE_URL=postgresql://api:${PW}@apicheck-db:5432/api" "${IMG}" >/dev/null

for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && break; [ "${i}" -eq 30 ] && { echo "api did not start" >&2; exit 1; }; sleep 1; done
# no object store exists here: readiness must name it (503) while the database check is ok
READY="$(curl -s http://127.0.0.1:4000/api/ready)"
echo "ready: ${READY}"
echo "${READY}" | grep -q '"database":"ok"' || { echo "database check should be ok" >&2; exit 1; }
echo "${READY}" | grep -q '"storage":"fail"' || { echo "storage check should fail (no object store here)" >&2; exit 1; }
echo "${READY}" | grep -q '"environment":"production"' || { echo "readiness must report the deployment identity (D-19)" >&2; exit 1; }
curl -fsS http://127.0.0.1:4000/api/health | grep -q '"ok"'
curl -sSI http://127.0.0.1:4000/api/health | grep -qi '^strict-transport-security:' || { echo "HSTS missing in production" >&2; exit 1; }
[ "$(curl -s -X POST http://127.0.0.1:4000/api/anything)" = '{"statusCode":404,"error":"Not Found"}' ] || { echo "unknown route must answer with the fixed 404 body" >&2; exit 1; }

for i in $(seq 1 30); do [ "$(docker inspect --format '{{.State.Health.Status}}' apicheck-api)" = "healthy" ] && break; [ "${i}" -eq 30 ] && { echo "container health check never became healthy" >&2; exit 1; }; sleep 2; done

docker stop apicheck-db >/dev/null
for i in $(seq 1 15); do curl -s http://127.0.0.1:4000/api/ready | grep -q '"database":"fail"' && break; [ "${i}" -eq 15 ] && { echo "readiness did not report the database failure" >&2; exit 1; }; sleep 1; done
echo "readiness reports 503 while the database is down"

if docker logs apicheck-api 2>&1 | grep -F -q -e "${PW}" -e "${SECRET}"; then echo "a secret value appears in the API logs" >&2; exit 1; fi
echo "api image check passed"
