#!/bin/bash
# infra/scripts/kek-escrow.sh (033 §5.5, 073 §8) - KEK emaneti: parola korumalı şifreli dışa aktarma ve doğrulama.
#
# Kullanım:
#   kek-escrow.sh export --kek <kek_master dosyası> --out <emanet dosyası> --pass-file <parola dosyası> [--force]
#   kek-escrow.sh verify --escrow <emanet dosyası> --pass-file <parola dosyası> [--kek <kek_master dosyası>]
#   kek-escrow.sh kcv    --kek <kek_master dosyası>
# --pass-file verilmezse parola terminalden sorulur (echo kapalı); terminal yoksa hata.
#
# KEK DEĞERİ hiçbir koşulda ekrana, loga veya komut satırı argümanına yazılmaz. Yazdırılan tek türev KCV'dir
# (HMAC-SHA256(KEK, "eda/v1/kek-check") ilk 8 bayt, onaltılık; sır değildir, 033 §5.5).
# Şifreleme: openssl AES-256-CBC + PBKDF2-SHA256 (600000 tur). Kimlik doğrulama KCV ile yapılır: yanlış parola veya
# bozuk dosya çözme hatası ya da KCV uyuşmazlığı verir. Bu araç Shamir 2-of-3 PARÇALAMA YAPMAZ (033 §5.5: tören
# aracı P33'te sürümle seçilir); bu dosya tek başına bir pay değil, KEK'in parola korumalı TAM kopyasıdır ve
# kurumun emanet kuralına göre (sunucu ve yedek hedefi DIŞINDA, çevrimdışı) saklanmalıdır.
# Çıkış kodları: 0 başarılı; 1 hata (doğrulama başarısızlığı dahil); 2 kullanım.
set -euo pipefail
umask 077

FORMAT_HEADER="EDA-KEK-ESCROW v1"
ITER=600000
KCV_LABEL="eda/v1/kek-check"
MIN_PASS_LEN=16

die() { echo "kek-escrow: $*" >&2; exit 1; }
usage() { echo "Kullanım: $0 <export|verify|kcv> [seçenekler] (başlık yorumuna bakın)" >&2; exit 2; }

[[ $# -ge 1 ]] || usage
CMD="$1"
shift

KEK_FILE="" OUT="" ESCROW="" PASS_FILE="" FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kek) KEK_FILE="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --escrow) ESCROW="${2:-}"; shift 2 ;;
    --pass-file) PASS_FILE="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) usage ;;
  esac
done

# ---------------------------------------------------------------- parola
PASS_SPEC=""   # openssl -pass argümanı
PROMPTED_PASS=""
prepare_pass() {
  if [[ -n "$PASS_FILE" ]]; then
    [[ -r "$PASS_FILE" ]] || die "parola dosyası okunamıyor"
    local first
    IFS= read -r first <"$PASS_FILE" || true
    [[ "${#first}" -ge "$MIN_PASS_LEN" ]] || die "parola en az ${MIN_PASS_LEN} karakter olmalı"
    PASS_SPEC="file:$PASS_FILE"
  else
    [[ -t 0 ]] || die "--pass-file verilmedi ve terminal yok"
    IFS= read -rsp "Emanet parolası: " PROMPTED_PASS
    echo >&2
    [[ "${#PROMPTED_PASS}" -ge "$MIN_PASS_LEN" ]] || die "parola en az ${MIN_PASS_LEN} karakter olmalı"
    PASS_SPEC="fd:3"
  fi
}

# fd 3 yalnız terminalden sorulan parolada anlamlıdır; dosya modunda boş açılır.
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -a -A -pass "$PASS_SPEC" "$@" 3< <(printf '%s\n' "$PROMPTED_PASS"); }

# ---------------------------------------------------------------- KEK ayrıştırma ve KCV
# $1: KEK dosya içeriği; stdout: 64 haneli onaltılık anahtar. Biçim: ilk satır v<sürüm>:<base64, 32 bayt> (@eda/crypto).
kek_hex() {
  local text="$1" line hex
  line="${text%%$'\n'*}"
  line="${line%$'\r'}"
  [[ "$line" =~ ^v[1-9][0-9]*:([A-Za-z0-9+/]{43}=)$ ]] || return 1
  hex="$(printf '%s' "${BASH_REMATCH[1]}" | base64 -d 2>/dev/null | od -An -tx1 | tr -d ' \n')" || return 1
  [[ "${#hex}" -eq 64 ]] || return 1
  printf '%s' "$hex"
}

