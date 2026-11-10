-- lint-as: 0007_expand_deadlines_case_fk.sql
-- lint-existing: app.deadlines
-- lint-expect: M-07
-- eda:kind expand
ALTER TABLE app.deadlines ADD CONSTRAINT deadlines_case_fk
  FOREIGN KEY (org_id, case_id) REFERENCES app.cases (org_id, id);
