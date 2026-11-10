-- 020-role-settings.sql — rol düzeyi zaman aşımları ve search_path (031 §2.5, 002 §9).
-- eda_owner kendi sahibi olmadığı rolleri değiştiremeyeceği için initdb'de süper kullanıcıyla koşar.
-- Değerler CI'da defaults.ts ile karşılaştırılır (KK-031-14).
\set ON_ERROR_STOP on

-- Uygulama rolleri: 15s / 10s / 2s
ALTER ROLE eda_app            IN DATABASE eda SET statement_timeout = '15s';
ALTER ROLE eda_app            IN DATABASE eda SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE eda_app            IN DATABASE eda SET lock_timeout = '2s';
ALTER ROLE eda_app            IN DATABASE eda SET search_path = app, public;

ALTER ROLE eda_worker         IN DATABASE eda SET statement_timeout = '15s';
ALTER ROLE eda_worker         IN DATABASE eda SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE eda_worker         IN DATABASE eda SET lock_timeout = '2s';
ALTER ROLE eda_worker         IN DATABASE eda SET search_path = app, public;

ALTER ROLE eda_auth           IN DATABASE eda SET statement_timeout = '15s';
ALTER ROLE eda_auth           IN DATABASE eda SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE eda_auth           IN DATABASE eda SET lock_timeout = '2s';
ALTER ROLE eda_auth           IN DATABASE eda SET search_path = auth, public;

ALTER ROLE eda_readonly_admin IN DATABASE eda SET statement_timeout = '15s';
ALTER ROLE eda_readonly_admin IN DATABASE eda SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE eda_readonly_admin IN DATABASE eda SET lock_timeout = '2s';
ALTER ROLE eda_readonly_admin IN DATABASE eda SET search_path = app, public;

-- Zamanlanmış işler: uzun statement_timeout
ALTER ROLE eda_jobs           IN DATABASE eda SET statement_timeout = '300s';
ALTER ROLE eda_jobs           IN DATABASE eda SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE eda_jobs           IN DATABASE eda SET lock_timeout = '2s';
ALTER ROLE eda_jobs           IN DATABASE eda SET search_path = app, public;

-- Migrasyon sahibi: statement_timeout ve lock_timeout dosya başında SET LOCAL ile (032)
ALTER ROLE eda_owner          IN DATABASE eda SET statement_timeout = '0';
ALTER ROLE eda_owner          IN DATABASE eda SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE eda_owner          IN DATABASE eda SET search_path = public;

-- Gözlem
ALTER ROLE eda_monitor        IN DATABASE eda SET statement_timeout = '5s';
ALTER ROLE eda_monitor        IN DATABASE eda SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE eda_monitor        IN DATABASE eda SET lock_timeout = '2s';
ALTER ROLE eda_monitor        IN DATABASE eda SET search_path = public;

-- eda_backup: değerleri 073 belirler (P33 doğrulaması); burada ayar yok.
