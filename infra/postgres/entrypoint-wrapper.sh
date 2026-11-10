#!/bin/sh
# infra/postgres/entrypoint-wrapper.sh (070 §10.2, 073 §3)
set -eu
mkdir -p /tmp/pgbackrest/log /tmp/pgbackrest/lock /tmp/pgbackrest/spool
if [ -f /run/secrets/pgbackrest_pg_key ]; then
  cp /run/secrets/pgbackrest_pg_key /tmp/pgbackrest/pgbackrest_pg_key
  chmod 0600 /tmp/pgbackrest/pgbackrest_pg_key
fi

# pgBackRest eda_backup rolüne unix soketiyle bağlanır ve pg_hba bu rol için scram-sha-256 ister. Parola,
# libpq pgpass dosyasından okunur (süreç listesine ve loga düşmez). Dosya yazılabilir tmpfs'te, 0600.
if [ -r /run/secrets/pg_backup_password ]; then
  (
    umask 077
    # pgpass biçimi: ":" ve "\" önüne "\" konur.
    printf '*:*:*:eda_backup:%s\n' "$(sed -e 's/[\\:]/\\&/g' /run/secrets/pg_backup_password | head -n1)" >/tmp/pgbackrest/.pgpass
  )
  chmod 0600 /tmp/pgbackrest/.pgpass
  export PGPASSFILE=/tmp/pgbackrest/.pgpass
fi

pgbackrest server &
exec docker-entrypoint.sh "$@"
