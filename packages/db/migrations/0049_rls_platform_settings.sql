-- eda:kind rls
-- Platform ayarı ve yönetimden girilen platform ortak anahtarı (AS-0409; hassas yol: kripto/sır):
-- (1) app.platform_settings: TEK satırlı (id sabit true) tablo + RLS. Şifreli Anthropic anahtarı (key_enc, KEK
--     türevli anahtarla AES-256-GCM; AAD API katmanında), görünen ad, son 4 hane, yumuşak düşüş anahtarı ve
--     platform geneli günlük sınırlar (NULL = yapılandırma zinciri). Uygulama rolleri (eda_app, eda_worker, eda_jobs)
--     tabloya HİÇ erişemez; RLS zorlanır, politika hepsini reddeder.
-- (2) app.admin_platform_* yazma/okuma fonksiyonları: sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin;
--     aktör her çağrıda ilk satırda super_admin olarak doğrulanır; denetim satırı aynı işlemdedir
--     (system_setting.changed; kapsam platform_ai_key|platform_ai_fallback|platform_ai_limits; anahtar, ad ve
--     son 4 hane denetime YAZILMAZ). Kart fonksiyonu şifreli değeri okumaz.
-- (3) app.platform_settings_runtime(): sohbet yolunun ayarları ve şifreli anahtarı okuduğu tek fonksiyon
--     (aktör yok; EXECUTE yalnız eda_readonly_admin; çözme KEK'i tutan API sürecindedir, DB anahtarı çözemez).
-- Geri alma: fonksiyonlar ve tablo düşürülür (veri kaybı: yönetimden girilmiş platform anahtarı ve panel
-- limitleri; sunucu sır dosyası ve yapılandırma zinciri etkilenmez).

CREATE TABLE "app"."platform_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"key_enc" "bytea",
	"key_version" integer,
	"key_label" text,
	"key_last4" text,
	"key_verified_at" timestamp with time zone,
	"fallback_enabled" boolean DEFAULT true NOT NULL,
	"user_turns_per_day" integer,
	"user_tokens_per_day" bigint,
	"org_daily_cap_micro_usd" bigint,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_singleton_chk" CHECK ("id"),
	CONSTRAINT "platform_settings_key_chk" CHECK (("key_enc" IS NULL) = ("key_last4" IS NULL) AND ("key_enc" IS NULL) = ("key_version" IS NULL) AND ("key_enc" IS NULL) = ("key_label" IS NULL) AND ("key_enc" IS NULL) = ("key_verified_at" IS NULL)),
	CONSTRAINT "platform_settings_label_chk" CHECK ("key_label" IS NULL OR (char_length("key_label") BETWEEN 3 AND 60 AND "key_label" !~ '[[:cntrl:]<>]')),
	CONSTRAINT "platform_settings_limits_chk" CHECK (("user_turns_per_day" IS NULL OR "user_turns_per_day" BETWEEN 1 AND 10000) AND ("user_tokens_per_day" IS NULL OR "user_tokens_per_day" BETWEEN 1000 AND 100000000) AND ("org_daily_cap_micro_usd" IS NULL OR "org_daily_cap_micro_usd" BETWEEN 100000 AND 10000000000))
);
--> statement-breakpoint
ALTER TABLE "app"."platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_updated_by_idx" ON "app"."platform_settings" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;
--> statement-breakpoint

-- Tek satır tohumu (RLS açılmadan önce: sahip için izin veren politika yoktur).
INSERT INTO app.platform_settings (id) VALUES (true);

ALTER TABLE app.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_tenant_guard ON app.platform_settings AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (false) WITH CHECK (false);
CREATE TRIGGER platform_settings_set_updated_at BEFORE UPDATE ON app.platform_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
REVOKE ALL ON app.platform_settings FROM PUBLIC, eda_app, eda_worker, eda_jobs;

-- Yalnız fonksiyon sahibi (eda_sec_definer; BYPASSRLS) kolonlara erişir. Şifreli değer yalnız
-- app.platform_settings_runtime() ile okunur; kart ve yönetim fonksiyonları yalnız son 4 haneyi kullanır.
GRANT SELECT (id, key_enc, key_version, key_label, key_last4, key_verified_at, fallback_enabled, user_turns_per_day, user_tokens_per_day, org_daily_cap_micro_usd, updated_at) ON app.platform_settings TO eda_sec_definer;
GRANT UPDATE (key_enc, key_version, key_label, key_last4, key_verified_at, fallback_enabled, user_turns_per_day, user_tokens_per_day, org_daily_cap_micro_usd, updated_by) ON app.platform_settings TO eda_sec_definer;

