-- eda:kind rls
-- Yönetim paneli "Kullanıcılar ve kullanıcı limitleri" (053-ekranlar/11 §3.4; kullanıcı bazlı limit):
-- (1) app.user_limit_overrides tablosu + RLS (kullanıcı kapsamlı; kişi yalnız kendi satırını okur),
-- (2) app.admin_* okuma/yazma fonksiyonları (sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin).
-- Okuma fonksiyonları personele (support, super_admin), yazma fonksiyonları yalnız super_admin'e açıktır.
-- Yalnız kimlik, e-posta (takma ad user_email), durum ve SAYAÇ döner; sohbet/belge/dosya içeriği DÖNMEZ.
-- Personel hesapları (platform_role <> 'user') üzerinde eylem yoktur. Gün/ay sınırı Europe/Istanbul'dur.
-- Geri alma: fonksiyonları ve tabloyu düşürmek (tablo yeni; veri kaybı yalnız limit geçersiz kılmalarıdır).

CREATE TABLE "app"."user_limit_overrides" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_turns_per_day" integer,
	"chat_turns_per_month" integer,
	"tokens_per_day" bigint,
	"tokens_per_month" bigint,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_limit_overrides_chat_day_chk" CHECK ("chat_turns_per_day" IS NULL OR "chat_turns_per_day" >= 0),
	CONSTRAINT "user_limit_overrides_chat_month_chk" CHECK ("chat_turns_per_month" IS NULL OR "chat_turns_per_month" >= 0),
	CONSTRAINT "user_limit_overrides_tokens_day_chk" CHECK ("tokens_per_day" IS NULL OR "tokens_per_day" >= 0),
	CONSTRAINT "user_limit_overrides_tokens_month_chk" CHECK ("tokens_per_month" IS NULL OR "tokens_per_month" >= 0)
);--> statement-breakpoint
ALTER TABLE "app"."user_limit_overrides" ADD CONSTRAINT "user_limit_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_limit_overrides" ADD CONSTRAINT "user_limit_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_limit_overrides_updated_by_idx" ON "app"."user_limit_overrides" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;

