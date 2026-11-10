-- eda:kind rls
-- Yönetim paneli "Yapay zekâ anahtar ataması" ve platform ortak anahtarı sınırı (AS-0409):
-- (1) app.platform_key_usage tablosu + RLS (ortak anahtarla yapılan sohbet turlarının sayaç kaydı; içerik YOK;
--     kullanıcı yalnız kendi satırını okur/ekler),
-- (2) app.platform_key_usage_today(): çağıranın (kullanıcı + etkin büro) günlük/aylık ortak anahtar kullanımı
--     ve geçersiz kılmaları (eda_app; tur öncesi kapı),
-- (3) app.admin_ai_key_* / app.admin_ai_platform_card: super_admin'in büro/kullanıcı anahtarını atayıp silmesi.
--     Şifreleme API katmanındadır (mevcut büro DEK'i ve kullanıcı anahtarı); bu fonksiyonlar yalnız şifreli
--     değeri yazar ve ASLA geri okumaz (enc sütununa SELECT yetkisi verilmez). Denetim satırı aynı işlemdedir:
--     system_setting.changed, kapsam ai_key; anahtar değeri ve son 4 hane denetime yazılmaz.
-- Sahibi eda_sec_definer; yönetim fonksiyonlarının EXECUTE'u yalnız eda_readonly_admin'e, kapı fonksiyonunun
-- yalnız eda_app'e verilir. Gün/ay sınırı Europe/Istanbul. Aktör her çağrıda super_admin olarak doğrulanır.
-- Geri alma: fonksiyonlar ve tablo düşürülür (veri kaybı: yalnız sayaç kaydı; atanmış anahtarlar org_settings /
-- user_preferences'ta kalır ve BYOK uçlarıyla silinebilir).

CREATE TABLE "app"."platform_key_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"model_alias" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_key_usage_status_chk" CHECK ("status" IN ('success', 'error', 'timeout', 'stopped')),
	CONSTRAINT "platform_key_usage_model_alias_chk" CHECK ("model_alias" IN ('edai-flash', 'edai-pro')),
	CONSTRAINT "platform_key_usage_tokens_chk" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0),
	CONSTRAINT "platform_key_usage_cost_chk" CHECK ("cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX "platform_key_usage_user_idx" ON "app"."platform_key_usage" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_key_usage_org_idx" ON "app"."platform_key_usage" USING btree ("org_id","created_at" DESC NULLS LAST);
--> statement-breakpoint


-- RLS: kullanıcı yalnız kendi satırını okur/ekler; büro bağı zorunludur (ai_usage ile aynı kalıp). UPDATE yok.
ALTER TABLE app.platform_key_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_key_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_key_usage_tenant_guard ON app.platform_key_usage AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY platform_key_usage_select ON app.platform_key_usage FOR SELECT
  USING (platform_key_usage.user_id = (SELECT app.current_user_id()));
CREATE POLICY platform_key_usage_insert ON app.platform_key_usage FOR INSERT
  WITH CHECK (platform_key_usage.user_id = (SELECT app.current_user_id()));
REVOKE ALL ON app.platform_key_usage FROM eda_app, eda_worker;
GRANT SELECT, INSERT ON app.platform_key_usage TO eda_app;
GRANT SELECT (id, org_id) ON app.platform_key_usage TO eda_jobs;
GRANT DELETE ON app.platform_key_usage TO eda_jobs;
GRANT SELECT (org_id, user_id, input_tokens, output_tokens, cost_micro_usd, created_at) ON app.platform_key_usage TO eda_sec_definer;

-- Anahtar sütunlarına yönetim fonksiyonlarının ihtiyacı kadar yetki. Şifreli değere (*_enc) SELECT YOK:
-- "tanımlı mı" son 4 hane sütunundan okunur (CHECK enc ve last4'ü birlikte dolu/boş tutar).
GRANT SELECT (org_id, ai_api_key_last4, ai_api_key_verified_at) ON app.org_settings TO eda_sec_definer;
GRANT UPDATE (ai_api_key_enc, ai_api_key_last4, ai_api_key_version, ai_api_key_verified_at, updated_by) ON app.org_settings TO eda_sec_definer;
GRANT SELECT (user_id, ai_key_source, ai_api_key_last4, ai_api_key_verified_at) ON app.user_preferences TO eda_sec_definer;
GRANT INSERT (user_id) ON app.user_preferences TO eda_sec_definer;
GRANT UPDATE (ai_key_source, ai_api_key_enc, ai_api_key_last4, ai_api_key_version, ai_api_key_verified_at) ON app.user_preferences TO eda_sec_definer;
GRANT SELECT (org_id, wrapped_dek, key_version, kek_version, status) ON app.org_keys TO eda_sec_definer;

-- Büro anahtar durumu listesi (ad takma adı org_label). Arama: ad öneki, tam kimlik veya kısa kimlik.
CREATE OR REPLACE FUNCTION app.admin_ai_key_org_list(p_actor_id uuid, p_query text, p_limit integer)
RETURNS TABLE (org_id uuid, org_label text, org_kind text, key_last4 text, key_set_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_q text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, '')));
  v_like text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici anahtar durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  v_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
  SELECT o.id, o.name::text, o.kind, s.ai_api_key_last4, s.ai_api_key_verified_at
  FROM auth.organizations o
  LEFT JOIN app.org_settings s ON s.org_id = o.id
  WHERE v_q = '' OR pg_catalog.lower(o.name::text) LIKE v_like ESCAPE '\'
        OR o.id::text = v_q OR pg_catalog.right(o.id::text, 8) = v_q
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 50);
END
$$;

