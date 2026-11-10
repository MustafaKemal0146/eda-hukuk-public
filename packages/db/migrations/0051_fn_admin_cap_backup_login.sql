-- eda:kind fn
-- Yönetim paneli güvenlik özellikleri:
-- (1) Platform GENELİ günlük harcama tavanı panelden düzenlenir: app.platform_settings.platform_daily_cap_micro_usd
--     (NULL = yapılandırma zinciri `costGuard.platformDailyCapMicroUsd`; 1-100000 USD arası). Yeni yazma
--     fonksiyonu app.admin_platform_cap_set (yalnız super_admin; denetim aynı işlemde, kapsam platform_ai_cap).
--     Kart ve çalışma-zamanı fonksiyonları yeni kolonu döndürür (dönüş tipi değiştiği için düşürülüp yeniden
--     yaratılır; imza ve yetkiler aynıdır). Kill-switch (`costGuard.killSwitch`) ve rezervasyon fonksiyonu değişmez.
-- (2) app.admin_audit_login_failures: yönetim girişi başarısızlık ve kilitlenme SAYAÇLARI (IP/e-posta/kimlik
--     dönmez). Kaynak: auth.login.failure denetim olayları (metadata.surface = 'admin'); kilitlenme =
--     reason 'backoff' (üstel geri çekilme yanıtı). Olaylar IP başına dakikalık örneklendiğinden sayılar alt sınırdır.
-- Geri alma: yeni fonksiyonlar düşürülür; card/runtime önceki (0049) tanımlarına döndürülür; kolon ve kısıt
-- düşürülür (veri kaybı: panelden girilmiş platform tavanı; yapılandırma zinciri etkilenmez).

ALTER TABLE "app"."platform_settings" ADD COLUMN "platform_daily_cap_micro_usd" bigint;
--> statement-breakpoint
ALTER TABLE "app"."platform_settings" ADD CONSTRAINT "platform_settings_platform_cap_chk" CHECK ("platform_daily_cap_micro_usd" IS NULL OR "platform_daily_cap_micro_usd" BETWEEN 1000000 AND 100000000000) NOT VALID;
--> statement-breakpoint

GRANT SELECT (platform_daily_cap_micro_usd) ON app.platform_settings TO eda_sec_definer;
GRANT UPDATE (platform_daily_cap_micro_usd) ON app.platform_settings TO eda_sec_definer;

DROP FUNCTION app.admin_platform_settings_card(uuid);
DROP FUNCTION app.platform_settings_runtime();

CREATE FUNCTION app.admin_platform_settings_card(p_actor_id uuid)
RETURNS TABLE (
  has_key boolean, key_label text, key_last4 text, key_updated_at timestamptz, fallback_enabled boolean,
  user_turns_per_day integer, user_tokens_per_day bigint, org_daily_cap_micro_usd bigint, updated_at timestamptz,
  platform_daily_cap_micro_usd bigint
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
    RAISE EXCEPTION 'yalnız süper yönetici platform ayarını okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.key_last4 IS NOT NULL, s.key_label, s.key_last4, s.key_verified_at, s.fallback_enabled,
         s.user_turns_per_day, s.user_tokens_per_day, s.org_daily_cap_micro_usd, s.updated_at,
         s.platform_daily_cap_micro_usd
  FROM app.platform_settings s WHERE s.id;
END
$$;

CREATE FUNCTION app.platform_settings_runtime()
RETURNS TABLE (
  key_enc bytea, key_version integer, key_label text, key_last4 text, key_updated_at timestamptz,
  fallback_enabled boolean, user_turns_per_day integer, user_tokens_per_day bigint,
  org_daily_cap_micro_usd bigint, platform_daily_cap_micro_usd bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.key_enc, s.key_version, s.key_label, s.key_last4, s.key_verified_at, s.fallback_enabled,
         s.user_turns_per_day, s.user_tokens_per_day, s.org_daily_cap_micro_usd,
         s.platform_daily_cap_micro_usd
  FROM app.platform_settings s WHERE s.id;
$$;

-- Platform geneli günlük harcama tavanı (mikro-USD); NULL = yapılandırma zinciri. Dönüş: değer değişti mi
-- (değişmediyse denetim yazılmaz).
CREATE FUNCTION app.admin_platform_cap_set(p_actor_id uuid, p_cap bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_old bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici platform tavanını değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF p_cap IS NOT NULL AND p_cap NOT BETWEEN 1000000 AND 100000000000 THEN
    RAISE EXCEPTION 'tavan değeri geçersiz' USING ERRCODE = '22023';
  END IF;
  SELECT s.platform_daily_cap_micro_usd INTO v_old FROM app.platform_settings s WHERE s.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_cap THEN
    RETURN false;
  END IF;
  UPDATE app.platform_settings SET platform_daily_cap_micro_usd = p_cap, updated_by = p_actor_id WHERE id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'platform_settings', 'platform', NULL,
    pg_catalog.jsonb_build_object('scope', 'platform_ai_cap', 'oldValue', v_old, 'newValue', p_cap));
  RETURN true;
END
$$;

-- Yönetim girişi sayaçları (kişisel veri yok): son 24 saat ve 7 gün başarısız deneme, son 24 saat kilitlenme,
-- ayrıca neden başına (kod benzeri) 24 saatlik dağılım. Satır: (scope, key, n); scope = 'total' | 'reason'.
CREATE FUNCTION app.admin_audit_login_failures(p_actor_id uuid)
RETURNS TABLE (scope text, key text, n bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('super_admin', 'support')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel giriş sayaçlarını okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT 'total'::text, 'failures24h'::text,
         pg_catalog.count(*) FILTER (WHERE l.created_at >= pg_catalog.now() - interval '24 hours')
  FROM app.audit_log l
  WHERE l.action = 'auth.login.failure' AND l.created_at >= pg_catalog.now() - interval '7 days'
    AND l.metadata ->> 'surface' = 'admin'
  UNION ALL
  SELECT 'total'::text, 'failures7d'::text, pg_catalog.count(*)
  FROM app.audit_log l
  WHERE l.action = 'auth.login.failure' AND l.created_at >= pg_catalog.now() - interval '7 days'
    AND l.metadata ->> 'surface' = 'admin'
  UNION ALL
  SELECT 'total'::text, 'lockouts24h'::text, pg_catalog.count(*)
  FROM app.audit_log l
  WHERE l.action = 'auth.login.failure' AND l.created_at >= pg_catalog.now() - interval '24 hours'
    AND l.metadata ->> 'surface' = 'admin' AND l.metadata ->> 'reason' = 'backoff'
  UNION ALL
  SELECT 'reason'::text,
         CASE WHEN l.metadata ->> 'reason' ~ '^[A-Za-z0-9_.-]{1,48}$' THEN l.metadata ->> 'reason' ELSE 'other' END,
         pg_catalog.count(*)
  FROM app.audit_log l
  WHERE l.action = 'auth.login.failure' AND l.created_at >= pg_catalog.now() - interval '24 hours'
    AND l.metadata ->> 'surface' = 'admin'
  GROUP BY 2;
END
$$;

REVOKE ALL ON FUNCTION app.admin_platform_settings_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_settings_runtime() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_platform_cap_set(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_audit_login_failures(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_platform_settings_card(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.platform_settings_runtime() TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_platform_cap_set(uuid, bigint) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_audit_login_failures(uuid) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_platform_settings_card(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.platform_settings_runtime() OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_platform_cap_set(uuid, bigint) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_audit_login_failures(uuid) OWNER TO eda_sec_definer;
