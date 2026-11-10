-- eda:kind schema
-- L0 (032 §2.1; 031 §2.3): şemalar, PUBLIC yetkilerinin geri alınması, şema kullanım yetkileri ve
-- DEFAULT PRIVILEGES. Şemalar initdb 050-schemas.sql'de de kurulur; burada IF NOT EXISTS ile doğrulanır.
-- app şemasında DEFAULT PRIVILEGES BİLİNÇLİ OLARAK YOK (031 §2.4): app tablolarında yetki yalnız RLS'yi
-- kuran rls migrasyonunda açık GRANT ile verilir.
CREATE SCHEMA IF NOT EXISTS auth   AUTHORIZATION eda_owner;
CREATE SCHEMA IF NOT EXISTS app    AUTHORIZATION eda_owner;
CREATE SCHEMA IF NOT EXISTS corpus AUTHORIZATION eda_owner;
REVOKE ALL ON SCHEMA auth, app, corpus FROM PUBLIC;

GRANT USAGE ON SCHEMA auth   TO eda_auth, eda_app, eda_worker, eda_jobs, eda_rls_helper, eda_sec_definer;
GRANT USAGE ON SCHEMA app    TO eda_app, eda_worker, eda_jobs, eda_readonly_admin, eda_rls_helper, eda_sec_definer;
GRANT USAGE ON SCHEMA corpus TO eda_app, eda_worker;
-- ALTER FUNCTION ... OWNER TO için yeni sahibin şemada CREATE yetkisi olmalıdır (031 §5.3).
GRANT CREATE ON SCHEMA app TO eda_rls_helper, eda_sec_definer;

-- DEFAULT PRIVILEGES yalnız RLS'siz şemalarda (031 §2.4).
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eda_auth;
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO eda_auth;
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner IN SCHEMA corpus
  GRANT SELECT ON TABLES TO eda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner IN SCHEMA corpus
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eda_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner IN SCHEMA corpus
  GRANT USAGE, SELECT ON SEQUENCES TO eda_worker;
-- Fonksiyonlar varsayılan olarak PUBLIC'e EXECUTE verir: kapatılır (Q5; 031 Tuzak 6).
ALTER DEFAULT PRIVILEGES FOR ROLE eda_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
