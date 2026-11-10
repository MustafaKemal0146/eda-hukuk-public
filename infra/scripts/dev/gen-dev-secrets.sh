#!/usr/bin/env bash
# Dev/test sırlarını üretir (070 §15). devtools konteynırında koşar (openssl gerekir; Y-109).
# İdempotent: var olan ve boş olmayan üretilmiş sır değişmez. FORCE=1 yalnız üretilen sırları yeniler.
# Hiçbir sır değeri stdout/stderr'e yazılmaz; yalnız sayım özeti basılır.
#
# Kullanım: gen-dev-secrets.sh [hedef-dizin]   (varsayılan: infra/secrets/dev)
set -euo pipefail
umask 077

readonly DIR="${1:-infra/secrets/dev}"
readonly FORCE="${FORCE:-0}"
generated=0
kept=0

mkdir -p "$DIR"
chmod 0700 "$DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Üretilmiş dosyayı yazar: hedef yoksa/boşsa ya da FORCE=1 ise. $1 = ad, stdin = içerik.
put() {
  local name="$1" target="$DIR/$1"
  if [[ -s "$target" && "$FORCE" != "1" ]]; then
    kept=$((kept + 1))
    cat >/dev/null
    return 0
  fi
  cat >"$tmp/$name"
  chmod 0644 "$tmp/$name"
  mv -f "$tmp/$name" "$target"
  generated=$((generated + 1))
}

exists() { [[ -s "$DIR/$1" && "$FORCE" != "1" ]]; }

b64url32() { openssl rand 32 | basenc --base64url -w0 | tr -d '='; }
rand_charset() { # $1 = uzunluk, $2 = tr karakter kümesi
  local out=''
  while ((${#out} < $1)); do out+="$(openssl rand 256 | tr -dc "$2")"; done
  printf '%s' "${out:0:$1}"
}

# 1) 32 bayt base64url parolalar ve jetonlar
for name in pg_superuser_password pg_owner_password pg_auth_password pg_app_password \
  pg_worker_password pg_jobs_password pg_readonly_admin_password pg_backup_password \
  pg_monitor_password valkey_api_password valkey_worker_password valkey_jobs_password \
  valkey_cache_api_password valkey_cache_worker_password valkey_cache_mcp_password \
  doc_engine_token tei_api_key backup_status_token dev_seed_password; do
  put "$name" < <(b64url32)
done

# 2) 32 bayt base64 anahtarlar
for name in better_auth_secret better_auth_admin_secret hmac_pseudonym_key; do
  put "$name" < <(openssl rand -base64 32 | tr -d '\n')
done
# kek_master ilk satırı `v<sürüm>:<base64>` (033 §4.1; @eda/crypto parseKekFile).
put kek_master < <(printf 'v1:%s' "$(openssl rand -base64 32 | tr -d '\n')")

# 3) 48 bayt base64
for name in pgbackrest_cipher_pass restic_password; do
  put "$name" < <(openssl rand -base64 48 | tr -d '\n')
done

# 4) Ed25519 servis JWT çifti (aynı koşuda birlikte)
if exists internal_jwt_private_key && exists internal_jwt_public_key; then
  kept=$((kept + 2))
else
  openssl genpkey -algorithm ED25519 -out "$tmp/jwt.key" 2>/dev/null
  put internal_jwt_private_key <"$tmp/jwt.key"
  put internal_jwt_public_key < <(openssl pkey -in "$tmp/jwt.key" -pubout 2>/dev/null)
fi

# 5) S3 kimlik çiftleri: kimlik 20 [A-Z0-9], gizli 40 [A-Za-z0-9]
for prefix in s3 s3_audit s3_admin; do
  put "${prefix}_access_key_id" < <(rand_charset 20 'A-Z0-9')
  put "${prefix}_secret_access_key" < <(rand_charset 40 'A-Za-z0-9')
done

# 6) VAPID P-256: özel anahtar base64url (32 bayt skaler), genel anahtar derived.env'e (65 bayt sıkıştırılmamış)
if exists vapid_private_key && [[ -s "$DIR/derived.env" ]]; then
  kept=$((kept + 2))
else
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/vapid.pem" 2>/dev/null
  put vapid_private_key < <(openssl ec -in "$tmp/vapid.pem" -outform DER 2>/dev/null \
    | tail -c +8 | head -c 32 | basenc --base64url -w0 | tr -d '=')
  pub="$(openssl ec -in "$tmp/vapid.pem" -pubout -outform DER 2>/dev/null | tail -c 65 \
    | basenc --base64url -w0 | tr -d '=')"
  put derived.env < <(printf '# Üretildi (make secrets); yalnız genel değerler, sır içermez.\nVAPID_PUBLIC_KEY=%s\n' "$pub")
fi

# 7) pgBackRest karşılıklı TLS: yerel CA (ECDSA P-256, 365 gün) + repo ve pg sertifikaları
if exists pgbackrest_ca_crt && exists pgbackrest_repo_crt && exists pgbackrest_repo_key \
  && exists pgbackrest_pg_crt && exists pgbackrest_pg_key; then
  kept=$((kept + 5))
else
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 \
    -subj "/CN=eda-dev-pgbackrest-ca" -keyout "$tmp/ca.key" -out "$tmp/ca.crt" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  issue() { # $1 = dosya öneki, $2 = CN, $3 = SAN DNS
    openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=$2" \
      -keyout "$tmp/$1.key" -out "$tmp/$1.csr" 2>/dev/null
    printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth,clientAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n' "$3" >"$tmp/$1.ext"
    openssl x509 -req -in "$tmp/$1.csr" -CA "$tmp/ca.crt" -CAkey "$tmp/ca.key" -CAcreateserial \
      -days 365 -extfile "$tmp/$1.ext" -out "$tmp/$1.crt" 2>/dev/null
  }
  issue repo eda-backup-repo backup
  issue pg postgres postgres
  put pgbackrest_ca_crt <"$tmp/ca.crt"
  put pgbackrest_repo_crt <"$tmp/repo.crt"
  put pgbackrest_repo_key <"$tmp/repo.key"
  put pgbackrest_pg_crt <"$tmp/pg.crt"
  put pgbackrest_pg_key <"$tmp/pg.key"
fi

# 8) Sağlayıcı sırları: boş dosya (dev'de kullanılmaz). Elle doldurulanlara asla dokunulmaz.
for name in deepseek_api_key anthropic_api_key anthropic_eu_api_key azure_eu_api_key vertex_credentials local_llm_api_key \
  google_client_secret email_api_key iyzico_api_key iyzico_secret_key \
  backup_s3_access_key_id backup_s3_secret_access_key acme_dns_api_token; do
  if [[ -e "$DIR/$name" ]]; then
    kept=$((kept + 1))
  else
    : >"$DIR/$name"
    chmod 0644 "$DIR/$name"
    generated=$((generated + 1))
  fi
done

# Kök dışı konteynır kullanıcıları okuyabilmeli; koruma dizin izniyle (0700) sağlanır (070 §3).
find "$DIR" -maxdepth 1 -type f -exec chmod 0644 {} +

if [[ "$FORCE" == "1" ]]; then
  echo "UYARI: FORCE=1 üretilen sırları yeniledi. Var olan birimlerde DB/Valkey/S3 parolaları değişmez: make reset gerekir." >&2
fi
echo "make secrets: $generated üretildi, $kept korundu ($DIR)"
