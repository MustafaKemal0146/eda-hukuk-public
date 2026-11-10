-- lint-as: 0011_fn_org_count.sql
-- lint-expect: M-11
-- eda:kind fn
CREATE FUNCTION app.org_count() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT count(*) FROM auth.organizations $$;
