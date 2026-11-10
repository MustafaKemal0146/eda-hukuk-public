#!/bin/bash
# infra/scripts/offsite-sync.sh (073 §5.4) - off-site (restic) eşitleme.
# Çıkış kodları: 0 başarılı; 1 hata; 2 kullanım; 10 hedef yapılandırılmamış (YALNIZ development/test; uyarıdır, hata değil).
# Sıkı ortamlarda (production, staging, beta-synthetic, onprem) yapılandırılmamış hedef HATADIR (çıkış 1).
# Hiçbir restic hatası yutulmaz; sonuç durum dosyasına (EDA_STATE_DIR/offsite-<iş>.json) yazılır.
set -euo pipefail

# shellcheck source=backup-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"

ACTION="${1:-wal}"
case "$ACTION" in
  wal | repo | obj | check) ;;
  *)
    echo "Kullanım: $0 <wal|repo|obj|check>" >&2
    exit 2
    ;;
esac

STATE_NAME="offsite-${ACTION}"
PG_REPO_DIR="${PGBACKREST_REPO_PATH:-/var/lib/pgbackrest}"
OBJ_DIR="${OBJDATA_DIR:-/srv/objdata}"
START="$(now_epoch)"

# $1 neden, $2 restic/araç çıkış kodu (durum dosyasına yazılır). Süreç çıkışı her zaman 1'dir
# (restic'in 10 kodu "depo yok" anlamındadır, "hedef kapalı" 10'u ile karışmasın).
fail() {
  log "off-site eşitleme (${ACTION}) BAŞARISIZ: $1"
  state_write "$STATE_NAME" failed "${2:-1}" "$(($(now_epoch) - START))"
  exit 1
}

if ! offsite_configured; then
  if eda_strict_env; then
    log "HATA: off-site yedek hedefi yapılandırılmamış (BACKUP_S3_HOST/RESTIC_REPOSITORY boş veya yer tutucu); EDA_ENV=${EDA_ENV:-tanımsız} ortamında zorunludur."
    state_write "$STATE_NAME" failed 1 0
    exit 1
  fi
  log "UYARI: offsite=disabled - BACKUP_S3_HOST yapılandırılmamış; off-site kopya ALINMIYOR (yalnız development/test'te kabul edilir)."
  state_write "$STATE_NAME" disabled "$EX_OFFSITE_DISABLED" 0
  exit "$EX_OFFSITE_DISABLED"
fi

command -v restic >/dev/null 2>&1 || fail "restic bulunamadı"
[[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || fail "off-site kimlik bilgisi (BACKUP_S3_*_FILE) okunamadı"
[[ -n "${RESTIC_PASSWORD:-}" ]] || fail "restic parolası (RESTIC_PASSWORD_FILE) tanımlı değil"

REPO="$RESTIC_REPOSITORY"
rc=0

case "$ACTION" in
  wal)
    [[ -d "$PG_REPO_DIR/archive" ]] || fail "WAL arşiv dizini yok (stanza-create yapıldı mı?)"
    restic -r "$REPO/pg" backup "$PG_REPO_DIR/archive" --host eda-prod --tag wal --retry-lock 5m --read-concurrency 2 || rc=$?
    ;;
  repo)
    [[ -d "$PG_REPO_DIR/backup" ]] || fail "pgBackRest backup dizini yok"
    # backup.info* dosyaları backup/<stanza>/ altındadır; dizin bütünüyle alınır.
    restic -r "$REPO/pg" backup "$PG_REPO_DIR/backup" --host eda-prod --tag repo || rc=$?
    ;;
  obj)
    [[ -d "$OBJ_DIR" ]] || fail "nesne verisi dizini bağlı değil"
    restic -r "$REPO/obj" backup "$OBJ_DIR" --host eda-prod --tag obj \
      --exclude "$OBJ_DIR/filerldb2" --exclude "$OBJ_DIR/_meta/*.tmp" --retry-lock 10m || rc=$?
    ;;
  check)
    # İki depo da denenir; biri bozuksa diğeri atlanmaz ama sonuç hatadır.
    restic -r "$REPO/pg" check --read-data-subset=2% || rc=$?
    restic -r "$REPO/obj" check --read-data-subset=2% || rc=$?
    ;;
esac

if [[ "$rc" -ne 0 ]]; then
  fail "restic çıkış kodu ${rc}" "$rc"
fi
state_write "$STATE_NAME" ok 0 "$(($(now_epoch) - START))"
