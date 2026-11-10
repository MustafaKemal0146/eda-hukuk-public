-- 050-schemas.sql — uygulama şemaları ve yedek rolü yetkileri (030/031, 073 §4.1).
-- Şema içi nesneler ve şema yetkileri ilk migrasyonda (P03a, 031 §2.3) eda_owner ile kurulur.
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth   AUTHORIZATION eda_owner;   -- Better Auth tabloları, RLS yok
CREATE SCHEMA IF NOT EXISTS app    AUTHORIZATION eda_owner;   -- uygulama verisi, RLS
CREATE SCHEMA IF NOT EXISTS corpus AUTHORIZATION eda_owner;   -- kamu korpusu, kiracısız

-- eda_backup: süper kullanıcısız pgBackRest için asgari yetkiler (073 §4.1; pg_monitor DEĞİL).
-- Ek yetki gerekirse P33'te `pgbackrest check` ile doğrulanıp 002 §9 güncellenir.
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_start(text, boolean),
                          pg_catalog.pg_backup_stop(boolean),
                          pg_catalog.pg_switch_wal(),
                          pg_catalog.pg_create_restore_point(text) TO eda_backup;
GRANT pg_read_all_settings TO eda_backup;
