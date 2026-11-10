-- lint-as: 0009_rls_cases.sql
-- lint-expect: M-09
-- eda:kind rls
CREATE POLICY cases_select ON app.cases FOR SELECT
  USING (org_id = current_setting('app.org_id', true)::uuid);
