-- lint-as: 0003_schema_orphan.sql
-- lint-dir: journal-missing
-- lint-expect: M-03
-- eda:kind schema
CREATE TABLE app.orphan (id int);
