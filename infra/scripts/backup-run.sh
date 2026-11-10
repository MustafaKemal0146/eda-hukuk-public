#!/bin/bash
# infra/scripts/backup-run.sh (073 §4.4, §7.1, §7.2)
# Kullanım: backup-run.sh <full|incr|status-refresh|drill-ok|drill-failed [<ISO-8601 UTC zaman>]>
#   full | incr: pgbackrest backup -> verify -> off-site `repo` eşitlemesi -> durum dosyası.
#   Her adımın çıkış kodu denetlenir; hiçbir hata yutulmaz. Herhangi bir adım başarısızsa süreç 1 ile çıkar
#   (off-site hedefi development/test'te yapılandırılmamışsa bu hata değil, "disabled" uyarısıdır).
#   status-refresh: durum dosyasını gerçek pgbackrest bilgisi ve adım sonuçlarından yeniden üretir (içerik/sır yok).
#   drill-ok | drill-failed: HOST'ta koşan geri yükleme tatbikatının (pilot-restore-drill.sh) sonucunu `restore-drill`
#     parçasına yazar ve durum dosyasını yeniler (`restoreDrill: {ok, at}`). Zaman verilirse o yazılır (yeniden oynatma).
# Çıkış kodları: 0 başarılı; 1 yedek/doğrulama/off-site hatası veya kilit alınamadı; 2 kullanım.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup-lib.sh
source "$SCRIPT_DIR/backup-lib.sh"

LOCKFILE="${BACKUP_LOCKFILE:-/tmp/pgbackrest/backup-run.lock}"
WWW_DIR="${EDA_WWW_DIR:-/run/eda/www}"
STANZA="${PGBACKREST_STANZA:-eda}"
INFO_TIMEOUT="${BACKUP_INFO_TIMEOUT:-30}"
OFFSITE_SYNC="${OFFSITE_SYNC_BIN:-$SCRIPT_DIR/offsite-sync.sh}"

mkdir -p "$(dirname "$LOCKFILE")" "$WWW_DIR" "$EDA_STATE_DIR"

# --------------------------------------------------------------------------- durum dosyası
part() { # $1 ad -> parça JSON'u ya da {}
  if [[ -s "$EDA_STATE_DIR/$1.json" ]]; then cat "$EDA_STATE_DIR/$1.json"; else echo '{}'; fi
}

