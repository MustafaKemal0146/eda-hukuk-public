-- eda:kind fn
-- Yönetim paneli "Sistem" modülü: veritabanı sağlığı okuma fonksiyonları. Sahibi eda_sec_definer,
-- EXECUTE yalnız eda_readonly_admin. Aktör `p_actor_id -> platform_role` ile doğrulanır (super_admin,
-- yasaklı değil, askıda değil). Yalnız SAYI ve bayt döner: tablo içeriği, sorgu metni, istemci adresi
-- DÖNMEZ. Tablo yetkisi gerekmez: pg_class ve pg_stat_activity herkese açık katalog görünümleridir,
-- tablo boyutu fonksiyonları nesne yetkisi aramaz (`pg_database_size` arar: kullanılmaz) (bu yüzden manifeste GRANT eklenmez).

-- Veritabanı başına açık bağlantı sayısı (`pg_stat_database`; rol/durum/sorgu alanları yetkisiz rolde
-- gizlidir ve okunmaz) ve sunucu üst sınırı.
CREATE OR REPLACE FUNCTION app.admin_system_connections(p_actor_id uuid)
RETURNS TABLE (connections integer, max_connections integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici sistem durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.numbackends::integer, pg_catalog.current_setting('max_connections')::integer
  FROM pg_catalog.pg_stat_database d
  WHERE d.datname = pg_catalog.current_database();
END
$$;

-- Boyut özeti (tablo ve dizin toplamı; WAL/katalog hariç): kapsam 'database' (tek satır), 'schema'
-- (şema başına toplam) ve 'table' (en büyük 10 tablo). Yalnız bayt ve tahmini satır sayısı; içerik yok. Sistem şemaları dışlanır.
CREATE OR REPLACE FUNCTION app.admin_system_sizes(p_actor_id uuid)
RETURNS TABLE (scope text, ident text, tables integer, total_bytes bigint, index_bytes bigint, est_rows bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici sistem durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH rel AS (
    SELECT n.nspname::text AS sch, c.relname::text AS rel,
           pg_catalog.pg_total_relation_size(c.oid) AS tot,
           pg_catalog.pg_indexes_size(c.oid) AS idx,
           greatest(c.reltuples, 0)::bigint AS est
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'm') AND NOT c.relispartition
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  )
  SELECT 'database'::text, pg_catalog.current_database()::text, pg_catalog.count(*)::integer,
         pg_catalog.sum(r.tot)::bigint, pg_catalog.sum(r.idx)::bigint, pg_catalog.sum(r.est)::bigint
  FROM rel r
  UNION ALL
  SELECT 'schema'::text, r.sch, pg_catalog.count(*)::integer, pg_catalog.sum(r.tot)::bigint,
         pg_catalog.sum(r.idx)::bigint, pg_catalog.sum(r.est)::bigint
  FROM rel r GROUP BY r.sch
  UNION ALL
  (SELECT 'table'::text, r.sch || '.' || r.rel, 1, r.tot, r.idx, r.est
   FROM rel r ORDER BY r.tot DESC, r.rel LIMIT 10);
END
$$;

REVOKE ALL ON FUNCTION app.admin_system_connections(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_system_sizes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_system_connections(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_system_sizes(uuid) TO eda_readonly_admin;
ALTER FUNCTION app.admin_system_connections(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_system_sizes(uuid) OWNER TO eda_sec_definer;
