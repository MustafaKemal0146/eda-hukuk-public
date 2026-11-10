#!/usr/bin/env bash
# Tek seferlik platform doğrulaması (P19a.4; KK-P19a-18). Geçici konteynır ve ağlar açar, sonunda
# siler; geliştirme compose yığınına dokunmaz. Çıktı: JSON satırları (sonuçlar ..0299'a).
# Ağ kullanımı: doğrulama imajı derlemesi ve Docling model kartı/model indirme (Hugging Face) yalnız
# bu betikte; doc-engine çalışma zamanı ağsızdır.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly REPO_ROOT
readonly SVC="$REPO_ROOT/services/doc-engine"
readonly VERIFY_IMAGE="eda-doc-engine-verify:local"
readonly DEV_IMAGE="eda-doc-engine-dev:local"
GOTENBERG_IMAGE="$(sed -n 's/^readonly GOTENBERG_IMAGE="\(.*\)"$/\1/p' \
  "$REPO_ROOT/infra/scripts/dev/doc-engine-l6.sh")"
readonly GOTENBERG_IMAGE
readonly RUN_ID="p19v-$$"
readonly NET="eda-$RUN_ID-int"
readonly MODELS="eda-$RUN_ID-models"
OUT="$(mktemp -d)"
readonly OUT

cleanup() {
  docker rm -f "eda-$RUN_ID-gotenberg" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$MODELS" >/dev/null 2>&1 || true
  rm -rf "$OUT"
}
trap cleanup EXIT

docker build -q -t "$VERIFY_IMAGE" -f "$SVC/scripts/verify-platform.Dockerfile" "$SVC/scripts" >/dev/null
docker build -q --target dev -t "$DEV_IMAGE" -f "$REPO_ROOT/infra/docker/python-service.Dockerfile" \
  "$REPO_ROOT" >/dev/null

verify() { # <ağ> <denetim> [docker ek bayrakları...] -- [betik argümanları...]
  local net="$1" key="$2"
  shift 2
  local flags=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do flags+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  docker run --rm --network "$net" -u "$(id -u):$(id -g)" -e HOME=/tmp/home \
    -v "$SVC/scripts:/scripts:ro" -v "$OUT:/out" "${flags[@]}" \
    "$VERIFY_IMAGE" sh -c 'mkdir -p /tmp/home && exec python /scripts/verify_platform.py "$@"' \
    verify "$key" "$@" || true
}

dev() { # <denetim> [argümanlar...] (iç ağ, Gotenberg erişimi)
  docker run --rm --network "$NET" -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -e PYTHONPATH=/workspace/services/doc-engine/src -v "$REPO_ROOT:/workspace:ro" -v "$OUT:/out" \
    "$DEV_IMAGE" python /workspace/services/doc-engine/scripts/verify_platform.py "$@" || true
}

# 1-3
verify none wheels-py314
verify bridge docling-model-licenses
verify none ocrmypdf-without-ghostscript

# Docling modelleri (OCR kapalı PDF hattının kullandığı layout + tableformer) geçici birime indirilir.
# Varsayılan küme rapidocr içerir; Docling 2.133.0 + rapidocr 3.10.0 uyumsuzdur.
docker volume create "$MODELS" >/dev/null
docker run --rm --network bridge -v "$MODELS:/models" "$VERIFY_IMAGE" \
  sh -c 'docling-tools models download layout tableformer -o /models >/dev/null && chmod -R a+rX /models'

# 5-6: Gotenberg (sabit digest) iç ağda.
docker network create --internal "$NET" >/dev/null
docker run -d --rm --name "eda-$RUN_ID-gotenberg" --network "$NET" --network-alias gotenberg \
  "$GOTENBERG_IMAGE" gotenberg --chromium-disable-routes=true --webhook-disable=true \
  --api-disable-download-from=true >/dev/null
for _ in $(seq 1 60); do
  docker exec "eda-$RUN_ID-gotenberg" curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
  sleep 1
done
dev gotenberg-flags-and-fields
dev make-turkish-pdf /out/turkish.pdf
dev gotenberg-liberation-serif /out/turkish.pdf
printf '{"key":"gotenberg-fc-list","detail":%s}\n' \
  "$(docker exec "eda-$RUN_ID-gotenberg" fc-list : family | grep -ci 'liberation serif')"

# 4 ve 7: Türkçe metin katmanı (OCR kapalı), ardından salt-okur kök + tmpfs noexec.
verify none turkish-text-layer -v "$MODELS:/models:ro" -- /out/turkish.pdf /models
verify none tmpfs-noexec -v "$MODELS:/models:ro" --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1g -- /out/turkish.pdf /models
