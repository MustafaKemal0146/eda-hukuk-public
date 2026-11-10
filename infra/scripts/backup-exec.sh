#!/bin/bash
# infra/scripts/backup-exec.sh (071 §4.1, 073 §4.3) - `make backup` yürütücüsü: çalışan `backup` konteynırında
# backup-run.sh / backup-init.sh çalıştırır. Konteynırı compose proje etiketinden bulur; compose dosyası/sırrı gerekmez.
# Kullanım: backup-exec.sh <prod|beta|staging> <full|incr|init|status-refresh|drill-ok|drill-failed> [<zaman>]
#   drill-ok | drill-failed: host'taki geri yükleme tatbikatı sonucunu status.json'a işler (zaman isteğe bağlı).
# Çıkış kodları: konteynırdaki betiğin kodu; 2 kullanım; 3 konteynır bulunamadı.
set -euo pipefail

env_name="${1:-}"
kind="${2:-}"
at="${3:-}"
case "$env_name" in
  prod) project=eda-prod ;;
  beta) project=eda-beta ;;
  staging) project=eda-staging ;;
  *) echo "backup-exec: ENV prod|beta|staging olmalı" >&2; exit 2 ;;
esac
# Tek VPS pilot host-role=beta ile koşar ama proje adı eda-pilot'tur: EDA_COMPOSE_PROJECT (units.env) önceliklidir.
if [[ -n "${EDA_COMPOSE_PROJECT:-}" ]]; then
  [[ "$EDA_COMPOSE_PROJECT" =~ ^eda(-[a-z]+)?$ ]] || { echo "backup-exec: EDA_COMPOSE_PROJECT geçersiz" >&2; exit 2; }
  project="$EDA_COMPOSE_PROJECT"
fi
case "$kind" in
  full | incr | status-refresh) script=backup-run.sh; at="" ;;
  drill-ok | drill-failed)
    script=backup-run.sh
    [[ -z "$at" || "$at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
      || { echo "backup-exec: zaman ISO-8601 UTC olmalı" >&2; exit 2; }
    ;;
  init) script=backup-init.sh; kind="" ;;
  *) echo "backup-exec: KIND full|incr|init|status-refresh|drill-ok|drill-failed olmalı" >&2; exit 2 ;;
esac

container="$(docker ps -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=backup" | head -n1)"
if [[ -z "$container" ]]; then
  echo "backup-exec: '$project' projesinde çalışan backup konteynırı yok" >&2
  exit 3
fi
if [[ -n "$at" ]]; then
  exec docker exec -i "$container" "/usr/local/bin/$script" "$kind" "$at"
fi
if [[ -n "$kind" ]]; then
  exec docker exec -i "$container" "/usr/local/bin/$script" "$kind"
fi
exec docker exec -i "$container" "/usr/local/bin/$script"
