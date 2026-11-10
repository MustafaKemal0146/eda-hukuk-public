#!/usr/bin/env bash
# Kenar (Caddy) duman testi: KK-P01b-7 (KK-002-15, KK-070-9) senaryolarını ÇALIŞAN dev yığınına
# karşı koşar (P01b.13). Ana makinede yalnız curl ve docker gerekir.
#
# Kullanım: infra/scripts/dev/smoke-edge.sh [--maintenance]
#   --maintenance  api'yi durdurup bakım yanıtını (503 + Retry-After: 30 + INTERNAL_MAINTENANCE)
#                  dener, ardından api'yi yeniden başlatır (dc.sh dev stop/start api).
# Env (isteğe bağlı): APP_DOMAIN (eda.localhost), EDGE_PORT (8443), APP_URL
#   (https://app.$APP_DOMAIN:$EDGE_PORT), SMOKE_API_WAIT_SEC (180).
# Çıkış: tüm senaryolar geçerse 0, biri bile kalırsa 1, kullanım hatasında 2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ROOT
readonly DC="$ROOT/infra/scripts/dev/dc.sh"
readonly DOMAIN="${APP_DOMAIN:-eda.localhost}"
readonly PORT="${EDGE_PORT:-8443}"
readonly APP="https://app.${DOMAIN}:${PORT}"
readonly ROOT_HOST="https://${DOMAIN}:${PORT}"
readonly ADMIN="https://admin.${DOMAIN}:${PORT}"
readonly EXPECTED_APP_URL="${APP_URL:-$APP}"
readonly API_WAIT_SEC="${SMOKE_API_WAIT_SEC:-180}"
# Caddy MB = 10^6 bayt; sınırların açıkça üstünde kalan boyutlar.
readonly SIZE_51MB=$((51 * 1024 * 1024))
readonly SIZE_3MB=$((3 * 1024 * 1024))

maintenance=0
for arg in "$@"; do
  case "$arg" in
    --maintenance) maintenance=1 ;;
    -h | --help) sed -n '2,11p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "smoke-edge: bilinmeyen argüman: $arg" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null || { echo "smoke-edge: curl bulunamadı" >&2; exit 2; }

# Yerel CA kök sertifikası (make dev-ca) varsa doğrulamalı TLS, yoksa -k. Dosya içeriği okunmaz.
ca_file="$ROOT/infra/secrets/dev/caddy-local-root.crt"
if [[ -f "$ca_file" ]]; then
  tls_opts=(--cacert "$ca_file")
  tls_note="--cacert infra/secrets/dev/caddy-local-root.crt"
else
  tls_opts=(-k)
  tls_note="-k (CA dosyası yok; make dev-ca)"
fi

curl_base=(
  curl -sS --max-time 60 "${tls_opts[@]}"
  --resolve "${DOMAIN}:${PORT}:127.0.0.1"
  --resolve "app.${DOMAIN}:${PORT}:127.0.0.1"
  --resolve "admin.${DOMAIN}:${PORT}:127.0.0.1"
)

passed=0
failed=0
tmp="$(mktemp -d)"
api_stopped=0

cleanup() {
  if [[ "$api_stopped" == 1 ]]; then
    echo "smoke-edge: api yeniden başlatılıyor" >&2
    "$DC" dev start api >/dev/null 2>&1 || echo "smoke-edge: api başlatılamadı; elle: dc.sh dev start api" >&2
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

result() { # result <ad> <0|1> <ayrıntı>
  if [[ "$2" == 0 ]]; then
    printf 'GEÇTİ  %s\n' "$1"
    passed=$((passed + 1))
  else
    printf 'KALDI  %s (%s)\n' "$1" "$3"
    failed=$((failed + 1))
  fi
}

# Senaryo adı -> dosya adı (eğik çizgi ve boşluk içermez).
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }

# fetch <ad> [curl argümanları...] -> $tmp/<anahtar>.code, .headers (küçük harf), .body
fetch() {
  local f
  f="$tmp/$(key "$1")"
  shift
  local code
  code="$("${curl_base[@]}" -D "$f.headers.raw" -o "$f.body" -w '%{http_code}' "$@" 2>"$f.err" || true)"
  [[ -n "$code" ]] || code=000
  printf '%s' "$code" >"$f.code"
  if [[ -f "$f.headers.raw" ]]; then
    tr -d '\r' <"$f.headers.raw" | tr '[:upper:]' '[:lower:]' >"$f.headers"
  else
    : >"$f.headers"
  fi
  [[ -f "$f.body" ]] || : >"$f.body"
}