# HMAC-SHA256 anahtarı komut satırına konmasın diye HMAC elle kurulur (RFC 2104; anahtar 32 bayt < blok 64 bayt).
kcv_of_hex() {
  local k="$1" i b ipad="" opad="" inner_hex outer_esc=""
  for ((i = 0; i < 64; i += 2)); do
    b=$((16#${k:i:2}))
    ipad+="$(printf '\\x%02x' $((b ^ 0x36)))"
    opad+="$(printf '\\x%02x' $((b ^ 0x5c)))"
  done
  for ((i = 0; i < 32; i++)); do ipad+='\x36'; opad+='\x5c'; done
  inner_hex="$({ printf "$ipad"; printf '%s' "$KCV_LABEL"; } | openssl dgst -sha256 -binary | od -An -tx1 | tr -d ' \n')"
  for ((i = 0; i < 64; i += 2)); do outer_esc+="\\x${inner_hex:i:2}"; done
  { printf "$opad"; printf "$outer_esc"; } | openssl dgst -sha256 -binary | od -An -tx1 | tr -d ' \n' | cut -c1-16
}

kcv_of_text() {
  local hex
  hex="$(kek_hex "$1")" || die "KEK biçimi geçersiz (ilk satır v<sürüm>:<base64, 32 bayt> olmalı)"
  kcv_of_hex "$hex"
}

read_kek_file() { # $1 yol; stdout içerik
  [[ -n "$1" && -r "$1" ]] || die "KEK dosyası okunamıyor"
  cat "$1"
}

# ---------------------------------------------------------------- komutlar
header_field() { # $1 dosya, $2 alan
  sed -n "s/^$2=//p" "$1" | head -n1
}

do_verify() { # $1 emanet dosyası, $2 isteğe bağlı KEK dosyası; stdout: KCV
  local file="$1" against="$2" ct want got plain
  [[ -r "$file" ]] || die "emanet dosyası okunamıyor"
  [[ "$(head -n1 "$file")" == "$FORMAT_HEADER" ]] || die "emanet dosyası biçimi tanınmadı"
  [[ "$(header_field "$file" iter)" == "$ITER" ]] || die "emanet KDF turu beklenenden farklı"
  want="$(header_field "$file" kcv)"
  [[ "$want" =~ ^[0-9a-f]{16}$ ]] || die "emanet dosyasında KCV yok veya bozuk"
  ct="$(header_field "$file" ct)"
  [[ -n "$ct" ]] || die "emanet dosyasında şifreli veri yok"
  prepare_pass
  plain="$(printf '%s' "$ct" | enc -d 2>/dev/null)" || die "çözülemedi: parola yanlış veya dosya bozuk"
  got="$(kcv_of_text "$plain")"
  [[ "$got" == "$want" ]] || die "KCV uyuşmuyor: parola yanlış veya dosya bozuk"
  if [[ -n "$against" ]]; then
    [[ "$(kcv_of_text "$(read_kek_file "$against")")" == "$got" ]] || die "emanet, verilen KEK dosyasıyla UYUŞMUYOR"
  fi
  printf '%s' "$got"
}

case "$CMD" in
  kcv)
    kcv_of_text "$(read_kek_file "$KEK_FILE")"
    echo
    ;;
  export)
    [[ -n "$OUT" ]] || usage
    [[ ! -e "$OUT" || "$FORCE" -eq 1 ]] || die "çıktı dosyası zaten var (üzerine yazmak için --force)"
    kek_text="$(read_kek_file "$KEK_FILE")"
    kcv="$(kcv_of_text "$kek_text")"
    prepare_pass
    ct="$(printf '%s' "$kek_text" | enc)" || die "şifreleme başarısız"
    tmp="$(mktemp "$(dirname "$OUT")/.kek-escrow.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    {
      echo "$FORMAT_HEADER"
      echo "kcv=$kcv"
      echo "kdf=pbkdf2-sha256"
      echo "iter=$ITER"
      echo "cipher=aes-256-cbc"
      echo "ct=$ct"
    } >"$tmp"
    # Yazılan dosya aynı parola ve asıl KEK ile yeniden doğrulanmadan teslim edilmez.
    (do_verify "$tmp" "$KEK_FILE" >/dev/null) || die "yazılan emanet doğrulanamadı; çıktı silindi"
    mv -f "$tmp" "$OUT"
    chmod 0600 "$OUT"
    trap - EXIT
    echo "Emanet yazıldı: $OUT (KCV: $kcv). Dosyayı ve parolayı AYRI taşıyıcılarda, sunucu dışında saklayın." >&2
    ;;
  verify)
    [[ -n "$ESCROW" ]] || usage
    kcv="$(do_verify "$ESCROW" "$KEK_FILE")"
    echo "Emanet doğrulandı (KCV: $kcv)"
    ;;
  *) usage ;;
esac