-- Kullanıcı anahtar durumu listesi (yalnız 'user' rolü; e-posta takma adı user_email).
CREATE OR REPLACE FUNCTION app.admin_ai_key_user_list(p_actor_id uuid, p_query text, p_limit integer)
RETURNS TABLE (user_id uuid, user_email text, verification_status text, key_source text,
               key_last4 text, key_set_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_q text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_query, '')));
  v_like text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici anahtar durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  v_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
  SELECT u.id, u.email::text, u.verification_status, coalesce(p.ai_key_source, 'org'),
         p.ai_api_key_last4, p.ai_api_key_verified_at
  FROM auth.users u
  LEFT JOIN app.user_preferences p ON p.user_id = u.id
  WHERE u.platform_role = 'user'
    AND (v_q = '' OR u.email LIKE v_like ESCAPE '\' OR u.id::text = v_q OR pg_catalog.right(u.id::text, 8) = v_q)
  ORDER BY u.created_at DESC, u.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 50);
END
$$;

-- Büronun etkin sarılı DEK'i (API KEK ile açıp yeni anahtarı şifreler). Sarılı değer tek başına işe yaramaz.
CREATE OR REPLACE FUNCTION app.admin_ai_key_org_dek(p_actor_id uuid, p_org_id uuid)
RETURNS TABLE (wrapped_dek bytea, key_version integer, kek_version integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici büro anahtarı atayabilir' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.organizations o WHERE o.id = p_org_id) THEN
    RAISE EXCEPTION 'büro bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT k.wrapped_dek, k.key_version, k.kek_version
  FROM app.org_keys k
  WHERE k.org_id = p_org_id AND k.status = 'active'
  ORDER BY k.key_version DESC
  LIMIT 1;
END
$$;

-- Şifreli büro anahtarını yazar. Dönüş: önceden tanımlı muydu. Denetim: system_setting.changed / ai_key.
CREATE OR REPLACE FUNCTION app.admin_ai_key_org_set(
  p_actor_id uuid, p_org_id uuid, p_enc bytea, p_last4 text, p_version integer, p_verified_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici büro anahtarı atayabilir' USING ERRCODE = '42501';
  END IF;
  IF p_enc IS NULL OR p_last4 IS NULL OR pg_catalog.length(p_last4) <> 4
     OR p_version IS NULL OR p_version < 1 OR p_verified_at IS NULL THEN
    RAISE EXCEPTION 'anahtar kaydı geçersiz' USING ERRCODE = '22023';
  END IF;
  SELECT s.ai_api_key_last4 INTO v_prev FROM app.org_settings s WHERE s.org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'büro ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  UPDATE app.org_settings
     SET ai_api_key_enc = p_enc, ai_api_key_last4 = p_last4, ai_api_key_version = p_version,
         ai_api_key_verified_at = p_verified_at, updated_by = p_actor_id
   WHERE org_id = p_org_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'org', p_org_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'ai_key', 'target', 'org', 'change', 'set'));
  RETURN v_prev IS NOT NULL;