code_of() { cat "$tmp/$(key "$1").code"; }
body_of() { printf '%s' "$tmp/$(key "$1").body"; }

expect_code() { # expect_code <ad> <beklenen> [curl argümanları...]
  local name="$1" want="$2"
  shift 2
  fetch "$name" "$@"
  local got
  got="$(code_of "$name")"
  if [[ "$got" == "$want" ]]; then result "$name -> $want" 0 ""; else result "$name -> $want" 1 "gözlenen $got"; fi
}

post_zeros() { # post_zeros <ad> <bayt> <url> <beklenen>
  local name="$1" size="$2" url="$3" want="$4" got
  got="$(head -c "$size" /dev/zero | "${curl_base[@]}" -X POST -H 'Content-Type: application/octet-stream' \
    --data-binary @- -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  [[ -n "$got" ]] || got=000
  if [[ "$got" == "$want" ]]; then result "$name -> $want" 0 ""; else result "$name -> $want" 1 "gözlenen $got"; fi
}

has_header() { grep -q "^$2" "$tmp/$(key "$1").headers"; }

echo "smoke-edge: $APP, $ROOT_HOST, $ADMIN (TLS: $tls_note)"

# 1. Yönlendirme (002 §4, KK-002-15)
# Uygulama alanında kök yol /sohbet'e yönlendirilir (apps/web/src/proxy.ts).
expect_code "app GET /" 307 "$APP/"
expect_code "app GET /api/v1/admin/x" 404 "$APP/api/v1/admin/x"
expect_code "app GET /health" 404 "$APP/health"
expect_code "app GET /ready" 404 "$APP/ready"
expect_code "app GET /metrics" 404 "$APP/metrics"
expect_code "kök GET /api/v1/me" 404 "$ROOT_HOST/api/v1/me"
for p in giris kayit; do
  expect_code "kök GET /$p" 302 "$ROOT_HOST/$p"
  loc="$(sed -n 's/^location: *//p' "$tmp/$(key "kök GET /$p").headers" | head -n1)"
  want_loc="$(printf '%s/%s' "$EXPECTED_APP_URL" "$p" | tr '[:upper:]' '[:lower:]')"
  if [[ "$loc" == "$want_loc" ]]; then result "kök /$p Location = APP_URL/$p" 0 ""; else result "kök /$p Location = APP_URL/$p" 1 "gözlenen '${loc}'"; fi
done
fetch "admin GET /" "$ADMIN/"
admin_code="$(code_of "admin GET /")"
if [[ "$admin_code" =~ ^[23][0-9][0-9]$ ]]; then result "admin GET / (izinli CIDR) -> 2xx/3xx" 0 ""; else result "admin GET / (izinli CIDR) -> 2xx/3xx" 1 "gözlenen $admin_code"; fi

# 2. Gövde sınırları (Caddy; api ara katmanına ulaşmadan)
post_zeros "app POST /api/v1/files 51 MiB" "$SIZE_51MB" "$APP/api/v1/files" 413
post_zeros "app POST /api/v1/me 3 MiB" "$SIZE_3MB" "$APP/api/v1/me" 413

# 3. Güvenlik başlıkları (061 CTL-HDR-01/02); CSP Caddy'de yok (Caddy'nin kendi ürettiği 404'te denetlenir)
for name in "app GET /" "app GET /metrics" "kök GET /api/v1/me"; do
  missing=""
  has_header "$name" 'strict-transport-security: max-age=31536000; includesubdomains$' || missing+=" hsts"
  has_header "$name" 'x-content-type-options: nosniff$' || missing+=" nosniff"
  has_header "$name" 'referrer-policy: strict-origin-when-cross-origin$' || missing+=" referrer"
  has_header "$name" 'permissions-policy: camera=(self), microphone=(), geolocation=()$' || missing+=" permissions"
  has_header "$name" 'server:' && missing+=" server-var"
  has_header "$name" 'via:' && missing+=" via-var"
  if [[ -z "$missing" ]]; then result "başlıklar: $name" 0 ""; else result "başlıklar: $name" 1 "eksik/fazla:$missing"; fi
done
for name in "app GET /metrics" "kök GET /api/v1/me"; do
  if has_header "$name" 'content-security-policy'; then result "Caddy CSP eklemez: $name" 1 "CSP başlığı var"; else result "Caddy CSP eklemez: $name" 0 ""; fi
