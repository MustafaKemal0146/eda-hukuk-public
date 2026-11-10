-- lint-as: 0018_schema_big_table.sql
-- lint-expect: M-18
-- eda:kind schema
-- eda:statement-timeout 2h
CREATE TABLE app.big_table (id int);