END
$$;

-- Büro anahtarını siler. Dönüş: tanımlı bir anahtar silindi mi (yoksa no-op, denetim yazılmaz).
CREATE OR REPLACE FUNCTION app.admin_ai_key_org_clear(p_actor_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici büro anahtarını silebilir' USING ERRCODE = '42501';
  END IF;
  SELECT s.ai_api_key_last4 INTO v_prev FROM app.org_settings s WHERE s.org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'büro ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_prev IS NULL THEN
    RETURN false;
  END IF;
  UPDATE app.org_settings
     SET ai_api_key_enc = NULL, ai_api_key_last4 = NULL, ai_api_key_version = NULL,
         ai_api_key_verified_at = NULL, updated_by = p_actor_id
   WHERE org_id = p_org_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'org', p_org_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'ai_key', 'target', 'org', 'change', 'removed'));
  RETURN true;
END
$$;

-- Şifreli kullanıcı anahtarını yazar ve kaynağı 'own' yapar (aksi halde atanan anahtar kullanılmazdı).
CREATE OR REPLACE FUNCTION app.admin_ai_key_user_set(
  p_actor_id uuid, p_user_id uuid, p_enc bytea, p_last4 text, p_version integer, p_verified_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM app.admin_assert_user_actionable(p_actor_id, p_user_id);
  IF p_enc IS NULL OR p_last4 IS NULL OR pg_catalog.length(p_last4) <> 4
     OR p_version IS NULL OR p_version < 1 OR p_verified_at IS NULL THEN
    RAISE EXCEPTION 'anahtar kaydı geçersiz' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.user_preferences (user_id) VALUES (p_user_id) ON CONFLICT DO NOTHING;
  SELECT p.ai_api_key_last4 INTO v_prev FROM app.user_preferences p WHERE p.user_id = p_user_id FOR UPDATE;
  UPDATE app.user_preferences
     SET ai_key_source = 'own', ai_api_key_enc = p_enc, ai_api_key_last4 = p_last4,
         ai_api_key_version = p_version, ai_api_key_verified_at = p_verified_at
   WHERE user_id = p_user_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'user', p_user_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'ai_key', 'target', 'user', 'change', 'set'));
  RETURN v_prev IS NOT NULL;
END
$$;

-- Kullanıcı anahtarını siler ve kaynağı 'org'a döndürür (BYOK removeOwnKey ile aynı sonuç).
CREATE OR REPLACE FUNCTION app.admin_ai_key_user_clear(p_actor_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM app.admin_assert_user_actionable(p_actor_id, p_user_id);
  SELECT p.ai_api_key_last4 INTO v_prev FROM app.user_preferences p WHERE p.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_prev IS NULL THEN
    RETURN false;
  END IF;
  UPDATE app.user_preferences
     SET ai_key_source = 'org', ai_api_key_enc = NULL, ai_api_key_last4 = NULL,
         ai_api_key_version = NULL, ai_api_key_verified_at = NULL
   WHERE user_id = p_user_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'user', p_user_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'ai_key', 'target', 'user', 'change', 'removed'));
  RETURN true;
END
$$;

-- Platform ortak anahtarı kartı: son 24 saat toplulaştırılmış tur, kullanıcı/büro sayısı, token ve maliyet.
CREATE OR REPLACE FUNCTION app.admin_ai_platform_card(p_actor_id uuid)
RETURNS TABLE (turns bigint, users bigint, orgs bigint, tokens bigint, cost_micro_usd bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici platform anahtarı kartını okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint,
         pg_catalog.count(DISTINCT u.user_id)::bigint,
         pg_catalog.count(DISTINCT u.org_id)::bigint,
         coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(u.cost_micro_usd), 0)::bigint
  FROM app.platform_key_usage u
  WHERE u.created_at >= pg_catalog.now() - interval '24 hours';
