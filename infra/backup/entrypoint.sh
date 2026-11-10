#!/bin/sh
# infra/backup/entrypoint.sh (070 §10.7, 073 §7.1)
set -eu

# pgBackRest yapılandırması açıkça verilir: Debian paketinin /etc/pgbackrest.conf dosyası postgres:postgres 0640
# olduğundan backup kullanıcısı (10007) okuyamaz ve `pgbackrest server` çöker. Sır içeren ek yapılandırma ayrı
# bir include dizinindedir (/run/eda başka dosyalar da içerir, include edilemez). config-include-path
# yalnız ortam/komut satırı seçeneğidir, dosyada yok sayılır.
export PGBACKREST_CONFIG=/etc/eda-backup/pgbackrest.conf
export PGBACKREST_CONFIG_INCLUDE_PATH=/run/eda/pgbackrest.d

mkdir -p /tmp/pgbackrest/log /tmp/pgbackrest/lock /run/eda/www /run/eda/pgbackrest.d
chmod 0700 /run/eda/pgbackrest.d
if [ -f /run/secrets/pgbackrest_repo_key ]; then
  cp /run/secrets/pgbackrest_repo_key /tmp/pgbackrest/pgbackrest_repo_key
  chmod 0600 /tmp/pgbackrest/pgbackrest_repo_key
fi

# pgBackRest cipher password (073 §4.2). Değişken adı EDA_ önekli: PGBACKREST_ ile başlayan bilinmeyen
# adlar pgBackRest'te "environment contains invalid option" uyarısı verir.
if [ -r "${EDA_PGBACKREST_CIPHER_PASS_FILE:-}" ]; then
  (
    umask 077
    {
      printf '[global]\n'
      printf 'repo1-cipher-pass=%s\n' "$(cat "$EDA_PGBACKREST_CIPHER_PASS_FILE")"
    } >/run/eda/pgbackrest.d/secret.conf
  )
  chmod 0600 /run/eda/pgbackrest.d/secret.conf
fi

# Restic env (073 §5.1)
if [ -r "${RESTIC_PASSWORD_FILE:-}" ]; then RESTIC_PASSWORD="$(cat "$RESTIC_PASSWORD_FILE")"; export RESTIC_PASSWORD; fi
if [ -r "${BACKUP_S3_ACCESS_KEY_ID_FILE:-}" ]; then AWS_ACCESS_KEY_ID="$(cat "$BACKUP_S3_ACCESS_KEY_ID_FILE")"; export AWS_ACCESS_KEY_ID; fi
if [ -r "${BACKUP_S3_SECRET_ACCESS_KEY_FILE:-}" ]; then AWS_SECRET_ACCESS_KEY="$(cat "$BACKUP_S3_SECRET_ACCESS_KEY_FILE")"; export AWS_SECRET_ACCESS_KEY; fi

# Durum ucu httpd konfigürasyonu (073 §7.1: Basic auth)
if [ -r "${BACKUP_STATUS_TOKEN_FILE:-}" ]; then
  TOKEN="$(cat "$BACKUP_STATUS_TOKEN_FILE")"
  echo "/:eda_jobs:$TOKEN" > /run/eda/httpd.conf
  chmod 0600 /run/eda/httpd.conf
else
  touch /run/eda/httpd.conf
fi

# İlk durum dosyasını üret
/usr/local/bin/backup-run.sh status-refresh

# Durum ucu web sunucusu (073 §7.1: busybox httpd)
busybox httpd -p "${BACKUP_STATUS_PORT:-8433}" -h /run/eda/www -c /run/eda/httpd.conf

# pgBackRest TLS repo sunucusu (073 §3); yapılandırma yukarıdaki PGBACKREST_CONFIG ortamından gelir
pgbackrest server &

# supercronic zamanlayıcısı
exec supercronic /etc/eda-backup/crontab