done
if has_header "app GET /metrics" 'x-robots-tag: noindex, nofollow$'; then result "app X-Robots-Tag" 0 ""; else result "app X-Robots-Tag" 1 "yok"; fi

# 4. Erişim logu: sorgu dizesi, Cookie, Authorization, tam IP yok (KK-070-9)
marker="smk$(date +%s)$$"
fetch "log isteği" -H "Cookie: eda_smoke=${marker}c" -H "Authorization: Bearer ${marker}a" \
  "$APP/smoke-edge-${marker}?gizli=${marker}q"
sleep 2
log_line="$("$DC" dev logs --no-log-prefix --since 5m caddy 2>/dev/null | grep "smoke-edge-${marker}" | tail -n1 || true)"
if [[ -z "$log_line" ]]; then
  result "erişim logu satırı bulundu" 1 "caddy logunda smoke-edge-${marker} yok"
else
  result "erişim logu satırı bulundu" 0 ""
  leaks=""
  [[ "$log_line" == *"${marker}q"* || "$log_line" == *"gizli="* ]] && leaks+=" sorgu"
  [[ "$log_line" == *"${marker}c"* || "$log_line" == *'"Cookie"'* ]] && leaks+=" cookie"
  [[ "$log_line" == *"${marker}a"* || "$log_line" == *'"Authorization"'* ]] && leaks+=" authorization"
  if grep -Eq '"(remote_ip|client_ip)":"([0-9]{1,3}\.){3}[1-9][0-9]{0,2}"' <<<"$log_line"; then leaks+=" tam-ipv4"; fi
  if [[ -z "$leaks" ]]; then result "erişim logu süzgeci" 0 ""; else result "erişim logu süzgeci" 1 "sızan:$leaks"; fi
fi

# 5. caddy adapt: SSE tamponlanmaz (flush_interval -1)
adapted="$("$DC" dev exec -T caddy caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true)"
if grep -q '"flush_interval":-1' <<<"$adapted"; then result "caddy adapt: flush_interval -1" 0 ""; else result "caddy adapt: flush_interval -1" 1 "çıktıda yok"; fi

# 6. Bakım yanıtı (isteğe bağlı; api durdurulur ve yeniden başlatılır)
if [[ "$maintenance" == 1 ]]; then
  api_stopped=1
  "$DC" dev stop api >/dev/null
  fetch "bakım app GET /api/v1/me" "$APP/api/v1/me"
  code="$(code_of "bakım app GET /api/v1/me")"
  if [[ "$code" == 503 ]]; then result "bakım: /api/v1/me -> 503" 0 ""; else result "bakım: /api/v1/me -> 503" 1 "gözlenen $code"; fi
  if has_header "bakım app GET /api/v1/me" 'retry-after: 30$'; then result "bakım: Retry-After: 30" 0 ""; else result "bakım: Retry-After: 30" 1 "yok"; fi
  if grep -q '"code":"INTERNAL_MAINTENANCE"' "$(body_of "bakım app GET /api/v1/me")" \
    && grep -Eq '"requestId":"[0-9a-f-]{36}"' "$(body_of "bakım app GET /api/v1/me")"; then
    result "bakım: INTERNAL_MAINTENANCE gövdesi" 0 ""
  else
    result "bakım: INTERNAL_MAINTENANCE gövdesi" 1 "gövde beklenen zarf değil"
  fi
  if has_header "bakım app GET /api/v1/me" 'server:'; then result "bakım: Server başlığı yok" 1 "var"; else result "bakım: Server başlığı yok" 0 ""; fi

  "$DC" dev start api >/dev/null
  api_stopped=0
  deadline=$((SECONDS + API_WAIT_SEC))
  code=000
  while ((SECONDS < deadline)); do
    code="$("${curl_base[@]}" -o /dev/null -w '%{http_code}' "$APP/api/v1/me" 2>/dev/null || true)"
    [[ "$code" =~ ^(502|503|504|000)$ ]] || break
    sleep 3
  done
  if [[ ! "$code" =~ ^(502|503|504|000)$ ]]; then result "bakım sonrası api geri döndü" 0 ""; else result "bakım sonrası api geri döndü" 1 "${API_WAIT_SEC} sn içinde $code"; fi
else
  echo "ATLANDI bakım senaryosu (--maintenance ile çalıştırın)"
fi

echo "Toplam: $((passed + failed)) senaryo, $passed geçti, $failed kaldı"
[[ "$failed" == 0 ]] || exit 1
