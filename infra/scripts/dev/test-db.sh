#!/usr/bin/env bash
# make test veritabanı aşaması (071 §4.2, 032 §14; P03a asgari dilimi):
#   1. TEST projesinde (eda-test) taze tmpfs birimle postgres açılır (initdb roller/eklentiler/FTS),
#   2. migrate boş veritabanında koşar ve çıkış 0 vermelidir (KK-P03a-4),
#   3. @eda/db entegrasyon testleri devtools imajında data ağına bağlı koşar (Docker socket yok),
#   4. @eda/worker entegrasyon testleri aynı ağda TEST Valkey'ine (eda_jobs), PostgreSQL'e ve Mailpit'e
#      (P04a) bağlanır,
#   5. @eda/yargi-mcp ve @eda/ai entegrasyon testleri aynı ağda TEST valkey-cache'ine (eda_mcp) bağlanır,
#   6. @eda/api kimlik entegrasyon testleri (P04a) eda_app / eda_auth / eda_readonly_admin havuzları ve
#      TEST Valkey'i (eda_api ACL) ile koşar.
# Yığın her durumda kapatılır ve birimler silinir (KEEP=1 hata ayıklama için açık bırakır).
# P01c test-runner'ı (070 §6) getirince 3. adım ona taşınır. Dev birimlerine dokunmaz.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT
readonly DC="$ROOT/infra/scripts/dev/dc.sh"
readonly NETWORK="${EDA_TEST_PROJECT:-eda-test}_data"
export COMPOSE_PROFILES=core

cleanup() {
  local code=$?
  if [[ "${KEEP:-0}" != 1 ]]; then
    "$DC" test down -v --remove-orphans >/dev/null 2>&1 || true
  else
    echo "test-db: KEEP=1, eda-test yığını açık bırakıldı" >&2
  fi
  exit "$code"
}
trap cleanup EXIT

"$DC" test down -v --remove-orphans >/dev/null 2>&1 || true
"$DC" test up -d --build --wait --wait-timeout 300 postgres valkey valkey-cache mailpit
# prod profili: KK-P03c-7 sayımları; dev aşamaları test/seed/seed.test.ts içinde uygulanır.
"$DC" test run --rm --no-deps --build -e SEED_PROFILE=prod migrate

PG_HOST=postgres PG_PORT=5432 PG_DATABASE=eda \
  RUN_TOOL_NETWORK="$NETWORK" RUN_TOOL_ENV="PG_HOST PG_PORT PG_DATABASE" \
  "$ROOT/infra/scripts/dev/run-tool.sh" pnpm --filter @eda/db test:db

# worker/jobs entegrasyonu (KK-P03c-17, P04a): gerçek Valkey (noeviction, eda_jobs ACL) ile zamanlayıcı
# eşitlemesi; gerçek PG + Mailpit ile email.send.
PG_HOST=postgres PG_PORT=5432 PG_DATABASE=eda \
  SMTP_URL=smtp://mailpit:1025 MAILPIT_API_URL=http://mailpit:8025 \
  VALKEY_URL=redis://valkey:6379 VALKEY_USERNAME=eda_jobs \
  VALKEY_PASSWORD_FILE=/workspace/infra/secrets/dev/valkey_jobs_password \
  RUN_TOOL_NETWORK="$NETWORK" \
  RUN_TOOL_ENV="PG_HOST PG_PORT PG_DATABASE SMTP_URL MAILPIT_API_URL VALKEY_URL VALKEY_USERNAME VALKEY_PASSWORD_FILE" \
  "$ROOT/infra/scripts/dev/run-tool.sh" pnpm --filter @eda/worker test:int

# yargi-mcp entegrasyonu (P11.6, KK-P11-5/6/7/13/14): gerçek valkey-cache ACL'i (eda_mcp en dar
# komut kümesi, eda_api eda:cfg yazma) ve Lua kova / kesici; @eda/ai ince istemcisi replay kipindeki
# yargi-mcp alt sürecine (aynı valkey-cache) karşı (KK-P11-20).
VALKEY_CACHE_URL=redis://valkey-cache:6379 \
  VALKEY_CACHE_MCP_PASSWORD_FILE=/workspace/infra/secrets/dev/valkey_cache_mcp_password \
  VALKEY_CACHE_API_PASSWORD_FILE=/workspace/infra/secrets/dev/valkey_cache_api_password \
  RUN_TOOL_NETWORK="$NETWORK" \
  RUN_TOOL_ENV="VALKEY_CACHE_URL VALKEY_CACHE_MCP_PASSWORD_FILE VALKEY_CACHE_API_PASSWORD_FILE" \
  "$ROOT/infra/scripts/dev/run-tool.sh" pnpm --filter @eda/yargi-mcp --filter @eda/ai test:int

# api kimlik zinciri (P04a; KK-P04a-1/3/4/6/7/9/10): Better Auth + gerçek PG havuzları + Valkey.
readonly SECRETS=/workspace/infra/secrets/dev
PG_HOST=postgres PG_PORT=5432 PG_DATABASE=eda PG_POOL_MAX=4 \
  PG_USER=eda_app PG_PASSWORD_FILE="$SECRETS/pg_app_password" \
  PG_AUTH_USER=eda_auth PG_AUTH_PASSWORD_FILE="$SECRETS/pg_auth_password" PG_AUTH_POOL_MAX=4 \
  PG_ADMIN_RO_USER=eda_readonly_admin PG_ADMIN_RO_PASSWORD_FILE="$SECRETS/pg_readonly_admin_password" \
  PG_ADMIN_RO_POOL_MAX=2 \
  VALKEY_URL=redis://valkey:6379 VALKEY_USERNAME=eda_api VALKEY_PASSWORD_FILE="$SECRETS/valkey_api_password" \
  RUN_TOOL_NETWORK="$NETWORK" \
  RUN_TOOL_ENV="PG_HOST PG_PORT PG_DATABASE PG_POOL_MAX PG_USER PG_PASSWORD_FILE PG_AUTH_USER PG_AUTH_PASSWORD_FILE PG_AUTH_POOL_MAX PG_ADMIN_RO_USER PG_ADMIN_RO_PASSWORD_FILE PG_ADMIN_RO_POOL_MAX VALKEY_URL VALKEY_USERNAME VALKEY_PASSWORD_FILE" \
  "$ROOT/infra/scripts/dev/run-tool.sh" pnpm --filter @eda/api test:int
