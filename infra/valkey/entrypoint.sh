#!/bin/sh
# Valkey giriş betiği (014 §3.7): ACL dosyasını sır dosyalarından tmpfs'e (0600) üretir,
# sonra valkey-server'ı başlatır. Parolalar komut satırında görünmez.
# Kullanım (compose command): <yapılandırma dosyası> [valkey-server argümanları...]
set -eu
umask 077

conf="${1:?yapılandırma dosyası gerekli}"
acl=/run/eda/users.acl

secret() {
  value="$(cat "/run/secrets/$1")"
  [ -n "$value" ] || { echo "valkey-entrypoint: /run/secrets/$1 boş" >&2; exit 1; }
  printf '%s' "$value"
}

# Komut listesi başlangıç taslağıdır; BullMQ ve hız sınırı entegrasyon testi P03'te daraltır.
case "$(basename "$conf")" in
  valkey.conf)
    cat >"$acl" <<ACL
user default off
user eda_health on nopass resetkeys resetchannels -@all +ping
user eda_api on >$(secret valkey_api_password) resetchannels ~eda:bull:* ~eda:rl:* ~eda:auth:* ~eda:chat:* ~eda:idem:* ~eda:dl:* %R~eda:ops:* &eda:chat:stop:* +@all -@admin -@dangerous +info +config|get +client|setname
user eda_worker on >$(secret valkey_worker_password) resetchannels ~eda:bull:* ~eda:rl:* ~eda:dl:* +@all -@admin -@dangerous +info +config|get +client|setname
user eda_jobs on >$(secret valkey_jobs_password) resetchannels ~eda:bull:* ~eda:ops:* +@all -@admin -@dangerous +info +config|get +client|setname
ACL
    ;;
  valkey-cache.conf)
    # eda_mcp (P11): anahtar desenleri 002 §18; komutlar yargi-mcp'nin kullandığı en dar küme,
    # services/yargi-mcp/test/integration/valkey-acl.int.test.ts ile kanıtlanır. PING (sağlık), GET
    # (önbellek, eda:cfg:sources), SET (önbellek, NX PX tek uçuş kilidi), EVALSHA/EVAL (kova, kesici,
    # kilit bırakma) ve scriptlerin içinde çağrılan HMGET HSET HINCRBY PEXPIRE GET DEL. İstemci
    # açılışta INFO / CLIENT SETINFO / CLIENT SETNAME göndermez. eda_api / eda_worker kümeleri P12'de
    # (limits.ts, config-publisher.ts) daraltılır.
    cat >"$acl" <<ACL
user default off
user eda_health on nopass resetkeys resetchannels -@all +ping
user eda_api on >$(secret valkey_cache_api_password) resetchannels ~eda:src:* ~eda:sf:* ~eda:brk:* ~eda:tb:org:* ~eda:tb:user:* ~eda:tb:source:* %RW~eda:cfg:* %R~eda:lq:* +@all -@admin -@dangerous +info
user eda_worker on >$(secret valkey_cache_worker_password) resetchannels ~eda:src:* ~eda:sf:* ~eda:brk:* ~eda:tb:org:* ~eda:tb:user:* ~eda:tb:source:* %R~eda:cfg:* %R~eda:lq:* +@all -@admin -@dangerous +info
user eda_mcp on >$(secret valkey_cache_mcp_password) resetkeys resetchannels ~eda:src:* ~eda:sf:* ~eda:brk:* ~eda:tb:source:* ~eda:lq:* %R~eda:cfg:* -@all +ping +get +set +del +evalsha +eval +hmget +hset +hincrby +pexpire
ACL
    ;;
  *)
    echo "valkey-entrypoint: bilinmeyen yapılandırma: $conf" >&2
    exit 1
    ;;
esac
chmod 0600 "$acl"

exec valkey-server "$@"
