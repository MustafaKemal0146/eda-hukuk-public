-- eda:kind fn
-- L6 (031 §8.2; RLS-21): ilk admin fonksiyonu app.admin_list_orgs. Sahibi eda_sec_definer, EXECUTE
-- yalnız eda_readonly_admin. Dönüş: büro kimliği, adı, türü, oluşturma zamanı + admin_rollup_orgs_daily
-- son gün satırı. İçerik (sohbet, mesaj, belge, evrak, müvekkil, taraf, dava başlığı) DÖNMEZ
-- (KK-031-9). Büro adı kolonu `org_name` olarak döner (AS-0170). Kalan admin_* fonksiyonları P27.
-- Sayfa boyutu api.pageSizeDefault (25) / api.pageSizeMax (100) (002 §7); api Zod ile doğrular.

GRANT SELECT (id, name, kind, created_at) ON auth.organizations TO eda_sec_definer;
GRANT SELECT (day, org_id, plan_code, active_users, seats, storage_bytes, files_count) ON app.admin_rollup_orgs_daily TO eda_sec_definer;

CREATE OR REPLACE FUNCTION app.admin_list_orgs(p_name_prefix text, p_cursor uuid, p_limit integer)
RETURNS TABLE (
  org_id uuid, org_name text, kind text, created_at timestamptz, rollup_day date, plan_code text,
  active_users integer, seats integer, storage_bytes bigint, files_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT o.id, o.name::text, o.kind, o.created_at, r.day, r.plan_code, r.active_users, r.seats,
         r.storage_bytes, r.files_count
  FROM auth.organizations o
  LEFT JOIN LATERAL (
    SELECT d.day, d.plan_code, d.active_users, d.seats, d.storage_bytes, d.files_count
    FROM app.admin_rollup_orgs_daily d
    WHERE d.org_id = o.id
    ORDER BY d.day DESC
    LIMIT 1
  ) r ON true
  WHERE (p_cursor IS NULL OR o.id > p_cursor)
    AND (p_name_prefix IS NULL OR p_name_prefix = ''
         OR pg_catalog.starts_with(o.name::text, p_name_prefix))
  ORDER BY o.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 100)
$$;

REVOKE ALL ON FUNCTION app.admin_list_orgs(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_list_orgs(text, uuid, integer) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_list_orgs(text, uuid, integer) OWNER TO eda_sec_definer;