END
$$;

-- Tur öncesi kapı: çağıranın (oturum bağındaki kullanıcı + büro) ortak anahtar kullanımı ve geçersiz
-- kılmaları. Yalnız kendi kullanımını ve büronun toplam tahmini maliyetini döner; başkasının satırı yok.
CREATE OR REPLACE FUNCTION app.platform_key_usage_today()
RETURNS TABLE (
  user_turns_day bigint, user_tokens_day bigint, user_turns_month bigint, user_tokens_month bigint,
  org_cost_day bigint, org_seats integer,
  ov_turns_day integer, ov_turns_month integer, ov_tokens_day bigint, ov_tokens_month bigint,
  org_cap_floor bigint, org_cap_per_seat bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := app.current_user_id();
  v_org uuid := app.current_org_id();
  v_day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                             AT TIME ZONE 'Europe/Istanbul';
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                               AT TIME ZONE 'Europe/Istanbul';
BEGIN
  -- Ortak anahtar yalnız meslek doğrulaması tamam ve askıda olmayan etkin büro üyesi içindir.
  IF v_uid IS NULL OR v_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM auth.members m JOIN auth.users x ON x.id = m.user_id
       WHERE m.organization_id = v_org AND m.user_id = v_uid AND m.status = 'active'
         AND x.verification_status = 'verified' AND NOT x.banned) THEN
    RAISE EXCEPTION 'ortak anahtar yalnız doğrulanmış büro üyesi içindir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT pg_catalog.count(*) FROM app.platform_key_usage u
      WHERE u.user_id = v_uid AND u.created_at >= v_day_start),
    (SELECT coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint
       FROM app.platform_key_usage u WHERE u.user_id = v_uid AND u.created_at >= v_day_start),
    (SELECT pg_catalog.count(*) FROM app.platform_key_usage u
      WHERE u.user_id = v_uid AND u.created_at >= v_month_start),
    (SELECT coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint
       FROM app.platform_key_usage u WHERE u.user_id = v_uid AND u.created_at >= v_month_start),
    (SELECT coalesce(pg_catalog.sum(u.cost_micro_usd), 0)::bigint
       FROM app.platform_key_usage u WHERE u.org_id = v_org AND u.created_at >= v_day_start),
    (SELECT pg_catalog.count(*)::integer FROM auth.members m
      WHERE m.organization_id = v_org AND m.status = 'active'),
    o.chat_turns_per_day, o.chat_turns_per_month, o.tokens_per_day, o.tokens_per_month,
    (SELECT l.value FROM app.org_limit_overrides l
      WHERE l.org_id = v_org AND l.key = 'costGuard.orgDailyCapFloorMicroUsd'),
    (SELECT l.value FROM app.org_limit_overrides l
      WHERE l.org_id = v_org AND l.key = 'costGuard.orgDailyCapPerSeatMicroUsd')
  FROM (SELECT 1) AS one
  LEFT JOIN app.user_limit_overrides o ON o.user_id = v_uid;
END
$$;

REVOKE ALL ON FUNCTION app.admin_ai_key_org_list(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_key_user_list(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_key_org_dek(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_key_org_set(uuid, uuid, bytea, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_key_org_clear(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_key_user_set(uuid, uuid, bytea, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_key_user_clear(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_platform_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_key_usage_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_org_list(uuid, text, integer) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_user_list(uuid, text, integer) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_org_dek(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_org_set(uuid, uuid, bytea, text, integer, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_org_clear(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_user_set(uuid, uuid, bytea, text, integer, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_key_user_clear(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_platform_card(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.platform_key_usage_today() TO eda_app;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_ai_key_org_list(uuid, text, integer) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_key_user_list(uuid, text, integer) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_key_org_dek(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_key_org_set(uuid, uuid, bytea, text, integer, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_key_org_clear(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_key_user_set(uuid, uuid, bytea, text, integer, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_key_user_clear(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_platform_card(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.platform_key_usage_today() OWNER TO eda_sec_definer;