refresh_status() {
  local info="" info_ok=false now strict=false cfg=false
  now="$(now_utc)"
  eda_strict_env && strict=true
  offsite_configured && cfg=true
  if info="$(timeout "$INFO_TIMEOUT" pgbackrest --stanza="$STANZA" info --output=json 2>/dev/null)" && [[ -n "$info" ]]; then
    info_ok=true
  else
    info='[]'
  fi

  local tmp
  tmp="$(mktemp "$WWW_DIR/.status.XXXXXX")"
  jq -n \
    --arg now "$now" --arg stanza "$STANZA" \
    --argjson info "$info" --argjson infoOk "$info_ok" \
    --argjson strict "$strict" --argjson cfg "$cfg" \
    --argjson lockDays "${BACKUP_OFFSITE_LOCK_DAYS:-7}" \
    --argjson backup "$(part backup)" --argjson verify "$(part verify)" \
    --argjson owal "$(part offsite-wal)" --argjson orepo "$(part offsite-repo)" \
    --argjson oobj "$(part offsite-obj)" --argjson ocheck "$(part offsite-check)" \
    --argjson drill "$(part restore-drill)" '
    def iso: if . == null then null else (. | todate) end;
    def okat($p): if ($p.state // "") == "ok" then $p.at else null end;
    def chk($p): if ($p | length) == 0 then {ok: null, at: null} else {ok: ($p.state == "ok"), at: $p.at} end;
    ([$info[]? | select(.name == $stanza)] | first // null) as $s
    | ($s.backup // []) as $b
    | ([$b[] | select(.type == "full")] | last // null) as $full
    | ([$b[] | select(.type != "full")] | last // null) as $incr
    | ($s.archive // [] | last // null) as $arch
    | (if $infoOk and $s != null and (($s.status.code // 1) == 0) then "ok" else "error" end) as $stanzaState
    | ( [ (if ($infoOk | not) then "pgbackrest_info_failed" else empty end),
          (if $infoOk and $s == null then "stanza_missing" else empty end),
          (if $infoOk and $s != null and (($s.status.code // 1) != 0) then "stanza_unhealthy" else empty end),
          (if ($backup.state // "") == "failed" then "backup_failed" else empty end),
          (if ($verify.state // "") == "failed" then "verify_failed" else empty end),
          (if ($cfg | not) then "offsite_disabled" else empty end),
          (if $cfg and ([$owal, $orepo, $oobj, $ocheck] | map(.state // "") | any(. == "failed")) then "offsite_failed" else empty end)
        ] ) as $errors
    | ( if $stanzaState == "error" or ($backup.state // "") == "failed" or ($verify.state // "") == "failed" then "error"
        elif $cfg and ($errors | index("offsite_failed")) != null then "error"
        elif ($cfg | not) and $strict then "error"
        elif ($cfg | not) then "degraded"
        else "ok" end ) as $overall
    | {
        v: 1,
        generatedAt: $now,
        overall: $overall,
        pgbackrest: {
          stanza: $stanza,
          status: (if $stanzaState == "ok" and ($backup.state // "") != "failed" and ($verify.state // "") != "failed" then "ok" else "error" end),
          lastFull: (if $full == null then null else {label: $full.label, stoppedAt: ($full.timestamp.stop | iso), repoBytes: ($full.info.repository.size // null)} end),
          lastIncr: (if $incr == null then null else {label: $incr.label, stoppedAt: ($incr.timestamp.stop | iso)} end),
          wal: { minSegment: ($arch.min // null), maxSegment: ($arch.max // null), lastArchivedAt: null },
          lastVerify: ( if ($verify | length) == 0 then {ok: null, at: null, scope: "set=latest"}
                        else {ok: ($verify.state == "ok"), at: $verify.at, scope: "set=latest"} end ),
          archiveFailures24h: null
        },
        lastRun: ( if ($backup | length) == 0 then null
                   else {state: $backup.state, exitCode: $backup.exitCode, at: $backup.at, durationSeconds: $backup.durationSeconds} end ),
        offsite: {
          status: (if ($cfg | not) then "disabled"
                   elif ([$owal, $orepo, $oobj] | map(.state // "") | any(. == "failed")) then "failed"
                   elif ([$owal, $orepo, $oobj] | map(.state // "") | any(. == "ok")) then "ok"
                   else "unknown" end),
          pg:  { lastSnapshotAt: okat($orepo), lastWalSyncAt: okat($owal), lastCheck: chk($ocheck) },
          obj: { lastSnapshotAt: okat($oobj), lastCheck: chk($ocheck) },
          lockDaysConfigured: $lockDays
        },
        restoreDrill: (if ($drill | length) == 0 then null else {ok: ($drill.state == "ok"), at: $drill.at} end),
        errors: $errors
      }' >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$WWW_DIR/status.json"
}

# --------------------------------------------------------------------------- yedek
latest_label() { # son yedek etiketi (stdout); bulunamazsa 1
  local label
  label="$(timeout "$INFO_TIMEOUT" pgbackrest --stanza="$STANZA" info --output=json 2>/dev/null |
    jq -r --arg s "$STANZA" '[.[]? | select(.name == $s) | .backup[]?] | last | .label // empty')" || return 1
  [[ -n "$label" ]] || return 1
  printf '%s\n' "$label"
}

verify_backup() { # $1 tür
  if [[ "$1" == full ]]; then
    # Tam yedekten sonra tüm depo doğrulanır (073 §4.4).
    pgbackrest --stanza="$STANZA" verify
  else
    local label
    label="$(latest_label)" || { log "HATA: doğrulanacak yedek etiketi okunamadı"; return 1; }
    pgbackrest --stanza="$STANZA" verify --set="$label"
  fi
}

run_backup() { # $1 full|incr
  local type="$1" failed=0 rc
  exec 200>"$LOCKFILE"
  flock -n 200 || { echo "Başka bir yedek süreci çalışıyor" >&2; exit 1; }

  if run_step backup pgbackrest --stanza="$STANZA" --type="$type" backup; then
    run_step verify verify_backup "$type" || { log "HATA: pgbackrest verify başarısız"; failed=1; }
    rc=0
    # offsite-sync kendi 'offsite-repo' durum parçasını yazar; burada yalnız çıkış kararı verilir.
    "$OFFSITE_SYNC" repo || rc=$?
    case "$rc" in
      0) ;;
      "$EX_OFFSITE_DISABLED") log "UYARI: off-site kopya alınmadı (offsite=disabled)" ;;
      *) log "HATA: off-site eşitleme başarısız (çıkış ${rc})"; failed=1 ;;
    esac
  else
    log "HATA: pgbackrest backup başarısız"
    failed=1
  fi

  refresh_status
  [[ "$failed" -eq 0 ]] || exit 1
}

# Tatbikat sonucu: yalnız durum kodu ve zaman (rapor içeriği, yol, sayı yazılmaz).
record_drill() { # $1 ok|failed, $2 isteğe bağlı zaman
  local at="${2:-$(now_utc)}" tmp
  [[ "$at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || { echo "Geçersiz zaman: ISO-8601 UTC bekleniyor" >&2; exit 2; }
  mkdir -p "$EDA_STATE_DIR"
  tmp="$(mktemp "$EDA_STATE_DIR/.restore-drill.XXXXXX")"
  printf '{"name":"restore-drill","state":"%s","exitCode":%d,"at":"%s","durationSeconds":0}\n' \
    "$1" "$([[ "$1" == ok ]] && echo 0 || echo 1)" "$at" >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$EDA_STATE_DIR/restore-drill.json"
  refresh_status
}

ACTION="${1:-status-refresh}"
case "$ACTION" in
  full | incr) run_backup "$ACTION" ;;
  status-refresh) refresh_status ;;
  drill-ok) record_drill ok "${2:-}" ;;
  drill-failed) record_drill failed "${2:-}" ;;
  *)
    echo "Kullanım: $0 <full|incr|status-refresh|drill-ok|drill-failed [zaman]>" >&2
    exit 2
    ;;
esac
