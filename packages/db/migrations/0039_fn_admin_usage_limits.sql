-- eda:kind fn
-- Yönetim paneli "Kullanım ve limitler" modülü (053-ekranlar/11 §3.7; 002 §7 costGuard/files/kvkk/sources
-- büro anahtarları): (1) `app.org_limit_overrides` büro bazlı limit geçersiz kılma tablosu (RLS aynı
-- migrasyonda; yazma yalnız fonksiyonla), (2) kullanım okuma fonksiyonları (gün/model/büro; yalnız sayaç,
-- içerik ve kullanıcı kırılımı YOK), (3) limit okuma/yazma fonksiyonları. Sahibi eda_sec_definer, EXECUTE
-- yalnız eda_readonly_admin; aktör her çağrıda `super_admin` olarak doğrulanır. Gün sınırı Europe/Istanbul,
-- aralık en çok 93 gündür (0037 ile aynı). Değişiklikler `system_setting.changed` denetim satırı yazar
-- (org_id NULL, hedef türü org_limit, hedef kimliği büro; metadata yalnız anahtar ve sayılar).
-- Geri alma: fonksiyonlar ve tablo düşürülür (veri kaybı: yalnız geçersiz kılmalar).

CREATE TABLE "app"."org_limit_overrides" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" bigint NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_limit_overrides_pkey" PRIMARY KEY("org_id","key"),
	CONSTRAINT "org_limit_overrides_key_chk" CHECK ("key" IN ('costGuard.orgDailyCapFloorMicroUsd', 'costGuard.orgDailyCapPerSeatMicroUsd', 'files.orgMaxConcurrentJobs', 'kvkk.searchPerOrgPerHour', 'sources.orgLivePerMin')),
	CONSTRAINT "org_limit_overrides_value_chk" CHECK ("value" >= 1)
);
--> statement-breakpoint
ALTER TABLE "app"."org_limit_overrides" ADD CONSTRAINT "org_limit_overrides_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_limit_overrides" ADD CONSTRAINT "org_limit_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_limit_overrides_updated_by_idx" ON "app"."org_limit_overrides" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;--> statement-breakpoint

-- RLS: büro üyeleri kendi büroları için geçerli sınırı okuyabilir (uygulama katmanı uygular); yazma yok.
ALTER TABLE app.org_limit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.org_limit_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY org_limit_overrides_tenant_guard ON app.org_limit_overrides AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY org_limit_overrides_select ON app.org_limit_overrides FOR SELECT
  USING (app.is_org_member(org_limit_overrides.org_id));
REVOKE ALL ON app.org_limit_overrides FROM eda_app, eda_worker;
GRANT SELECT ON app.org_limit_overrides TO eda_app;
GRANT DELETE ON app.org_limit_overrides TO eda_jobs;
GRANT SELECT (org_id, key) ON app.org_limit_overrides TO eda_jobs;
GRANT SELECT (org_id, key, value, updated_at) ON app.org_limit_overrides TO eda_sec_definer;
GRANT INSERT (org_id, key, value, updated_by) ON app.org_limit_overrides TO eda_sec_definer;
GRANT UPDATE (value, updated_by, updated_at) ON app.org_limit_overrides TO eda_sec_definer;
GRANT DELETE ON app.org_limit_overrides TO eda_sec_definer;
GRANT SELECT (key, value) ON app.system_settings TO eda_sec_definer;

