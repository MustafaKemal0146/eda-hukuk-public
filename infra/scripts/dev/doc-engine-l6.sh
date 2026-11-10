#!/usr/bin/env bash
# L6: DOCX -> Gotenberg (LibreOffice) -> PDF tipografi ölçümleri (084 §9.5; KK-P19a-13, KK-P19a-14).
# compose `docs` profili P01c'de bağlanana dek geçici bir İÇ ağ (`--internal`, çıkışsız;
# `docproc` eşleniği) ve sabit digest'li Gotenberg açar, doc-engine geliştirme imajında
# `pytest -m l6` koşar, sonunda ikisini de siler. Geliştirme compose yığınına dokunmaz.
# Kullanım: doc-engine-l6.sh [pytest argümanları...]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly REPO_ROOT
readonly IMAGE="eda-doc-engine-dev:local"
readonly DOCKERFILE="$REPO_ROOT/infra/docker/python-service.Dockerfile"
# 002 §1 / 011 §1.6: Gotenberg 8.37.x (tam imaj; LibreOffice-yalnız varyant kararı P01c).
readonly GOTENBERG_IMAGE="gotenberg/gotenberg:8.37.0@sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769"
readonly RUN_ID="l6-$$"
readonly NET="eda-$RUN_ID-docproc"
readonly GOTENBERG="eda-$RUN_ID-gotenberg"

cleanup() {
  docker rm -f "$GOTENBERG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -q --target dev -t "$IMAGE" -f "$DOCKERFILE" "$REPO_ROOT" >/dev/null
docker network create --internal "$NET" >/dev/null
# 002 §5.9 bayrakları; 014 §3.12 sertleştirmesi (salt-okur kök, tmpfs, yetkisiz).
docker run -d --rm --name "$GOTENBERG" --network "$NET" --network-alias gotenberg \
  --read-only --tmpfs /tmp:rw,size=512m --tmpfs /home/gotenberg:rw,size=64m \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 --memory 1536m \
  "$GOTENBERG_IMAGE" gotenberg --chromium-disable-routes=true --webhook-disable=true \
  --api-disable-download-from=true >/dev/null

for _ in $(seq 1 90); do
  if docker exec "$GOTENBERG" curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker run --rm --network "$NET" -u "$(id -u):$(id -g)" \
  -e HOME=/tmp -e GOTENBERG_URL=http://gotenberg:3000 \
  -v "$REPO_ROOT:/workspace" -w /workspace/services/doc-engine \
  "$IMAGE" pytest -q -m l6 tests/l6 "$@"
