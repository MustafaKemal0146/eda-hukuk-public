#!/bin/bash
# infra/scripts/egress-llm-render.sh (070 §11) - pilot/prod egress-llm izin listesini üretir: depodaki
# infra/egress/egress-llm.yaml + EMAIL_API_URL host'u (e-posta sağlayıcısı).
# Kullanım: EMAIL_API_URL=https://api.resend.com egress-llm-render.sh [--write]
#   Varsayılan: YAML'ı stdout'a yazar. --write: EGRESS_LLM_OUT dosyasına yazar (zorunlu; depodaki dosyanın üzerine YAZILMAZ).
# Yalnız e-posta taşıma kodunun tanıdığı sağlayıcılar eklenir (packages/email/src/transport/http/common.ts ile aynı küme):
# api.resend.com, api.brevo.com. Joker, http, port, IP, kimlik bilgisi yok. EMAIL_API_URL boş veya tanınmayan ise sağlayıcı
# EKLENMEZ (çıktı depodaki dosyayla aynıdır), stderr'e uyarı yazılır, çıkış 0 (dağıtım düşmez).
# HASSAS YOL: infra/egress CODEOWNERS kapsamındadır; bu betik o dosyaya dokunmaz, yalnız okur.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${EGRESS_LLM_SRC:-$ROOT/infra/egress/egress-llm.yaml}"
OUT="${EGRESS_LLM_OUT:-}"
URL="${EMAIL_API_URL:-}"
KNOWN=(api.resend.com api.brevo.com)

[[ -r "$SRC" ]] || { echo "egress-llm-render: $SRC okunamıyor" >&2; exit 1; }

host=''
if [[ -z "$URL" ]]; then
  echo "egress-llm-render: UYARI: EMAIL_API_URL boş; e-posta sağlayıcısı listeye EKLENMEDİ (e-posta gönderilemez)" >&2
else
  u="${URL,,}"
  if [[ "$u" == https://* ]]; then
    h="${u#https://}"
    h="${h%%[/?#]*}"
    for k in "${KNOWN[@]}"; do [[ "$h" == "$k" ]] && host="$h"; done
  fi
  if [[ -z "$host" ]]; then
    echo "egress-llm-render: UYARI: EMAIL_API_URL host'u tanınmıyor (desteklenen: ${KNOWN[*]}); listeye EKLENMEDİ" >&2
  fi
fi

has_domain() { awk -v h="$2" '$1 == "-" && $2 == h { f = 1 } END { exit !f }' "$1"; }

render() {
  if [[ -n "$host" ]] && ! has_domain "$SRC" "$host"; then
    awk -v h="$host" '{ print } /^[[:space:]]+allowed_domains:[[:space:]]*$/ && !done { print "    - " h; done = 1 }' "$SRC"
  else
    cat "$SRC"
  fi
}

if [[ "${1:-}" == "--write" ]]; then
  [[ -n "$OUT" ]] || { echo "egress-llm-render: --write için EGRESS_LLM_OUT gerekli" >&2; exit 2; }
  [[ "$(readlink -f "$OUT")" != "$(readlink -f "$SRC")" ]] || { echo "egress-llm-render: çıktı depodaki dosya olamaz" >&2; exit 2; }
  tmp="$OUT.tmp.$$"
  render >"$tmp"
  if [[ -n "$host" ]] && ! has_domain "$tmp" "$host"; then
    rm -f "$tmp"
    echo "egress-llm-render: $host eklenemedi (allowed_domains bulunamadı)" >&2
    exit 1
  fi
  mv -f "$tmp" "$OUT"
else
  render
fi
