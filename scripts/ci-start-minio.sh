#!/usr/bin/env bash
# CI only: starts a throw-away MinIO container for integration/E2E tests and waits until it is ready.
# Test-only credentials come from the job environment; nothing here can reach a real storage account.
# (GitHub "services:" cannot pass the `server /data` command to this image, hence a docker run step.)
set -euo pipefail

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}"
IMAGE="${MINIO_IMAGE:-minio/minio:RELEASE.2025-04-22T22-12-26Z}"

docker run -d --name minio-ci -p 127.0.0.1:9000:9000 \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  "$IMAGE" server /data >/dev/null

for i in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:9000/minio/health/ready >/dev/null 2>&1; then
    echo "MinIO ready after ${i} checks"
    exit 0
  fi
  sleep 2
done
echo "MinIO did not become ready" >&2
docker logs minio-ci >&2 || true
exit 1