-- Yönetim kartı (şifreli değer okunmaz). Ad takma adı key_label, son 4 hane key_last4.
CREATE OR REPLACE FUNCTION app.admin_platform_settings_card(p_actor_id uuid)
RETURNS TABLE (
  has_key boolean, key_label text, key_last4 text, key_updated_at timestamptz, fallback_enabled boolean,
  user_turns_per_day integer, user_tokens_per_day bigint, org_daily_cap_micro_usd bigint, updated_at timestamptz
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
         s.user_turns_per_day, s.user_tokens_per_day, s.org_daily_cap_micro_usd, s.updated_at
  FROM app.platform_settings s WHERE s.id;
END
$$;

-- Sohbet yolu: ayarlar ve şifreli anahtar. Aktör yoktur; yalnız eda_readonly_admin havuzu (API süreci) çağırır.
CREATE OR REPLACE FUNCTION app.platform_settings_runtime()
RETURNS TABLE (
  key_enc bytea, key_version integer, key_label text, key_last4 text, key_updated_at timestamptz,
  fallback_enabled boolean, user_turns_per_day integer, user_tokens_per_day bigint,
  org_daily_cap_micro_usd bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.key_enc, s.key_version, s.key_label, s.key_last4, s.key_verified_at, s.fallback_enabled,
         s.user_turns_per_day, s.user_tokens_per_day, s.org_daily_cap_micro_usd
  FROM app.platform_settings s WHERE s.id;
$$;

-- Şifreli platform anahtarını ve adını yazar. Dönüş: önceden tanımlı muydu.
CREATE OR REPLACE FUNCTION app.admin_platform_key_set(
  p_actor_id uuid, p_enc bytea, p_last4 text, p_version integer, p_label text, p_verified_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text;
  v_label text := pg_catalog.btrim(coalesce(p_label, ''));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici platform anahtarı atayabilir' USING ERRCODE = '42501';
  END IF;
  IF p_enc IS NULL OR p_last4 IS NULL OR pg_catalog.length(p_last4) <> 4
     OR p_version IS NULL OR p_version < 1 OR p_verified_at IS NULL
     OR pg_catalog.char_length(v_label) NOT BETWEEN 3 AND 60 OR v_label ~ '[[:cntrl:]<>]' THEN
    RAISE EXCEPTION 'platform anahtarı kaydı geçersiz' USING ERRCODE = '22023';
  END IF;
  SELECT s.key_last4 INTO v_prev FROM app.platform_settings s WHERE s.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  UPDATE app.platform_settings
     SET key_enc = p_enc, key_last4 = p_last4, key_version = p_version, key_label = v_label,
         key_verified_at = p_verified_at, updated_by = p_actor_id
   WHERE id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'platform_settings', 'platform', NULL,
    pg_catalog.jsonb_build_object('scope', 'platform_ai_key', 'change',
      CASE WHEN v_prev IS NULL THEN 'set' ELSE 'replaced' END));
  RETURN v_prev IS NOT NULL;
END
$$;

-- Yalnız adı değiştirir (anahtar yeniden girilmez). Anahtar yoksa P0002.
CREATE OR REPLACE FUNCTION app.admin_platform_key_label_set(p_actor_id uuid, p_label text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev text;
  v_label text := pg_catalog.btrim(coalesce(p_label, ''));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici platform anahtarının adını değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.char_length(v_label) NOT BETWEEN 3 AND 60 OR v_label ~ '[[:cntrl:]<>]' THEN
    RAISE EXCEPTION 'ad geçersiz' USING ERRCODE = '22023';
  END IF;
  SELECT s.key_last4 INTO v_prev FROM app.platform_settings s WHERE s.id FOR UPDATE;
  IF NOT FOUND OR v_prev IS NULL THEN
    RAISE EXCEPTION 'platform anahtarı tanımlı değil' USING ERRCODE = 'P0002';
  END IF;
  UPDATE app.platform_settings SET key_label = v_label, updated_by = p_actor_id WHERE id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'platform_settings', 'platform', NULL,
    pg_catalog.jsonb_build_object('scope', 'platform_ai_key', 'change', 'renamed'));
  RETURN true;
END
$$;

-- Platform anahtarını siler. Dönüş: tanımlı bir anahtar silindi mi (yoksa no-op, denetim yazılmaz).
CREATE OR REPLACE FUNCTION app.admin_platform_key_clear(p_actor_id uuid)
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
    RAISE EXCEPTION 'yalnız süper yönetici platform anahtarını silebilir' USING ERRCODE = '42501';
  END IF;
  SELECT s.key_last4 INTO v_prev FROM app.platform_settings s WHERE s.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_prev IS NULL THEN
    RETURN false;
  END IF;
  UPDATE app.platform_settings
     SET key_enc = NULL, key_last4 = NULL, key_version = NULL, key_label = NULL, key_verified_at = NULL,
         updated_by = p_actor_id
   WHERE id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'platform_settings', 'platform', NULL,
    pg_catalog.jsonb_build_object('scope', 'platform_ai_key', 'change', 'removed'));
  RETURN true;
END
$$;

-- Yumuşak düşüş anahtarı (env bayrağı sert kapı olarak ayrıca geçerlidir).
CREATE OR REPLACE FUNCTION app.admin_platform_fallback_set(p_actor_id uuid, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_prev boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici ortak anahtar düşüşünü değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'değer geçersiz' USING ERRCODE = '22023';
  END IF;
  SELECT s.fallback_enabled INTO v_prev FROM app.platform_settings s WHERE s.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_prev = p_enabled THEN
    RETURN false;
  END IF;
  UPDATE app.platform_settings SET fallback_enabled = p_enabled, updated_by = p_actor_id WHERE id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'platform_settings', 'platform', NULL,
    pg_catalog.jsonb_build_object('scope', 'platform_ai_fallback', 'oldValue', v_prev, 'newValue', p_enabled));
  RETURN true;
END
$$;

-- Platform geneli sınırlar: üçü birlikte yazılır, NULL = yapılandırma zinciri (varsayılana dön).
CREATE OR REPLACE FUNCTION app.admin_platform_limits_set(
  p_actor_id uuid, p_turns integer, p_tokens bigint, p_org_cap bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_old record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici platform sınırlarını değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF (p_turns IS NOT NULL AND p_turns NOT BETWEEN 1 AND 10000)
     OR (p_tokens IS NOT NULL AND p_tokens NOT BETWEEN 1000 AND 100000000)
     OR (p_org_cap IS NOT NULL AND p_org_cap NOT BETWEEN 100000 AND 10000000000) THEN
    RAISE EXCEPTION 'sınır değeri geçersiz' USING ERRCODE = '22023';
  END IF;
  SELECT s.user_turns_per_day AS t, s.user_tokens_per_day AS k, s.org_daily_cap_micro_usd AS c
    INTO v_old FROM app.platform_settings s WHERE s.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform ayarı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_old.t IS NOT DISTINCT FROM p_turns AND v_old.k IS NOT DISTINCT FROM p_tokens
     AND v_old.c IS NOT DISTINCT FROM p_org_cap THEN
    RETURN false;
  END IF;
  UPDATE app.platform_settings
     SET user_turns_per_day = p_turns, user_tokens_per_day = p_tokens, org_daily_cap_micro_usd = p_org_cap,
         updated_by = p_actor_id
   WHERE id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'platform_settings', 'platform', NULL,
    pg_catalog.jsonb_build_object('scope', 'platform_ai_limits', 'turns', p_turns, 'tokens', p_tokens,
                                  'orgCapMicroUsd', p_org_cap));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION app.admin_platform_settings_card(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_settings_runtime() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_platform_key_set(uuid, bytea, text, integer, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_platform_key_label_set(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_platform_key_clear(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_platform_fallback_set(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_platform_limits_set(uuid, integer, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_platform_settings_card(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.platform_settings_runtime() TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_platform_key_set(uuid, bytea, text, integer, text, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_platform_key_label_set(uuid, text) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_platform_key_clear(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_platform_fallback_set(uuid, boolean) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_platform_limits_set(uuid, integer, bigint, bigint) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_platform_settings_card(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.platform_settings_runtime() OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_platform_key_set(uuid, bytea, text, integer, text, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_platform_key_label_set(uuid, text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_platform_key_clear(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_platform_fallback_set(uuid, boolean) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_platform_limits_set(uuid, integer, bigint, bigint) OWNER TO eda_sec_definer;
