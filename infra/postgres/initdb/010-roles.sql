-- 010-roles.sql — veritabanı rolleri (031 §2.2). Yalnız boş pgdata biriminde, postgres süper kullanıcısıyla,
-- POSTGRES_DB=eda oluşturulduktan sonra docker-entrypoint tarafından psql ile koşar.
-- Parolalar psql meta komutuyla sır dosyasından okunur: argv'de yalnız dosya yolu görünür, parola görünmez.
\set ON_ERROR_STOP on

-- Parola içeren ifadeler sunucu günlüğüne düşmesin (yavaş sorgu ve hata ifadesi günlükleri kapatılır).
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
SET password_encryption = 'scram-sha-256';

\set owner_pw   `cat /run/secrets/pg_owner_password`
\set auth_pw    `cat /run/secrets/pg_auth_password`
\set app_pw     `cat /run/secrets/pg_app_password`
\set worker_pw  `cat /run/secrets/pg_worker_password`
\set jobs_pw    `cat /run/secrets/pg_jobs_password`
\set admin_pw   `cat /run/secrets/pg_readonly_admin_password`
\set backup_pw  `cat /run/secrets/pg_backup_password`
\set monitor_pw `cat /run/secrets/pg_monitor_password`

-- 8 LOGIN rol. BYPASSRLS yalnız eda_jobs (LOGIN) ve iki NOLOGIN sahip rolde.
CREATE ROLE eda_owner          LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'owner_pw';
CREATE ROLE eda_auth           LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'auth_pw';
CREATE ROLE eda_app            LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_pw';
CREATE ROLE eda_worker         LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'worker_pw';
CREATE ROLE eda_jobs           LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS   PASSWORD :'jobs_pw';
CREATE ROLE eda_readonly_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'admin_pw';
CREATE ROLE eda_backup         LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_pw';
CREATE ROLE eda_monitor        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'monitor_pw';
-- 2 NOLOGIN sahip rol: RLS yardımcıları ve diğer SECURITY DEFINER fonksiyonlar (031 §5, §8)
CREATE ROLE eda_rls_helper     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
CREATE ROLE eda_sec_definer    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;

-- Parola değişkenleri artık gerekmez.
\unset owner_pw
\unset auth_pw
\unset app_pw
\unset worker_pw
\unset jobs_pw
\unset admin_pw
\unset backup_pw
\unset monitor_pw
RESET log_min_error_statement;
RESET log_min_duration_statement;
RESET log_statement;

-- worker = eda_app + ekler (SET FALSE: eda_worker oturumu eda_app'e SET ROLE yapamaz)
GRANT eda_app TO eda_worker WITH INHERIT TRUE, SET FALSE;
-- migrate fonksiyon sahipliğini devredebilmek için bu rollere SET ROLE yapabilmeli (PG16+); miras YOK
GRANT eda_rls_helper  TO eda_owner WITH INHERIT FALSE, SET TRUE;
GRANT eda_sec_definer TO eda_owner WITH INHERIT FALSE, SET TRUE;
GRANT pg_monitor TO eda_monitor;
-- migrate ön koşul denetimi shared_preload_libraries'ı okuyabilmeli (032 §6.2 madde 4; AS-0079).
GRANT pg_read_all_settings TO eda_owner;

-- Veritabanı sahibi eda_owner (public şemasının sahibi pg_database_owner olduğundan eda_owner'a geçer)
ALTER DATABASE eda OWNER TO eda_owner;
REVOKE ALL ON DATABASE eda FROM PUBLIC;
GRANT CONNECT ON DATABASE eda TO eda_owner, eda_auth, eda_app, eda_worker, eda_jobs,
                                 eda_readonly_admin, eda_backup, eda_monitor;
