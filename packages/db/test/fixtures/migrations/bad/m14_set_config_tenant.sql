-- lint-as: 0014_schema_tenant_bind.sql
-- lint-expect: M-14
-- eda:kind schema
SELECT set_config('app.org_id', '00000000-0000-7000-8000-000000000000', true);
