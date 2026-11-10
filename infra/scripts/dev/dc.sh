#!/usr/bin/env bash
# docker compose sarmalayıcısı (071 §4.1 DEV/TEST): proje adı, proje dizini, env dosyaları ve
# katman sırası her çağrıda aynı kalır. Kullanım: dc.sh <dev|test> <docker compose argümanları...>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT
env_name="${1:?kullanım: dc.sh <dev|test> <argümanlar...>}"
shift

case "$env_name" in
  dev) project=eda; overlay=compose.dev.yaml; envfile=dev.env ;;
  # EDA_TEST_PROJECT: paralel çalışma ağaçlarında TEST yığınlarının çakışmaması için.
  test) project="${EDA_TEST_PROJECT:-eda-test}"; overlay=compose.test.yaml; envfile=test.env ;;
  *) echo "dc.sh: bilinmeyen ortam: $env_name (dev|test)" >&2; exit 2 ;;
esac

secrets="$ROOT/infra/secrets/dev"
[[ -f "$ROOT/infra/compose/env/$envfile" ]] || { echo "dc.sh: infra/compose/env/$envfile yok (make setup)" >&2; exit 2; }
[[ -f "$secrets/derived.env" ]] || { echo "dc.sh: sırlar yok (make secrets)" >&2; exit 2; }

files=(-f "$ROOT/infra/compose/compose.yaml" -f "$ROOT/infra/compose/$overlay")
if [[ "$env_name" == dev && -f "$ROOT/infra/compose/compose.dev.local.yaml" ]]; then
  files+=(-f "$ROOT/infra/compose/compose.dev.local.yaml")
fi

EDA_UID="$(id -u)"
EDA_GID="$(id -g)"
EDA_SECRETS_DIR="$secrets"
export EDA_UID EDA_GID EDA_SECRETS_DIR
exec docker compose --project-directory "$ROOT/infra/compose" -p "$project" \
  --env-file "$ROOT/infra/compose/env/$envfile" --env-file "$secrets/derived.env" \
  "${files[@]}" "$@"
