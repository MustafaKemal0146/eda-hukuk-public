#!/bin/bash
# infra/scripts/restore-drill.sh (073 §12) - geri yükleme tatbikatı. DR hostunda `make restore-drill` ile çalışır.
#
# Yedek deposunu (pgBackRest repo1, yerel posix kopya) GEÇİCİ bir PostgreSQL örneğine geri yükler, migrate defteri ve
# birkaç tablo sayımıyla doğrular, rapor üretir ve her şeyi siler. ASLA çalışan bir veritabanına dokunmaz:
#   - yalnız bu çalıştırmanın yarattığı, benzersiz adlı ağ (yok: --network none), birim ve konteynırlar kullanılır;
#   - mevcut hiçbir adlandırılmış birim, ağ veya konteynır bağlanmaz/değiştirilmez;
#   - yedek deposu konteynıra YALNIZ OKUNUR (:ro) bağlanır; geri yüklenen örnek ağsızdır, arşiv kapalıdır.
#   - eda-staging ayaktayken başlamaz (014 KK-014-18).
#   - geçici konteynırlar bellek/CPU sınırlıdır (--memory, --cpus; varsayılan DRILL_MEMORY=1g, DRILL_CPUS=1): küçük
#     sunucuda (pilot, 6 GB) canlı yığının belleğini tüketmez; swap kullanmaz (memory-swap = memory).
#   - depo dizininin grubu (pilotta backup uid/gid 10007, 0750) konteynıra ek grup olarak verilir; salt okunur okuma.
#
# Kullanım:
#   restore-drill.sh --repo-dir <pgBackRest repo dizini> [--cipher-pass-file <dosya>] [--report <dosya|->]
#       [--image <postgres imajı>] [--db eda] [--journal <_journal.json>] [--tables auth.users,auth.organizations]
#       [--escrow-file <KEK emaneti> --escrow-pass-file <parola dosyası> [--kek-file <kek_master>]]
#       [--memory <sınır, örn. 1g>] [--cpus <çekirdek>]
#   Zorunlu ortam değişkeni yok. EDA_IMAGE_PREFIX/EDA_TAG imaj adını belirler (varsayılan eda/postgres:dev).
#
# Rapor (içeriksiz): tarih, sonuç, süreler, doğrulamalar, tablo SAYILARI. Sır, yol ve veri içeriği yazılmaz.
# Çıkış kodları: 0 tüm doğrulamalar geçti ve temizlik tamam; 1 doğrulama/geri yükleme/temizlik başarısız; 2 kullanım.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REPO_DIR="" CIPHER_PASS_FILE="" REPORT="-" DB="eda" TABLES="auth.users,auth.organizations"
IMAGE="${EDA_IMAGE_PREFIX:-eda}/postgres:${EDA_TAG:-dev}"
JOURNAL="$ROOT/packages/db/migrations/meta/_journal.json"
ESCROW_FILE="" ESCROW_PASS_FILE="" KEK_FILE=""
MEMORY="${DRILL_MEMORY:-1g}"
CPUS="${DRILL_CPUS:-1}"
START_TIMEOUT="${DRILL_START_TIMEOUT:-600}"
RESTORE_TIMEOUT="${DRILL_RESTORE_TIMEOUT:-3600}"
STANZA="${PGBACKREST_STANZA:-eda}"
PG_UID=999 # postgres imajındaki kullanıcı
PGDATA_PATH="/var/lib/postgresql/18/docker"

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" >&2; exit 2; }
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir) REPO_DIR="${2:-}"; shift 2 ;;
    --cipher-pass-file) CIPHER_PASS_FILE="${2:-}"; shift 2 ;;
    --report) REPORT="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --db) DB="${2:-}"; shift 2 ;;
    --journal) JOURNAL="${2:-}"; shift 2 ;;
    --tables) TABLES="${2:-}"; shift 2 ;;
    --escrow-file) ESCROW_FILE="${2:-}"; shift 2 ;;
    --escrow-pass-file) ESCROW_PASS_FILE="${2:-}"; shift 2 ;;
    --kek-file) KEK_FILE="${2:-}"; shift 2 ;;
    --memory) MEMORY="${2:-}"; shift 2 ;;
    --cpus) CPUS="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$REPO_DIR" ]] || usage
