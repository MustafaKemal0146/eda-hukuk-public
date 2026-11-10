-- lint-as: 0016_index_files_case.sql
-- lint-existing: app.files
-- lint-expect: M-16
-- eda:kind index
-- eda:no-transaction
CREATE INDEX CONCURRENTLY files_case_idx ON app.files (org_id, case_id);
