-- lint-as: 0017_contract_cases_legacy_ref.sql
-- lint-expect: M-17
-- eda:kind contract
-- eda:destructive eski kolon kullanılmıyor
ALTER TABLE app.cases DROP COLUMN legacy_ref;
