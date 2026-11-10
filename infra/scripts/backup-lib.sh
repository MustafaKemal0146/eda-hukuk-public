#!/bin/bash
# infra/scripts/backup-lib.sh (073 §4.4, §5.4, §7.2) - backup-run, offsite-sync ve backup-init ortak yardımcıları.
# `source` edilir. Sır değeri hiçbir yardımcıda yazdırılmaz; durum dosyalarında yalnız kısa kod, sayı, zaman.

EDA_STATE_DIR="${EDA_STATE_DIR:-/run/eda/state}"
# 002 §5.10 ve compose varsayılanı: BACKUP_S3_HOST tanımsızken compose bu yer tutucuyu yazar; hedef YAPILANDIRILMAMIŞ sayılır.
BACKUP_S3_PLACEHOLDER_HOST="backup-s3.local"
# Çıkış kodları: offsite-sync yapılandırılmamış hedef için 10 döner (uyarı veya hata kararı çağıranındır).
# shellcheck disable=SC2034 # backup-run, backup-init ve offsite-sync bu lib'i kaynaklayıp kullanır
EX_OFFSITE_DISABLED=10

export PGBACKREST_CONFIG="${PGBACKREST_CONFIG:-/etc/eda-backup/pgbackrest.conf}"
# Sır içeren ek yapılandırma (repo1-cipher-pass) ayrı include dizininden yüklenir; entrypoint.sh ile aynı değer.
# config-include-path dosyada geçersizdir, yalnız ortam/komut satırıyla verilir.
export PGBACKREST_CONFIG_INCLUDE_PATH="${PGBACKREST_CONFIG_INCLUDE_PATH:-/run/eda/pgbackrest.d}"

now_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
now_epoch() { date -u +%s; }

log() { printf '%s %s\n' "$(now_utc)" "$*" >&2; }

# development ve test dışındaki her ortam (staging, beta-synthetic, production, onprem, tanımsız) sıkıdır: fail-closed.
eda_strict_env() {
  case "${EDA_ENV:-}" in
    development | test) return 1 ;;
    *) return 0 ;;
  esac
}

offsite_configured() {
  local host="${BACKUP_S3_HOST:-}"
  [[ -n "$host" && "$host" != "$BACKUP_S3_PLACEHOLDER_HOST" && -n "${RESTIC_REPOSITORY:-}" ]]
}

# Durum parçası: $1 ad (ör. backup, verify, offsite-wal), $2 durum (ok|failed|disabled|running), $3 çıkış kodu, $4 süre (sn)
state_write() {
  local name="$1" state="$2" code="$3" secs="$4" tmp
  mkdir -p "$EDA_STATE_DIR"
  tmp="$(mktemp "$EDA_STATE_DIR/.${name}.XXXXXX")"
  printf '{"name":"%s","state":"%s","exitCode":%d,"at":"%s","durationSeconds":%d}\n' \
    "$name" "$state" "$code" "$(now_utc)" "$secs" >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$EDA_STATE_DIR/${name}.json"
}

# Bir komutu çalıştırır, çıkış kodunu ve süreyi durum parçasına yazar, kodu döndürür (set -e altında yutmaz).
# Kullanım: run_step <durum-adı> <komut...>
run_step() {
  local name="$1" start rc=0 state=ok
  shift
  start="$(now_epoch)"
  "$@" || rc=$?
  [[ "$rc" -eq 0 ]] || state=failed
  state_write "$name" "$state" "$rc" "$(($(now_epoch) - start))"
  return "$rc"
}

# `docker exec` ile başlatılan süreçler entrypoint'in dışa aktardığı ortamı görmez; sırlar _FILE yollarından
# (yalnız bellekteki ortam değişkenine) yüklenir. Değerler hiçbir yere yazdırılmaz.
load_offsite_env() {
  if [[ -z "${RESTIC_PASSWORD:-}" && -n "${RESTIC_PASSWORD_FILE:-}" && -r "${RESTIC_PASSWORD_FILE}" ]]; then
    RESTIC_PASSWORD="$(<"$RESTIC_PASSWORD_FILE")"
    export RESTIC_PASSWORD
  fi
  if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${BACKUP_S3_ACCESS_KEY_ID_FILE:-}" && -r "${BACKUP_S3_ACCESS_KEY_ID_FILE}" ]]; then
    AWS_ACCESS_KEY_ID="$(<"$BACKUP_S3_ACCESS_KEY_ID_FILE")"
    export AWS_ACCESS_KEY_ID
  fi
  if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${BACKUP_S3_SECRET_ACCESS_KEY_FILE:-}" && -r "${BACKUP_S3_SECRET_ACCESS_KEY_FILE}" ]]; then
    AWS_SECRET_ACCESS_KEY="$(<"$BACKUP_S3_SECRET_ACCESS_KEY_FILE")"
    export AWS_SECRET_ACCESS_KEY
  fi
}
load_offsite_env
