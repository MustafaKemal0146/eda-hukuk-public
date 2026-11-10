#!/usr/bin/env bash
# make dev (071 §4.2): profil kümesi → up --build --wait → adres tablosu → (WATCH=1) compose watch.
# Başarısızlıkta servis durumu ve sağlıksız servislerin son 50 günlük satırı yazılır, çıkış 1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT
readonly DCS="$ROOT/infra/scripts/dev/dc.sh"
DC() { "$DCS" dev "$@"; }
HOT="${HOT:-0}"; WATCH="${WATCH:-1}"; LLM="${LLM:-mock}"; EMBED="${EMBED:-mock}"; BATCH="${BATCH:-0}"
PROFILES_EXTRA="${PROFILES:-}"

base="$(grep -E '^COMPOSE_PROFILES=' "$ROOT/infra/compose/env/dev.env" | cut -d= -f2-)"
profiles="$base"
for p in $PROFILES_EXTRA; do profiles+=",$p"; done
[[ "$HOT" == 1 ]] && profiles+=",hot"
[[ "$EMBED" == tei ]] && profiles+=",ai"
export COMPOSE_PROFILES="$profiles"

if [[ "$LLM" == real ]]; then
  real_provider="${DEV_REAL_LLM:-deepseek}"
  if [[ "$real_provider" != deepseek && "$real_provider" != anthropic ]]; then
    echo "make dev: DEV_REAL_LLM deepseek veya anthropic olmalı" >&2
    exit 2
  fi
  if [[ ! -s "$ROOT/infra/secrets/dev/${real_provider}_api_key" ]]; then
    echo "make dev: LLM=real için infra/secrets/dev/${real_provider}_api_key dolu olmalı" >&2
    exit 2
  fi
  export DEV_REAL_LLM="$real_provider"
  # Gerçek sağlayıcı istendiğinde mock kapatılır (kapı önce MOCK_LLM'e bakar; 020 §15).
  export MOCK_LLM=false
fi
[[ "$EMBED" == tei ]] && export EMBED_PROVIDER=tei
if [[ "$HOT" == 1 ]]; then export WEB_UPSTREAM=web-hot:3000 ADMIN_UPSTREAM=admin-hot:3001; fi

# Ana makinede başka bir proje 3000/3001'i tutuyorsa (örn. eski eda-hukuk-v2) web/admin dev portları
# bir sonraki boş porta kayar; çalışan kendi yığınımızın portu korunur (yeniden oluşturma yok).
# Uygulamaya erişim zaten Caddy üzerinden (8443); bu portlar yalnız doğrudan hata ayıklama içindir.
port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }
pick_port() { # $1 servis, $2 konteyner portu, $3 başlangıç
  local own p="$3"
  own="$(DC port "$1" "$2" 2>/dev/null | awk -F: '{print $NF}' | head -1)"
  if [[ -n "$own" ]]; then echo "$own"; return; fi
  while port_busy "$p"; do p=$((p + 1)); done
  echo "$p"
}
export EDA_WEB_PORT="${EDA_WEB_PORT:-$(pick_port web 3000 3000)}"
# admin, web'in seçtiği porttan sonra aranır (iki servis aynı boş portu seçmesin).
admin_start=3001
(( EDA_WEB_PORT >= admin_start )) && admin_start=$((EDA_WEB_PORT + 1))
export EDA_ADMIN_PORT="${EDA_ADMIN_PORT:-$(pick_port admin 3001 "$admin_start")}"

scale=()
[[ "$EMBED" == tei && "$BATCH" == 0 ]] && scale=(--scale embed-batch=0)

# DEV_NO_BUILD=1: imaj derlemesi atlanır (kodda değişiklik yoksa saniyeler içinde ayağa kalkar).
build=(--build)
[[ "${DEV_NO_BUILD:-0}" == 1 ]] && build=()
if ! DC up -d "${build[@]}" --wait --wait-timeout 600 "${scale[@]}"; then
  echo "make dev: yığın sağlıklı açılmadı" >&2
  DC ps -a --format 'table {{.Service}}\t{{.Status}}' >&2
  for svc in $(DC ps --format '{{.Service}} {{.Health}}' | awk '$2!="healthy" && $2!="" {print $1}'); do
    echo "---- $svc (son 50 satır) ----" >&2
    DC logs --no-color --tail 50 "$svc" >&2
  done
  exit 1
fi

pg_port="$(DC port postgres 5432 2>/dev/null | awk -F: '{print $NF}')"
cat <<TABLE

E.D.A. Hukuk dev yığını hazır (profiller: $profiles)
  Uygulama        https://app.eda.localhost:8443  (doğrudan: 127.0.0.1:${EDA_WEB_PORT})
  Yönetim         https://admin.eda.localhost:8443
  Tanıtım         https://eda.localhost:8443
  Mailpit         http://127.0.0.1:8025
  api             http://127.0.0.1:8000  (admin dinleyicisi :8010)
  Postgres        127.0.0.1:${pg_port:-5432}
  Valkey          127.0.0.1:6379, valkey-cache 127.0.0.1:6380
  S3 (objstore)   http://127.0.0.1:8333
  Yerel CA        make dev-ca

TABLE

if [[ "$WATCH" == 1 ]]; then
  echo "İzleme başlıyor (Ctrl+C yalnız izlemeyi durdurur; yığın ayakta kalır)."
  exec "$DCS" dev watch --no-up
fi