ALTER TABLE app.user_limit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_limit_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY user_limit_overrides_tenant_guard ON app.user_limit_overrides AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (user_limit_overrides.user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_limit_overrides.user_id = (SELECT app.current_user_id()));
CREATE POLICY user_limit_overrides_select ON app.user_limit_overrides FOR SELECT
  USING (user_limit_overrides.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER user_limit_overrides_forbid_key_change BEFORE UPDATE ON app.user_limit_overrides
  FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('user_id');
CREATE TRIGGER user_limit_overrides_set_updated_at BEFORE UPDATE ON app.user_limit_overrides
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.user_limit_overrides TO eda_app;
GRANT SELECT (user_id, chat_turns_per_day, chat_turns_per_month, tokens_per_day, tokens_per_month, updated_by, created_at, updated_at) ON app.user_limit_overrides TO eda_sec_definer;
GRANT INSERT (user_id, chat_turns_per_day, chat_turns_per_month, tokens_per_day, tokens_per_month, updated_by) ON app.user_limit_overrides TO eda_sec_definer;
GRANT UPDATE (chat_turns_per_day, chat_turns_per_month, tokens_per_day, tokens_per_month, updated_by) ON app.user_limit_overrides TO eda_sec_definer;
GRANT DELETE ON app.user_limit_overrides TO eda_sec_definer;

-- Fonksiyonların ihtiyacı kadar kolon yetkisi (auth RLS'sizdir; yalnız sayaç/durum kolonları).
GRANT SELECT (id, email, email_verified, platform_role, banned, ban_reason, verification_status, two_factor_enabled, created_at)
  ON auth.users TO eda_sec_definer;
GRANT UPDATE (banned, ban_reason, updated_at) ON auth.users TO eda_sec_definer;
GRANT SELECT (user_id, created_at, expires_at) ON auth.sessions TO eda_sec_definer;
GRANT SELECT (user_id) ON auth.passkeys TO eda_sec_definer;
GRANT SELECT (organization_id, user_id, status) ON auth.members TO eda_sec_definer;

-- Kullanıcı listesi: arama (e-posta öneki, tam kimlik veya kısa kimlik = son 8 hane), durum/rol/doğrulama
-- süzgeci, (created_at, id) azalan imleç sayfalama. İçerik ve ad DÖNMEZ.
CREATE OR REPLACE FUNCTION app.admin_list_users(
  p_actor_id uuid, p_query text, p_account_status text, p_platform_role text, p_verification text,
  p_limit integer, p_cursor_at timestamptz, p_cursor_id uuid
)
RETURNS TABLE (
  user_id uuid, user_email text, platform_role text, email_verified boolean,
  verification_status text, account_status text, org_count integer,
  last_login_at timestamptz, created_at timestamptz
)
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
                 WHERE a.id = p_actor_id AND a.platform_role IN ('super_admin', 'support') AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel kullanıcı listesini okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_account_status IS NOT NULL AND p_account_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'hesap durumu active veya suspended olmalı' USING ERRCODE = '22023';
  END IF;
  IF p_platform_role IS NOT NULL AND p_platform_role NOT IN ('user', 'support', 'super_admin') THEN
    RAISE EXCEPTION 'platform rolü geçersiz' USING ERRCODE = '22023';
  END IF;
  IF p_verification IS NOT NULL AND p_verification NOT IN ('pending_verification', 'verified', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'doğrulama durumu geçersiz' USING ERRCODE = '22023';
  END IF;
  v_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
  SELECT u.id, u.email::text, u.platform_role, u.email_verified, u.verification_status,
         CASE WHEN u.banned OR u.verification_status = 'suspended' THEN 'suspended' ELSE 'active' END,
         (SELECT pg_catalog.count(*)::integer FROM auth.members m
           WHERE m.user_id = u.id AND m.status = 'active'),
         (SELECT pg_catalog.max(s.created_at) FROM auth.sessions s WHERE s.user_id = u.id),
         u.created_at
  FROM auth.users u
  WHERE (v_q = '' OR u.email LIKE v_like ESCAPE '\' OR u.id::text = v_q OR pg_catalog.right(u.id::text, 8) = v_q)
    AND (p_account_status IS NULL
         OR (p_account_status = 'suspended') = (u.banned OR u.verification_status = 'suspended'))
    AND (p_platform_role IS NULL OR u.platform_role = p_platform_role)
    AND (p_verification IS NULL OR u.verification_status = p_verification)
    AND (p_cursor_at IS NULL OR (u.created_at, u.id) < (p_cursor_at, p_cursor_id))
  ORDER BY u.created_at DESC, u.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 101);
END
$$;

-- Kullanıcı ayrıntısı: hesap durumu, MFA/passkey özeti, aktif oturum sayısı, kullanım sayaçları ve limit
-- geçersiz kılmaları (tek satır). Sayaç = adet/toplam; mesaj, başlık, dosya adı DÖNMEZ.
CREATE OR REPLACE FUNCTION app.admin_user_detail(p_actor_id uuid, p_user_id uuid)
RETURNS TABLE (
  user_id uuid, user_email text, platform_role text, email_verified boolean,
  verification_status text, account_status text, suspend_reason_code text, created_at timestamptz,
  org_count integer, last_login_at timestamptz, active_sessions integer, passkey_count integer,
  totp_enabled boolean, conversations_total integer,
  chat_turns_today integer, chat_turns_month integer, tokens_today bigint, tokens_month bigint,
  ov_chat_turns_per_day integer, ov_chat_turns_per_month integer,
  ov_tokens_per_day bigint, ov_tokens_per_month bigint, ov_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                             AT TIME ZONE 'Europe/Istanbul';
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                               AT TIME ZONE 'Europe/Istanbul';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('super_admin', 'support') AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel kullanıcı ayrıntısını okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users x WHERE x.id = p_user_id) THEN
    RAISE EXCEPTION 'kullanıcı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, u.platform_role, u.email_verified, u.verification_status,
         CASE WHEN u.banned OR u.verification_status = 'suspended' THEN 'suspended' ELSE 'active' END,
         u.ban_reason,
         u.created_at,
         (SELECT pg_catalog.count(*)::integer FROM auth.members m
           WHERE m.user_id = u.id AND m.status = 'active'),
         (SELECT pg_catalog.max(s.created_at) FROM auth.sessions s WHERE s.user_id = u.id),
         (SELECT pg_catalog.count(*)::integer FROM auth.sessions s
           WHERE s.user_id = u.id AND s.expires_at > pg_catalog.now()),
         (SELECT pg_catalog.count(*)::integer FROM auth.passkeys p WHERE p.user_id = u.id),
         u.two_factor_enabled,
         (SELECT pg_catalog.count(*)::integer FROM app.conversations c WHERE c.user_id = u.id),
         (SELECT pg_catalog.count(*)::integer FROM app.messages m
           WHERE m.user_id = u.id AND m.role = 'user' AND m.created_at >= v_day_start),
         (SELECT pg_catalog.count(*)::integer FROM app.messages m
           WHERE m.user_id = u.id AND m.role = 'user' AND m.created_at >= v_month_start),
         (SELECT coalesce(pg_catalog.sum(a.input_tokens::bigint + a.output_tokens + a.reasoning_tokens), 0)::bigint
            FROM app.ai_usage a WHERE a.user_id = u.id AND a.created_at >= v_day_start),
         (SELECT coalesce(pg_catalog.sum(a.input_tokens::bigint + a.output_tokens + a.reasoning_tokens), 0)::bigint
            FROM app.ai_usage a WHERE a.user_id = u.id AND a.created_at >= v_month_start),
         o.chat_turns_per_day, o.chat_turns_per_month, o.tokens_per_day, o.tokens_per_month, o.updated_at
  FROM auth.users u
  LEFT JOIN app.user_limit_overrides o ON o.user_id = u.id
  WHERE u.id = p_user_id;
END
$$;

-- Eylem öncesi koruma: yalnız super_admin; hedef var ve personel değil (oturum sonlandırma sırası).
CREATE OR REPLACE FUNCTION app.admin_assert_user_actionable(p_actor_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici kullanıcı işlemi yapabilir' USING ERRCODE = '42501';
  END IF;
  SELECT u.platform_role INTO v_role FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kullanıcı bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_role <> 'user' THEN
    RAISE EXCEPTION 'personel hesabı üzerinde işlem yapılamaz' USING ERRCODE = '55000';
  END IF;
END
$$;

-- Oturumlar kimlik katmanında (DB + Valkey) silindikten sonra denetim satırı (içeriksiz; yalnız sayı).
CREATE OR REPLACE FUNCTION app.admin_audit_sessions_revoked(p_actor_id uuid, p_user_id uuid, p_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM app.admin_assert_user_actionable(p_actor_id, p_user_id);
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'admin.session.revoked', 'user', p_user_id::text, NULL,
    pg_catalog.jsonb_build_object('count', greatest(coalesce(p_count, 0), 0)));
END
$$;

-- Hesabı askıya al / askıdan çıkar. Askı Better Auth `banned` alanıdır (giriş ve oturum çözümü reddeder);
-- sebep yalnız kapalı kod kümesinden. Dönüş: durum değişti mi (aynı durumdaysa no-op, denetim yazılmaz).
CREATE OR REPLACE FUNCTION app.admin_set_user_suspended(
  p_actor_id uuid, p_user_id uuid, p_suspended boolean, p_reason_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_banned boolean;
BEGIN
  PERFORM app.admin_assert_user_actionable(p_actor_id, p_user_id);
  IF p_suspended IS NULL THEN
    RAISE EXCEPTION 'askı değeri gerekli' USING ERRCODE = '22023';
  END IF;
  IF p_suspended AND (p_reason_code IS NULL OR p_reason_code NOT IN (
       'abuse', 'security', 'verification_mismatch', 'legal_request', 'user_request', 'other')) THEN
    RAISE EXCEPTION 'askı için geçerli bir neden kodu gerekir' USING ERRCODE = '22023';
  END IF;
  SELECT u.banned INTO v_banned FROM auth.users u WHERE u.id = p_user_id FOR UPDATE;
  IF v_banned = p_suspended THEN
    RETURN false;
  END IF;
  UPDATE auth.users
     SET banned = p_suspended,
         ban_reason = CASE WHEN p_suspended THEN p_reason_code END,
         updated_at = pg_catalog.clock_timestamp()
   WHERE id = p_user_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id,
    CASE WHEN p_suspended THEN 'admin.user.suspended' ELSE 'admin.user.unsuspended' END,
    'user', p_user_id::text, NULL,
    CASE WHEN p_suspended THEN pg_catalog.jsonb_build_object('reasonCode', p_reason_code) ELSE '{}'::jsonb END);
  RETURN true;
END
$$;

-- Kullanıcıya özel limit geçersiz kılmaları. NULL = varsayılan zincir (config/defaults). Dört değer de
-- NULL ise satır silinir ("sıfırla"). Denetim: system_setting.changed, kapsam user_limit (değerler sayıdır).
CREATE OR REPLACE FUNCTION app.admin_set_user_limits(
  p_actor_id uuid, p_user_id uuid, p_chat_turns_day integer, p_chat_turns_month integer,
  p_tokens_day bigint, p_tokens_month bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM app.admin_assert_user_actionable(p_actor_id, p_user_id);
  IF p_chat_turns_day < 0 OR p_chat_turns_month < 0 OR p_tokens_day < 0 OR p_tokens_month < 0 THEN
    RAISE EXCEPTION 'limit değerleri negatif olamaz' USING ERRCODE = '22023';
  END IF;
  IF p_chat_turns_day IS NULL AND p_chat_turns_month IS NULL AND p_tokens_day IS NULL AND p_tokens_month IS NULL THEN
    DELETE FROM app.user_limit_overrides WHERE user_id = p_user_id;
  ELSE
    INSERT INTO app.user_limit_overrides AS o
      (user_id, chat_turns_per_day, chat_turns_per_month, tokens_per_day, tokens_per_month, updated_by)
    VALUES (p_user_id, p_chat_turns_day, p_chat_turns_month, p_tokens_day, p_tokens_month, p_actor_id)
    ON CONFLICT (user_id) DO UPDATE
      SET chat_turns_per_day = EXCLUDED.chat_turns_per_day,
          chat_turns_per_month = EXCLUDED.chat_turns_per_month,
          tokens_per_day = EXCLUDED.tokens_per_day,
          tokens_per_month = EXCLUDED.tokens_per_month,
          updated_by = EXCLUDED.updated_by;
  END IF;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'user', p_user_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'user_limit',
      'chatTurnsPerDay', p_chat_turns_day, 'chatTurnsPerMonth', p_chat_turns_month,
      'tokensPerDay', p_tokens_day, 'tokensPerMonth', p_tokens_month));
END
$$;

REVOKE ALL ON FUNCTION app.admin_list_users(uuid, text, text, text, text, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_user_detail(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_assert_user_actionable(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_audit_sessions_revoked(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_set_user_suspended(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_set_user_limits(uuid, uuid, integer, integer, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_list_users(uuid, text, text, text, text, integer, timestamptz, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_user_detail(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_assert_user_actionable(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_audit_sessions_revoked(uuid, uuid, integer) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_set_user_suspended(uuid, uuid, boolean, text) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_set_user_limits(uuid, uuid, integer, integer, bigint, bigint) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_list_users(uuid, text, text, text, text, integer, timestamptz, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_user_detail(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_assert_user_actionable(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_audit_sessions_revoked(uuid, uuid, integer) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_set_user_suspended(uuid, uuid, boolean, text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_set_user_limits(uuid, uuid, integer, integer, bigint, bigint) OWNER TO eda_sec_definer;
