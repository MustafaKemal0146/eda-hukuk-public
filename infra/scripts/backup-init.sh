#!/bin/bash
# infra/scripts/backup-init.sh (073 §4.3 adım 2 ve 4) - ilk kurulum, İDEMPOTENT.
#   1) pgbackrest stanza-create (stanza zaten varsa ATLANIR: WAL arşivleyicisi kilidi tutar) + server-ping
#      bekleme + check
#   2) restic init: pg ve obj alt depoları (zaten varsa atlanır)
# Çıkış kodları: 0 başarılı; 1 hata; 10 yalnız development/test'te off-site hedefi yapılandırılmamış
# (pgBackRest kısmı başarılı, restic atlandı: uyarı). Sıkı ortamlarda hedefsizlik hatadır (1).
set -euo pipefail

# shellcheck source=backup-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"

STANZA="${PGBACKREST_STANZA:-eda}"
START="$(now_epoch)"
RESTIC_REPO_MISSING=10 # restic >= 0.17: "depo yok" çıkış kodu

fail() {
  log "HATA: $1"
  state_write init failed 1 "$(($(now_epoch) - START))"
  exit 1
}

# Bekleme/yeniden deneme sınırları (testlerde ortamdan kısaltılır).
INIT_RETRIES="${BACKUP_INIT_RETRIES:-6}"
INIT_RETRY_SLEEP="${BACKUP_INIT_RETRY_SLEEP:-5}"
PING_RETRIES="${BACKUP_INIT_PING_RETRIES:-24}"
PING_SLEEP="${BACKUP_INIT_PING_SLEEP:-5}"

# Stanza var mı? `pgbackrest info` stanza yokken de çıkış 0 verir (status.code 1 "missing stanza path"); bu yüzden
# durum kodu okunur: 0 = tamam, 2 = stanza var ama henüz geçerli yedek yok (ilk kurulumun olağan hâli). Diğerleri = yok.
stanza_exists() {
  local out code
  out="$(pgbackrest --stanza="$STANZA" --output=json info 2>/dev/null)" || return 1
  code="$(printf '%s' "$out" | jq -r --arg s "$STANZA" '[.[]? | select(.name == $s) | .status.code] | first // empty' 2>/dev/null)" || return 1
  [[ "$code" == 0 || "$code" == 2 ]]
}

log "pgBackRest stanza '${STANZA}' hazırlanıyor"
if stanza_exists; then
  log "stanza '${STANZA}' zaten var: stanza-create atlandı"
else
  # İlk kurulumda WAL arşivleyicisi (archive-push) kilidi kısa süre tutabilir: LockAcquireError için sınırlı yeniden deneme.
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    rc=0
    err="$(pgbackrest --stanza="$STANZA" stanza-create 2>&1)" || rc=$?
    [[ "$rc" -eq 0 ]] && break
    if [[ "$err" == *"unable to acquire lock"* || "$err" == *"LockAcquireError"* || "$err" == *"[050]"* ]] && ((attempt < INIT_RETRIES)); then
      log "stanza-create kilit nedeniyle başarısız (deneme ${attempt}/${INIT_RETRIES}); ${INIT_RETRY_SLEEP} sn sonra yeniden"
      sleep "$INIT_RETRY_SLEEP"
      continue
    fi
    # Başka bir süreç stanza'yı arada oluşturmuş olabilir.
    stanza_exists && break
    printf '%s\n' "$err" >&2
    fail "stanza-create başarısız"
  done
fi

# WAL arşivi ilk kurulumda backup TLS sunucusu hazır olmadan birikir; check zaman aşımına uğramasın.
ping_ok=0
for ((i = 1; i <= PING_RETRIES; i++)); do
  if pgbackrest server-ping >/dev/null 2>&1; then ping_ok=1; break; fi
  log "pgBackRest TLS sunucusu henüz hazır değil (${i}/${PING_RETRIES})"
  sleep "$PING_SLEEP"
done
[[ "$ping_ok" -eq 1 ]] || fail "pgBackRest TLS sunucusu hazır olmadı (server-ping)"

pgbackrest --stanza="$STANZA" check || fail "pgbackrest check başarısız (WAL arşivi ve bağlantı)"
log "pgBackRest stanza hazır ve check geçti"

if ! offsite_configured; then
  if eda_strict_env; then
    fail "off-site yedek hedefi yapılandırılmamış (BACKUP_S3_HOST/RESTIC_REPOSITORY); EDA_ENV=${EDA_ENV:-tanımsız} ortamında zorunludur"
  fi
  log "UYARI: offsite=disabled - restic depoları BAŞLATILMADI (yalnız development/test'te kabul edilir)."
  state_write init ok 0 "$(($(now_epoch) - START))"
  exit "$EX_OFFSITE_DISABLED"
fi

command -v restic >/dev/null 2>&1 || fail "restic bulunamadı"
[[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || fail "off-site kimlik bilgisi okunamadı"

for sub in pg obj; do
  rc=0
  restic -r "$RESTIC_REPOSITORY/$sub" cat config >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) log "restic deposu '${sub}' zaten var, atlandı" ;;
    "$RESTIC_REPO_MISSING")
      restic -r "$RESTIC_REPOSITORY/$sub" init >/dev/null || fail "restic init '${sub}' başarısız"
      log "restic deposu '${sub}' oluşturuldu"
      ;;
    *) fail "restic deposu '${sub}' okunamadı (çıkış ${rc}): ağ, kimlik veya parola" ;;
  esac
done

state_write init ok 0 "$(($(now_epoch) - START))"
log "ilk kurulum tamam"