-- Günlük kullanım serisi (platform veya tek büro). Token toplamı = girdi + çıktı; önbellekten okunan
-- girdi ve akıl yürütme jetonları ayrıca verilir (girdi ve çıktının alt kümesidir).
CREATE OR REPLACE FUNCTION app.admin_usage_daily(p_actor_id uuid, p_from date, p_to date, p_org_id uuid)
RETURNS TABLE (
  day date, calls bigint, errors bigint, input_tokens bigint, cached_input_tokens bigint,
  output_tokens bigint, reasoning_tokens bigint, cost_micro_usd bigint, active_orgs integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici kullanım okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH days AS (SELECT g::date AS d FROM pg_catalog.generate_series(p_from, p_to, interval '1 day') g),
  ist AS (SELECT p_from::timestamp AT TIME ZONE 'Europe/Istanbul' AS t0,
                 (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AS t1),
  ai AS (SELECT (a.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                pg_catalog.count(*) AS n,
                pg_catalog.count(*) FILTER (WHERE a.status <> 'success') AS err,
                coalesce(pg_catalog.sum(a.input_tokens), 0)::bigint AS tin,
                coalesce(pg_catalog.sum(a.cached_input_tokens), 0)::bigint AS tcached,
                coalesce(pg_catalog.sum(a.output_tokens), 0)::bigint AS tout,
                coalesce(pg_catalog.sum(a.reasoning_tokens), 0)::bigint AS treason,
                coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint AS cost,
                pg_catalog.count(DISTINCT a.org_id)::integer AS orgs
         FROM app.ai_usage a, ist
         WHERE a.created_at >= ist.t0 AND a.created_at < ist.t1
           AND (p_org_id IS NULL OR a.org_id = p_org_id)
         GROUP BY 1)
  SELECT days.d, coalesce(ai.n, 0), coalesce(ai.err, 0), coalesce(ai.tin, 0), coalesce(ai.tcached, 0),
         coalesce(ai.tout, 0), coalesce(ai.treason, 0), coalesce(ai.cost, 0), coalesce(ai.orgs, 0)
  FROM days LEFT JOIN ai ON ai.d = days.d
  ORDER BY days.d;
END
$$;

-- Model takma adı kırılımı (edai-flash / edai-pro).
CREATE OR REPLACE FUNCTION app.admin_usage_models(p_actor_id uuid, p_from date, p_to date, p_org_id uuid)
RETURNS TABLE (
  model_alias text, calls bigint, errors bigint, input_tokens bigint, output_tokens bigint,
  cost_micro_usd bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_t0 timestamptz := p_from::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_t1 timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici kullanım okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT a.model_alias, pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE a.status <> 'success'),
         coalesce(pg_catalog.sum(a.input_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(a.output_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint
  FROM app.ai_usage a
  WHERE a.created_at >= v_t0 AND a.created_at < v_t1 AND (p_org_id IS NULL OR a.org_id = p_org_id)
  GROUP BY a.model_alias
  ORDER BY 6 DESC, a.model_alias;
END
$$;

-- En çok kullanan bürolar (toplulaştırılmış; kullanıcı kırılımı yok). Sıra: maliyet, çağrı, kimlik.
CREATE OR REPLACE FUNCTION app.admin_usage_top_orgs(p_actor_id uuid, p_from date, p_to date, p_limit integer)
RETURNS TABLE (
  org_id uuid, org_label text, org_kind text, calls bigint, input_tokens bigint, output_tokens bigint,
  cost_micro_usd bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_t0 timestamptz := p_from::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_t1 timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici kullanım okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT u.org_id, o.name::text, o.kind::text, u.calls, u.tin, u.tout, u.cost
  FROM (SELECT a.org_id, pg_catalog.count(*) AS calls,
               coalesce(pg_catalog.sum(a.input_tokens), 0)::bigint AS tin,
               coalesce(pg_catalog.sum(a.output_tokens), 0)::bigint AS tout,
               coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint AS cost
        FROM app.ai_usage a
        WHERE a.created_at >= v_t0 AND a.created_at < v_t1 AND a.org_id IS NOT NULL
        GROUP BY a.org_id) u
  JOIN auth.organizations o ON o.id = u.org_id
  ORDER BY u.cost DESC, u.calls DESC, u.org_id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 10), 1), 10);
END
$$;

-- Platform ayar değerleri (system_settings): yalnız istenen anahtarlar; sır içermeyen sayısal limitler.
CREATE OR REPLACE FUNCTION app.admin_limit_platform_values(p_actor_id uuid, p_keys text[])
RETURNS TABLE (key text, value jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici limitleri okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.key, s.value FROM app.system_settings s WHERE s.key = ANY (coalesce(p_keys, '{}'::text[]))
  ORDER BY s.key;
END
$$;

-- Büro limit geçersiz kılmaları: p_org_id verilirse tek büro, NULL ise tümü (en çok 500 satır).
CREATE OR REPLACE FUNCTION app.admin_org_limits_list(p_actor_id uuid, p_org_id uuid)
RETURNS TABLE (org_id uuid, org_label text, org_kind text, key text, value bigint, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici limitleri okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.org_id, o.name::text, o.kind::text, l.key, l.value, l.updated_at
  FROM app.org_limit_overrides l
  JOIN auth.organizations o ON o.id = l.org_id
  WHERE p_org_id IS NULL OR l.org_id = p_org_id
  ORDER BY o.name, l.org_id, l.key
  LIMIT 500;
END
$$;

-- Büro limitini yazar (varsa günceller); dönüş: önceki değer (yoksa NULL). Denetim satırı aynı işlemdedir.
CREATE OR REPLACE FUNCTION app.admin_org_limit_set(p_actor_id uuid, p_org_id uuid, p_key text, p_value bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici limit değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key NOT IN ('costGuard.orgDailyCapFloorMicroUsd',
       'costGuard.orgDailyCapPerSeatMicroUsd', 'files.orgMaxConcurrentJobs',
       'kvkk.searchPerOrgPerHour', 'sources.orgLivePerMin') THEN
    RAISE EXCEPTION 'limit anahtarı büro bazında değiştirilemez' USING ERRCODE = '22023';
  END IF;
  IF p_value IS NULL OR p_value < 1 THEN
    RAISE EXCEPTION 'limit değeri en az 1 olmalı' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.organizations o WHERE o.id = p_org_id) THEN
    RAISE EXCEPTION 'büro bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  SELECT l.value INTO v_prev FROM app.org_limit_overrides l
  WHERE l.org_id = p_org_id AND l.key = p_key FOR UPDATE;
  IF FOUND THEN
    UPDATE app.org_limit_overrides SET value = p_value, updated_by = p_actor_id, updated_at = pg_catalog.now()
    WHERE org_id = p_org_id AND key = p_key;
  ELSE
    INSERT INTO app.org_limit_overrides (org_id, key, value, updated_by)
    VALUES (p_org_id, p_key, p_value, p_actor_id);
  END IF;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'org_limit', p_org_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'org', 'key', p_key, 'from', v_prev, 'to', p_value));
  RETURN v_prev;
END
$$;

-- Büro geçersiz kılmasını kaldırır (platform varsayılanına dönülür); dönüş: silinen değer (yoksa NULL).
CREATE OR REPLACE FUNCTION app.admin_org_limit_clear(p_actor_id uuid, p_org_id uuid, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici limit değiştirebilir' USING ERRCODE = '42501';
  END IF;
  DELETE FROM app.org_limit_overrides l WHERE l.org_id = p_org_id AND l.key = p_key
  RETURNING l.value INTO v_prev;
  IF v_prev IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'org_limit', p_org_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'org', 'key', p_key, 'from', v_prev, 'to', NULL));
  RETURN v_prev;
END
$$;

REVOKE ALL ON FUNCTION app.admin_usage_daily(uuid, date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_usage_models(uuid, date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_usage_top_orgs(uuid, date, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_limit_platform_values(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_org_limits_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_org_limit_set(uuid, uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_org_limit_clear(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_usage_daily(uuid, date, date, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_usage_models(uuid, date, date, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_usage_top_orgs(uuid, date, date, integer) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_limit_platform_values(uuid, text[]) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_org_limits_list(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_org_limit_set(uuid, uuid, text, bigint) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_org_limit_clear(uuid, uuid, text) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_usage_daily(uuid, date, date, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_usage_models(uuid, date, date, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_usage_top_orgs(uuid, date, date, integer) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_limit_platform_values(uuid, text[]) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_org_limits_list(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_org_limit_set(uuid, uuid, text, bigint) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_org_limit_clear(uuid, uuid, text) OWNER TO eda_sec_definer;
