#!/usr/bin/env bash
# CI only: starts a throw-away MinIO container for integration/E2E tests and waits until it is ready.
# Test-only credentials come from the job environment; nothing here can reach a real storage account.
# The image is bitnamilegacy/minio (a real MinIO server; the upstream minio/minio repository is no longer available on
# Docker Hub, which made run 5 fail at the pull). Pinned by tag AND digest, both verified to exist. The image is
# unmaintained, which is acceptable for a throw-away test container that is never exposed or used with real data.
set -euo pipefail

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}"
IMAGE="${MINIO_IMAGE:-bitnamilegacy/minio:2025.7.23@sha256:8935e75fa5d11295c17171e4aa49efe390a1193cd7f12e4d21b92af9ffef09d7}"

# ROOT CAUSE of the intermittent "ECONNRESET / other side closed" storage failures (runs 8-11): the image's default
# entrypoint (bitnami setup) first starts a TEMPORARY MinIO in the background, configures `mc`, STOPS it ~5 s later and
# only then starts the real server. /minio/health/ready already answers 200 on the temporary instance, so our readiness
# check passed and the tests then ran into the restart (connections dropped without a response). We therefore bypass that
# setup and run the MinIO binary directly: one server, started once, so "ready" means ready for good.
docker run -d --name minio-ci -p 127.0.0.1:9000:9000 \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  --entrypoint /opt/bitnami/minio/bin/minio \
  "$IMAGE" server /bitnami/minio/data --address :9000 --console-address :9001 >/dev/null

for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1; then
    # A server that restarts right after its first "ready" is exactly what broke runs 8-11: require it to stay ready.
    for _ in 1 2 3 4 5 6; do
      sleep 1
      curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1 || { echo "MinIO stopped answering right after becoming ready" >&2; docker logs minio-ci >&2 || true; exit 1; }
    done
    echo "MinIO ready after ${i} checks and stable for 6 s"
    exit 0
  fi
  sleep 2
done
echo "MinIO did not become ready" >&2
docker logs minio-ci >&2 || true
exit 1
