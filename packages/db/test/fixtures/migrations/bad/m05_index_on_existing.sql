-- lint-as: 0005_index_files_org.sql
-- lint-existing: app.files
-- lint-expect: M-05
-- eda:kind index
CREATE INDEX IF NOT EXISTS files_org_idx ON app.files (org_id);
