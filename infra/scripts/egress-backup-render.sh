#!/bin/bash
# infra/scripts/egress-backup-render.sh (070 §11, 073 §5.1) - egress-backup izin listesini BACKUP_S3_HOST'tan üretir.
# Kullanım: BACKUP_S3_HOST=<alan-adı> egress-backup-render.sh [--write]
#   Varsayılan: YAML'ı stdout'a yazar. --write: infra/egress/egress-backup.yaml dosyasının üzerine yazar.
# BACKUP_S3_HOST boşsa veya yer tutucuysa (backup-s3.local) liste BOŞ üretilir (vekil her hedefi reddeder).
# Doluysa tam bir alan adı olmalıdır (joker, şema, yol, port, IP yok); aksi hâlde çıkış 1.
# HASSAS YOL: infra/egress CODEOWNERS kapsamındadır; üretilen dosya PR'da ayrı incelenir .
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${EGRESS_BACKUP_OUT:-$ROOT/infra/egress/egress-backup.yaml}"
HOST="${BACKUP_S3_HOST:-}"
HOST="${HOST,,}"
PLACEHOLDER="backup-s3.local"

domains="  allowed_domains: []"
if [[ -n "$HOST" && "$HOST" != "$PLACEHOLDER" ]]; then
  if ! [[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || [[ "$HOST" =~ ^[0-9.]+$ ]]; then
    echo "egress-backup-render: BACKUP_S3_HOST geçerli bir alan adı değil (joker, şema, yol, port veya IP kullanılamaz)" >&2
    exit 1
  fi
  domains="  allowed_domains:
    - ${HOST}"
fi

render() {
  cat <<YAML
# egress-backup izin listesi (backup; 002 §3, 070 §11) - yalnız BACKUP_S3_HOST.
# ÜRETİLMİŞTİR: infra/scripts/egress-backup-render.sh --write (BACKUP_S3_HOST değerinden). Elle düzenlenmez.
# BACKUP_S3_HOST boş veya yer tutucuyken liste boştur ve vekil her hedefi reddeder; bu durumda off-site kopya
# alınmaz (backup-run.sh/offsite-sync.sh bunu "offsite=disabled" olarak bildirir, prod'da hata sayar).
# Gerçek host eklenen değişiklik CODEOWNERS PR'ından geçer; check-egress-allowlist boşken boş, doluyken birebir eşleşme arar.
version: v1
services: []
default:
  name: default
  project: eda
  action: enforce
${domains}
YAML
}

if [[ "${1:-}" == "--write" ]]; then
  render >"$OUT"
else
  render
fi
