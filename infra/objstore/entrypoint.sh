#!/bin/sh
# objstore giriş betiği (033 §3.3): s3.json'u sırlardan tmpfs'e (0600) üretir ve tek düğüm SeaweedFS'i başlatır.
# Yalnız S3 (8333) tüm arayüzlere bağlanır; master (9333), volume ve filer loopback'tedir (014 §3.9).
set -eu
umask 077

secret() {
  value="$(cat "/run/secrets/$1")"
  [ -n "$value" ] || { echo "objstore-entrypoint: /run/secrets/$1 boş" >&2; exit 1; }
  printf '%s' "$value"
}

cat >/run/eda/s3.json <<JSON
{
  "identities": [
    {
      "name": "eda_app",
      "credentials": [{ "accessKey": "$(secret s3_access_key_id)", "secretKey": "$(secret s3_secret_access_key)" }],
      "actions": [
        "Read:eda-files", "Write:eda-files", "List:eda-files", "Tagging:eda-files",
        "Read:eda-exports", "Write:eda-exports", "List:eda-exports", "Tagging:eda-exports",
        "Read:eda-audit-seals", "List:eda-audit-seals"
      ]
    },
    {
      "name": "eda_audit",
      "credentials": [{ "accessKey": "$(secret s3_audit_access_key_id)", "secretKey": "$(secret s3_audit_secret_access_key)" }],
      "actions": ["Write:eda-audit-seals"]
    },
    {
      "name": "eda_s3_admin",
      "credentials": [{ "accessKey": "$(secret s3_admin_access_key_id)", "secretKey": "$(secret s3_admin_secret_access_key)" }],
      "actions": ["Admin"]
    }
  ]
}
JSON
chmod 0600 /run/eda/s3.json

exec weed server \
  -dir=/data \
  -ip=127.0.0.1 -ip.bind=127.0.0.1 \
  -master.volumeSizeLimitMB=1024 \
  -volume.max=0 \
  -filer \
  -s3 -s3.port=8333 -s3.ip.bind=0.0.0.0 -s3.config=/run/eda/s3.json