[[ -d "$REPO_DIR" ]] || { log "HATA: --repo-dir bir dizin değil"; exit 2; }
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
[[ "$DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { log "HATA: --db geçersiz"; exit 2; }
IFS=',' read -ra TABLE_LIST <<<"$TABLES"
for t in "${TABLE_LIST[@]}"; do
  [[ "$t" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$ ]] || { log "HATA: --tables geçersiz tablo adı"; exit 2; }
done
[[ "$MEMORY" =~ ^[1-9][0-9]*[mg]$ ]] || { log "HATA: --memory geçersiz (örn. 768m, 1g)"; exit 2; }
[[ "$CPUS" =~ ^[0-9]+(\.[0-9]+)?$ && "$CPUS" != 0 ]] || { log "HATA: --cpus geçersiz"; exit 2; }
if [[ -n "$ESCROW_FILE" ]]; then
  [[ -n "$ESCROW_PASS_FILE" ]] || { log "HATA: --escrow-file için --escrow-pass-file gerekli"; exit 2; }
fi

command -v docker >/dev/null 2>&1 || { log "HATA: docker bulunamadı"; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { log "HATA: imaj yerelde yok: $IMAGE"; exit 1; }
if [[ -n "$(docker ps -q --filter label=com.docker.compose.project=eda-staging 2>/dev/null)" ]]; then
  log "HATA: eda-staging ayakta; tatbikat başlamaz (014 KK-014-18)"
  exit 1
fi

# --------------------------------------------------------------------------- kaynaklar (yalnız bu çalıştırmanın)
ID="$(date -u +%Y%m%d%H%M%S)-$RANDOM$RANDOM"
VOL="eda-drill-pgdata-$ID"
PGC="eda-drill-pg-$ID"
WORK=""
CREATED_VOL=0
CREATED_PGC=0
CLEAN_OK=1
RESULT="fail"
RESTORE_S=0 START_S=0 VERIFY_S=0
declare -a VALS=()   # JSON parçaları
TABLE_JSON="" LEDGER_JSON="null" KEK_JSON="null"

# Yedek parolası ve geçici ayarlar tmpfs'te (yoksa uyarıyla TMPDIR) tutulur ve sonunda silinir.
if [[ -d /dev/shm && -w /dev/shm ]]; then WORK="$(mktemp -d -p /dev/shm eda-drill.XXXXXX)"; else
  log "UYARI: /dev/shm yok; geçici dosyalar disk üzerinde (sonunda silinir)"
  WORK="$(mktemp -d eda-drill.XXXXXX)"
fi
chmod 0755 "$WORK"
mkdir -m 0755 "$WORK/conf"

cleanup() {
  local rc=$?
  set +e
  if [[ "$CREATED_PGC" -eq 1 ]]; then
    docker rm -fv "$PGC" >/dev/null 2>&1 || CLEAN_OK=0
  fi
  if [[ "$CREATED_VOL" -eq 1 ]]; then
    docker volume rm -f "$VOL" >/dev/null 2>&1 || CLEAN_OK=0
  fi
  rm -rf "$WORK" || CLEAN_OK=0
  if [[ "$CLEAN_OK" -ne 1 ]]; then
    log "HATA: temizlik tamamlanamadı (bulgu P1, 073 §12.5): kalan kaynak adı ${VOL}"
    RESULT="fail"
    [[ $rc -eq 0 ]] && rc=1
  fi
  write_report
  exit "$rc"
}

val() { # $1 id, $2 ok(true|false), $3 not
  VALS+=("{\"id\":\"$1\",\"ok\":$2,\"notes\":\"$3\"}")
}

write_report() {
  local json vals_joined="" v
  for v in "${VALS[@]:-}"; do [[ -n "$v" ]] && vals_joined+="${vals_joined:+,}$v"; done
  json="$(printf '{"v":1,"date":"%s","type":"restore-drill","result":"%s","phases":{"restoreSeconds":%d,"startSeconds":%d,"verifySeconds":%d},"rtoRestoreSeconds":%d,"ledger":%s,"tableCounts":{%s},"kekEscrow":%s,"cleanup":%s,"validations":[%s]}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RESULT" "$RESTORE_S" "$START_S" "$VERIFY_S" "$((RESTORE_S + START_S + VERIFY_S))" \
    "$LEDGER_JSON" "$TABLE_JSON" "$KEK_JSON" "$([[ "$CLEAN_OK" -eq 1 ]] && echo true || echo false)" "$vals_joined")"
  if [[ "$REPORT" == "-" ]]; then printf '%s' "$json"; else printf '%s' "$json" >"$REPORT"; fi
}
trap cleanup EXIT

psql_q() { # $1 SQL -> stdout (yalnız sayı/metaveri sorguları)
  docker exec "$PGC" psql -h /var/run/postgresql -U postgres -d "$DB" -Atq -v ON_ERROR_STOP=1 -c "$1"
}

# Depo dizininin grubu ek grup olarak verilir (pilot: backup 10007:10007 0750; postgres uid 999 aksi hâlde okuyamaz).
REPO_GID="$(stat -c '%g' "$REPO_DIR")"
LIMITS=(--memory "$MEMORY" --memory-swap "$MEMORY" --cpus "$CPUS" --pids-limit 512)
HARDEN=(--cap-drop ALL --security-opt no-new-privileges --network none --user "$PG_UID:$PG_UID" --group-add "$REPO_GID"
  "${LIMITS[@]}")

# --------------------------------------------------------------------------- yapılandırma
{
  echo "[global]"
  if [[ -n "$CIPHER_PASS_FILE" ]]; then
    [[ -r "$CIPHER_PASS_FILE" ]] || { log "HATA: --cipher-pass-file okunamıyor"; exit 1; }
    printf 'repo1-cipher-pass=%s\n' "$(head -n1 "$CIPHER_PASS_FILE")"
  fi
} >"$WORK/conf/secret.conf"
chmod 0644 "$WORK/conf/secret.conf" # konteynır içi uid 999 okur; dizin tmpfs ve çıkışta silinir
printf 'local all all trust\n' >"$WORK/pg_hba.conf"
chmod 0644 "$WORK/pg_hba.conf"
PGB_CONF=(--config=/etc/pgbackrest/pgbackrest-restore.conf --config-include-path=/drill-conf)
RESTORE_CMD="pgbackrest --config=/etc/pgbackrest/pgbackrest-restore.conf --config-include-path=/drill-conf --stanza=$STANZA archive-get %f \"%p\""

# --------------------------------------------------------------------------- 1) geri yükleme
log "geçici birim hazırlanıyor: $VOL"
docker volume create "$VOL" >/dev/null
CREATED_VOL=1
docker run --rm --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER --network none "${LIMITS[@]}" --entrypoint sh -v "$VOL":"$PGDATA_PATH" "$IMAGE" \
  -c "chown $PG_UID:$PG_UID '$PGDATA_PATH' && chmod 0700 '$PGDATA_PATH'"

t0=$SECONDS
log "pgBackRest restore başlıyor (salt-okunur depo, ağsız konteynır)"
if timeout "$RESTORE_TIMEOUT" docker run --rm "${HARDEN[@]}" --read-only --tmpfs "/tmp:size=256m,uid=$PG_UID,gid=$PG_UID" \
  -v "$REPO_DIR":/var/lib/pgbackrest:ro -v "$VOL":"$PGDATA_PATH" -v "$WORK/conf":/drill-conf:ro \
  --entrypoint sh "$IMAGE" -c 'mkdir -p /tmp/pgbackrest/log /tmp/pgbackrest/lock && exec pgbackrest "$@"' sh \
  "${PGB_CONF[@]}" --stanza="$STANZA" --type=default --recovery-option="restore_command=$RESTORE_CMD" restore >&2; then
  RESTORE_S=$((SECONDS - t0))
  val restore true "pgbackrest restore tamam"
else
  RESTORE_S=$((SECONDS - t0))
  val restore false "pgbackrest restore basarisiz"
  log "HATA: geri yükleme başarısız (depo okunamıyor, parola yanlış veya yedek yok olabilir)"
  exit 1
fi

# --------------------------------------------------------------------------- 2) geçici örneği başlat
t0=$SECONDS
docker run -d --name "$PGC" "${HARDEN[@]}" --read-only --shm-size 256m \
  --tmpfs "/tmp:size=256m,uid=$PG_UID,gid=$PG_UID" --tmpfs "/var/run/postgresql:size=1m,uid=$PG_UID,gid=$PG_UID" \
  -v "$REPO_DIR":/var/lib/pgbackrest:ro -v "$VOL":"$PGDATA_PATH" -v "$WORK/conf":/drill-conf:ro \
  -v "$WORK/pg_hba.conf":/drill/pg_hba.conf:ro \
  --entrypoint sh "$IMAGE" -c 'mkdir -p /tmp/pgbackrest/log /tmp/pgbackrest/lock && exec postgres "$@"' sh \
  -D "$PGDATA_PATH" -c config_file=/etc/postgresql/postgresql.conf -c hba_file=/drill/pg_hba.conf \
  -c listen_addresses= -c archive_mode=off -c hot_standby=off >/dev/null
CREATED_PGC=1

ready=0
for ((i = 0; i < START_TIMEOUT; i++)); do
  if [[ "$(docker inspect -f '{{.State.Running}}' "$PGC" 2>/dev/null)" != true ]]; then break; fi
  if docker exec "$PGC" pg_isready -h /var/run/postgresql -q 2>/dev/null; then ready=1; break; fi
  sleep 1
done
START_S=$((SECONDS - t0))
if [[ "$ready" -ne 1 ]]; then
  val start false "gecici ornek acilmadi"
  log "HATA: geçici örnek açılmadı; son günlük satırları:"
  docker logs --tail 15 "$PGC" >&2 2>&1 || true
  exit 1
fi
val start true "gecici ornek acildi"

# --------------------------------------------------------------------------- 3) doğrulama
t0=$SECONDS
FAILED=0

if [[ "$(psql_q 'SELECT pg_is_in_recovery()')" == f ]]; then val recovery true "kurtarma bitti, ornek yazilabilir"; else val recovery false "ornek hala kurtarmada"; FAILED=1; fi

# migrate defteri (public.schema_migrations) <-> depodaki migrasyon sayısı
EXPECTED=0
[[ -r "$JOURNAL" ]] && EXPECTED="$(grep -o '"idx"' "$JOURNAL" | wc -l | tr -d ' ')"
if [[ "$(psql_q "SELECT to_regclass('public.schema_migrations') IS NOT NULL")" == t ]]; then
  read -r ACTUAL MINSEQ MAXSEQ < <(psql_q "SELECT count(*), coalesce(min(seq),0), coalesce(max(seq),0) FROM public.schema_migrations" | tr '|' ' ')
  contiguous=false
  [[ "$ACTUAL" -gt 0 && $((MAXSEQ - MINSEQ + 1)) -eq "$ACTUAL" ]] && contiguous=true
  BEHIND=$((EXPECTED - ACTUAL))
  LEDGER_JSON="$(printf '{"expected":%d,"actual":%d,"contiguous":%s,"behindBy":%d}' "$EXPECTED" "$ACTUAL" "$contiguous" "$BEHIND")"
  if [[ "$contiguous" == true && "$ACTUAL" -le "$EXPECTED" ]]; then
    val ledger true "migrate defteri tutarli"
  else
    val ledger false "migrate defteri bos, kesintili veya depodan ileride"
    FAILED=1
  fi
else
  val ledger false "public.schema_migrations yok"
  FAILED=1
fi

# tablo sayıları (yalnız sayı; satır içeriği okunmaz)
TABLE_JSON=""
for t in "${TABLE_LIST[@]}"; do
  if [[ "$(psql_q "SELECT to_regclass('$t') IS NOT NULL")" == t ]]; then
    n="$(psql_q "SELECT count(*) FROM $t")"
  else
    n=null
  fi
  TABLE_JSON+="${TABLE_JSON:+,}\"$t\":$n"
done
val tables true "tablo sayilari okundu"

# KEK emaneti (isteğe bağlı): emanet çözülür, KCV doğrulanır (073 §12.4 #5, kısmi)
if [[ -n "$ESCROW_FILE" ]]; then
  kek_args=(verify --escrow "$ESCROW_FILE" --pass-file "$ESCROW_PASS_FILE")
  [[ -n "$KEK_FILE" ]] && kek_args+=(--kek "$KEK_FILE")
  if kek_out="$("$SCRIPT_DIR/kek-escrow.sh" "${kek_args[@]}" 2>/dev/null)"; then
    KEK_JSON="{\"ok\":true,\"kcv\":\"$(printf '%s' "$kek_out" | sed -n 's/.*KCV: \([0-9a-f]*\)).*/\1/p')\"}"
    val kek true "KEK emaneti dogrulandi"
  else
    KEK_JSON='{"ok":false,"kcv":null}'
    val kek false "KEK emaneti dogrulanamadi"
    FAILED=1
  fi
fi
VERIFY_S=$((SECONDS - t0))

[[ "$FAILED" -eq 0 ]] && RESULT="pass"
log "doğrulama sonucu: $RESULT; temizlik yapılıyor"
[[ "$RESULT" == pass ]] || exit 1
