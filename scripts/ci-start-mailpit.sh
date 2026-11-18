#!/usr/bin/env bash
# CI (and local) mail-test servers (MVP step M2): two throw-away Mailpit containers on loopback ports only.
#   - TLS server  : SMTP 127.0.0.1:2525 with a STARTTLS certificate generated here for "localhost" and STARTTLS REQUIRED; API 127.0.0.1:8025
#   - plain server: SMTP 127.0.0.1:2526 WITHOUT any TLS (proves the client refuses to send in plain text);           API 127.0.0.1:8026
# Reverse DNS lookups are off: a lookup of the Docker bridge address can stall the greeting for ~10 s.
# Any username/password is accepted (test-only, nothing is relayed anywhere). The CA the tests trust is written to
# "${MAILPIT_TLS_DIR}/cert.pem" (self-signed: the certificate is its own CA). Nothing here is a real mail account or secret.
set -euo pipefail

IMAGE="axllent/mailpit:v1.33.0@sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231"
DIR="${MAILPIT_TLS_DIR:-${TMPDIR:-/tmp}/mailpit-tls}"
mkdir -p "${DIR}"

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout "${DIR}/key.pem" -out "${DIR}/cert.pem" 2>/dev/null
chmod 644 "${DIR}/cert.pem" "${DIR}/key.pem" # readable by the container's unprivileged user; throw-away test key

docker rm -f mailpit-tls mailpit-plain >/dev/null 2>&1 || true
docker run -d --name mailpit-tls -p 127.0.0.1:2525:1025 -p 127.0.0.1:8025:8025 -v "${DIR}:/tls:ro" "${IMAGE}" \
  --smtp-tls-cert /tls/cert.pem --smtp-tls-key /tls/key.pem --smtp-require-starttls --smtp-auth-accept-any --smtp-disable-rdns >/dev/null
docker run -d --name mailpit-plain -p 127.0.0.1:2526:1025 -p 127.0.0.1:8026:8025 "${IMAGE}" \
  --smtp-auth-accept-any --smtp-auth-allow-insecure --smtp-disable-rdns >/dev/null

for port in 8025 8026; do
  for i in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${port}/readyz" >/dev/null 2>&1 && break
    [ "${i}" -eq 30 ] && { echo "Mailpit on ${port} did not become ready" >&2; docker logs mailpit-tls >&2 || true; exit 1; }
    sleep 1
  done
done
echo "Mailpit ready: TLS SMTP 127.0.0.1:2525 (CA ${DIR}/cert.pem), plain SMTP 127.0.0.1:2526"
