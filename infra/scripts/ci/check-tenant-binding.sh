#!/usr/bin/env bash
# Kiracı bağı ve DB sınırı denetimi (031 §4.5; KK-031-4, KK-P03c-2). apps/, services/, packages/
# altındaki kod ve SQL dosyalarında:
#   tenant-binding : `set_config(` ve `SET [LOCAL] app.` yalnız packages/db/src/tenant.ts ve migrasyonlarda
#   forged-binding : bağlantı başlangıç seçeneğiyle `-c app.` bağı yalnız RLS test yardımcısında
#   timeout-relax  : oturum düzeyi `SET statement_timeout|lock_timeout|idle_in_transaction_session_timeout|
#                    row_security` yasak (yalnız `SET LOCAL` ile daha sıkı değer serbest)
#   auth-access    : `auth.<tablo>` başvurusu yalnız auth-read.ts, schema/auth.ts, apps/api/src/auth/**,
#                    dev seed aşamaları (032 §11.3; kimlik satırları eda_owner ile doğrudan),
#                    migrasyonlar, @eda/db test/denetim betikleri ve test fixture modülü (`testing.ts`;
#                    dependency-cruiser ile yalnız test dosyalarına açık)
#   app-role       : rol taşıyan oturum değişkeni geçersizdir (002 §9; KK-002-9)
# Kullanım: check-tenant-binding.sh [--root <dizin>]  (varsayılan: repo kökü, git dosya listesi).
# --root verilirse dizindeki tüm dosyalar o dizine göre göreli yollarla taranır (negatif fixture testi).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
mode=git
if [[ "${1:-}" == --root ]]; then
  root="$(cd "${2:?--root dizin ister}" && pwd)"
  mode='find'
fi

list_files() {
  if [[ "$mode" == git ]]; then
    git -C "$root" ls-files --cached --others --exclude-standard
  else
    (cd "$root" && find . -type f | sed 's|^\./||')
  fi
}

readonly SCOPE='^(apps|services|packages)/.*\.(ts|tsx|mts|cts|js|mjs|cjs|sql)$'
readonly SKIP='(^|/)(node_modules|dist|generated|\.next)/'

# Kural başına desen (grep -E, büyük/küçük harf duyarsız), izinli yol deseni (boş = hiçbiri) ve ileti.
readonly RULE_NAMES=(tenant-binding forged-binding timeout-relax auth-access app-role)
declare -A PATTERN ALLOW MESSAGE
PATTERN[tenant-binding]='set_config[[:space:]]*\(|(^|[^a-z_])set[[:space:]]+(local[[:space:]]+)?app\.'
ALLOW[tenant-binding]='^packages/db/src/tenant\.ts$|^packages/db/migrations/|^packages/db/scripts/check-migrations\.ts$|^packages/db/test/fixtures/migrations/bad/'
MESSAGE[tenant-binding]='kiracı bağı yalnız packages/db/src/tenant.ts ve migrasyonlarda kurulur (withTenant kullanın)'
PATTERN[forged-binding]='-c[[:space:]]*app\.'
ALLOW[forged-binding]='^packages/db/test/fixtures/rls-helpers\.ts$'
MESSAGE[forged-binding]='bağlantı başlangıç seçeneğiyle app.* bağı kurulamaz (withTenant kullanın)'
PATTERN[timeout-relax]='(^|[^a-z_])set[[:space:]]+(session[[:space:]]+)?(statement_timeout|lock_timeout|idle_in_transaction_session_timeout|row_security)([^a-z_]|$)'
ALLOW[timeout-relax]='^packages/db/src/migrate/'
MESSAGE[timeout-relax]='oturum düzeyinde zaman aşımı/row_security değiştirilemez (yalnız SET LOCAL ile daha sıkı değer)'
PATTERN[auth-access]='(^|[^a-z0-9_])auth\.(users|sessions|accounts|verifications|two_factors|passkeys|organizations|members|invitations|api_keys|account_recovery_requests)([^a-z0-9_]|$)'
ALLOW[auth-access]='^packages/db/src/auth-read\.ts$|^packages/db/src/seed/dev/|^packages/db/src/schema/auth\.ts$|^packages/db/src/testing\.ts$|^apps/api/src/auth/|^packages/db/migrations/|^packages/db/test/|^packages/db/audit/|^packages/db/scripts/|^packages/contracts/scripts/'
MESSAGE[auth-access]='auth tablolarına yalnız packages/db/src/auth-read.ts üzerinden erişilir'
PATTERN[app-role]='(^|[^a-z0-9_])app\.role([^a-z0-9_]|$)'
ALLOW[app-role]=''
MESSAGE[app-role]='rol oturum değişkeni geçersizdir; rol app.member_role() ile okunur'

mapfile -t files < <(list_files | grep -E "$SCOPE" | grep -Ev "$SKIP" | sort || true)
violations=0
for rule in "${RULE_NAMES[@]}"; do
  targets=()
  for f in "${files[@]}"; do
    if [[ -n "${ALLOW[$rule]}" && "$f" =~ ${ALLOW[$rule]} ]]; then continue; fi
    targets+=("$f")
  done
  ((${#targets[@]} == 0)) && continue
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    file="${hit%%:*}"
    rest="${hit#*:}"
    echo "$file:${rest%%:*}: [$rule] ${MESSAGE[$rule]}" >&2
    violations=$((violations + 1))
  done < <(cd "$root" && printf '%s\0' "${targets[@]}" | xargs -0 grep -inEH -- "${PATTERN[$rule]}" || true)
done

if ((violations > 0)); then
  echo "check-tenant-binding: $violations ihlal" >&2
  exit 1
fi
echo "check-tenant-binding: 0 ihlal (${#files[@]} dosya)"
