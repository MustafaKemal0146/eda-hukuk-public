-- 030-extensions.sql — eklentiler (030 §1.1, 002 §9). Süper kullanıcı gerektirir; hepsi public şemasında.
-- Migrasyon (eda_owner) yalnız varlıklarını doğrular.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS vector             SCHEMA public;  -- pgvector >= 0.8.7 (halfvec, HNSW)
CREATE EXTENSION IF NOT EXISTS pg_textsearch      SCHEMA public;  -- BM25; shared_preload_libraries ister
CREATE EXTENSION IF NOT EXISTS pg_trgm            SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent           SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto           SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist         SCHEMA public;  -- uuid/text '=' içeren EXCLUDE kısıtları

-- public'te kimse nesne oluşturamaz (sahip pg_database_owner = eda_owner hariç)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO eda_auth, eda_app, eda_worker, eda_jobs, eda_readonly_admin,
                                eda_rls_helper, eda_sec_definer;
