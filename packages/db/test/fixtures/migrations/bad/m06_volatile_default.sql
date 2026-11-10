-- lint-as: 0006_expand_cases_ref.sql
-- lint-existing: app.cases
-- lint-expect: M-06
-- eda:kind expand
ALTER TABLE app.cases ADD COLUMN ref uuid NOT NULL DEFAULT uuidv7();
