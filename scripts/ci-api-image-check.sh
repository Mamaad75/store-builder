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

docker run -d --name apicheck-api --network "${NET}" -p 127.0.0.1:4000:4000 \
  -e NODE_ENV=production -e APP_ROOT_DOMAIN=example.com -e APP_PROTOCOL=https -e TRUST_PROXY_HOPS=1 -e "AUTH_SECRET=${SECRET}" \
  -e "DATABASE_URL=postgresql://api:${PW}@apicheck-db:5432/api" "${IMG}" >/dev/null

for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4000/api/ready >/dev/null 2>&1 && break; [ "${i}" -eq 30 ] && { echo "api did not become ready" >&2; exit 1; }; sleep 1; done
echo "ready: $(curl -fsS http://127.0.0.1:4000/api/ready)"
curl -fsS http://127.0.0.1:4000/api/health | grep -q '"ok"'
curl -sSI http://127.0.0.1:4000/api/health | grep -qi '^strict-transport-security:' || { echo "HSTS missing in production" >&2; exit 1; }
[ "$(curl -s -X POST http://127.0.0.1:4000/api/anything)" = '{"statusCode":404,"error":"Not Found"}' ] || { echo "unknown route must answer with the fixed 404 body" >&2; exit 1; }

ORIGIN="https://example.com"
U="user_$(openssl rand -hex 4)"
curl -fsS -X POST http://127.0.0.1:4000/api/auth/register -H "Origin: ${ORIGIN}" -H 'Content-Type: application/json' -d "{\"name\":\"T\",\"username\":\"${U}\",\"password\":\"password123\"}" >/dev/null
JAR="$(mktemp)"
curl -fsS -c "${JAR}" -X POST http://127.0.0.1:4000/api/auth/login -H "Origin: ${ORIGIN}" -H 'Content-Type: application/json' -d "{\"username\":\"${U}\",\"password\":\"password123\"}" >/dev/null
grep -q '__Host-sb_session' "${JAR}" || { echo "session cookie missing" >&2; exit 1; }
# the __Host- cookie is Secure: send it by hand over the loopback http port
TOKEN="$(awk '/__Host-sb_session/ {print $7}' "${JAR}")"
curl -fsS http://127.0.0.1:4000/api/auth/me -H "Cookie: __Host-sb_session=${TOKEN}" | grep -q "\"${U}\"" || { echo "/me did not return the user" >&2; exit 1; }
rm -f "${JAR}"
echo "auth flow works from the image"

for i in $(seq 1 30); do [ "$(docker inspect --format '{{.State.Health.Status}}' apicheck-api)" = "healthy" ] && break; [ "${i}" -eq 30 ] && { echo "container health check never became healthy" >&2; exit 1; }; sleep 2; done

docker stop apicheck-db >/dev/null
for i in $(seq 1 15); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/ready)" = "503" ] && break; [ "${i}" -eq 15 ] && { echo "readiness did not report the database failure" >&2; exit 1; }; sleep 1; done
echo "readiness reports 503 while the database is down"

if docker logs apicheck-api 2>&1 | grep -F -q -e "${PW}" -e "${SECRET}"; then echo "a secret value appears in the API logs" >&2; exit 1; fi
echo "api image check passed"
