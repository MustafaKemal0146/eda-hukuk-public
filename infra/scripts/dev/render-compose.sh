#!/usr/bin/env bash
# docker compose çıktısını dev/test/prod/beta katmanları için JSON olarak üretir (070 §17, P01c.9).
# check-compose-canon.ts bu çıktıları okur.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT
readonly OUT="$ROOT/.tmp/compose-rendered"
mkdir -p "$OUT"

secrets="$ROOT/infra/secrets/dev"
[[ -f "$secrets/derived.env" ]] || { echo "render-compose.sh: sırlar yok (make secrets)" >&2; exit 2; }

# Dev
"$ROOT/infra/scripts/dev/dc.sh" dev config --format json > "$OUT/dev.json"

# Test
"$ROOT/infra/scripts/dev/dc.sh" test config --format json > "$OUT/test.json"

# Prod
EDA_SECRETS_DIR="$secrets" docker compose --project-directory "$ROOT/infra/compose" -p eda-prod \
  --env-file "$ROOT/infra/compose/env/prod.env.example" \
  --env-file "$ROOT/infra/compose/env/digests.env.example" \
  --env-file "$secrets/derived.env" \
  -f "$ROOT/infra/compose/compose.yaml" \
  -f "$ROOT/infra/compose/compose.prod.yaml" \
  config --format json > "$OUT/prod.json"

# Beta
EDA_SECRETS_DIR="$secrets" docker compose --project-directory "$ROOT/infra/compose" -p eda-beta \
  --env-file "$ROOT/infra/compose/env/beta.env.example" \
  --env-file "$ROOT/infra/compose/env/digests.env.example" \
  --env-file "$secrets/derived.env" \
  -f "$ROOT/infra/compose/compose.yaml" \
  -f "$ROOT/infra/compose/compose.prod.yaml" \
  -f "$ROOT/infra/compose/compose.beta.yaml" \
  config --format json > "$OUT/beta.json"

# Pilot (tek VPS; yerel derlenen imajlar) tam ve hafif mod. Hafif modda ağır profiller kapalıdır.
for mode in pilot pilot-light; do
  files=(-f "$ROOT/infra/compose/compose.yaml" -f "$ROOT/infra/compose/compose.pilot.yaml")
  envf="$ROOT/infra/compose/env/pilot.env.example"
  if [[ "$mode" == pilot-light ]]; then
    files+=(-f "$ROOT/infra/compose/compose.pilot-light.yaml")
    envf="$ROOT/infra/compose/env/pilot-light.env.example"
  fi
  EDA_SECRETS_DIR="$secrets" EDA_TAG=render docker compose --project-directory "$ROOT/infra/compose" -p "eda-$mode" \
    --env-file "$envf" --env-file "$secrets/derived.env" "${files[@]}" \
    config --format json > "$OUT/$mode.json"
done

echo "render-compose: dev, test, prod, beta, pilot, pilot-light rendered to $OUT"
