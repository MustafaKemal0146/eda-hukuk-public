-- lint-as: 0004_contract_cases_title.sql
-- lint-expect: M-04
-- eda:kind contract
-- eda:contract-of 0003_expand_cases_title_v2
ALTER TABLE app.cases DROP COLUMN title;
