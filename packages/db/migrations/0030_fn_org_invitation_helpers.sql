-- eda:kind fn
-- P04b (042 §4.1–§4.3; 002 §9 "Büro, koltuk ve davet fonksiyonları"): koltuk kullanım okuması,
-- davetle meslek profili kaynağı ve `app.email_enqueue` davet dalı. Hepsi SECURITY DEFINER, sahibi
-- eda_sec_definer, search_path sabit, PUBLIC'e EXECUTE yok. eda_app davet kimliğini (taşıyıcı belirteç)
-- OKUYAMAZ; bu fonksiyonlar kimliği yalnız eşitlik karşılaştırmasında kullanır ve döndürmez.

GRANT SELECT (id, organization_id, email, role, status, expires_at, inviter_id) ON auth.invitations TO eda_sec_definer;
GRANT SELECT (id, organization_id, user_id, status) ON auth.members TO eda_sec_definer;
GRANT SELECT (reviewed_at) ON app.lawyer_profiles TO eda_sec_definer;

-- Koltuk kullanımı (davet ve kabul ön denetimi; asıl denetim `members_seat_limit` tetikleyicisi).
-- Çağıran ya aktif büro bağıyla (`withTenant`) bu büronun etkin üyesidir ya da kullanıcı bağıyla
-- (`withUserScope`) bu büroya süresi dolmamış bekleyen daveti olan kullanıcıdır; aksi 42501.
CREATE OR REPLACE FUNCTION app.org_seat_usage(p_org uuid)
RETURNS TABLE (capacity integer, used integer, pending_invitations integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := app.current_user_id();
  v_cap integer;
BEGIN
  IF v_uid IS NULL OR p_org IS NULL THEN
    RAISE EXCEPTION 'koltuk bilgisi için kullanıcı bağı gerekir' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    (app.current_org_id() = p_org AND EXISTS (
      SELECT 1 FROM auth.members m
      WHERE m.organization_id = p_org AND m.user_id = v_uid AND m.status = 'active'))
    OR EXISTS (
      SELECT 1 FROM auth.invitations i JOIN auth.users u ON u.email = i.email
      WHERE u.id = v_uid AND i.organization_id = p_org AND i.status = 'pending'
        AND i.expires_at > pg_catalog.now())
  ) THEN
    RAISE EXCEPTION 'bu büronun koltuk bilgisine erişim yok' USING ERRCODE = '42501';
  END IF;
  SELECT LEAST(s.seats, COALESCE(p.seat_max, s.seats)) INTO v_cap
  FROM app.subscriptions s JOIN app.plans p ON p.code = s.plan_code
  WHERE s.org_id = p_org AND s.status IN ('trialing', 'active', 'past_due')
  ORDER BY s.created_at DESC
  LIMIT 1;
  RETURN QUERY SELECT
    COALESCE(v_cap, 1),
    (SELECT pg_catalog.count(*)::integer FROM auth.members m WHERE m.organization_id = p_org),
    (SELECT pg_catalog.count(*)::integer FROM auth.invitations i
     WHERE i.organization_id = p_org AND i.status = 'pending' AND i.expires_at > pg_catalog.now());
END
$$;
REVOKE ALL ON FUNCTION app.org_seat_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_seat_usage(uuid) TO eda_app;

-- Davet kabulünden önce meslek beyanı (042 §4.2 adım 4): davet oturum kullanıcısının adresine,
-- bekliyor, süresi dolmamış ve rolü meslek gerektiriyorsa profil kaynağı `org_invitation` olur.
-- İnceleme yapılmış (`reviewed_at`) veya kaynağı yazılmış profil değişmez. Dönüş: yazıldı mı.
CREATE OR REPLACE FUNCTION app.mark_profile_invitation_source(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := app.current_user_id();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'profil işareti için kullanıcı bağı gerekir' USING ERRCODE = '42501';
  END IF;
  UPDATE app.lawyer_profiles p
  SET verification_source = 'org_invitation'
  WHERE p.user_id = v_uid AND p.verification_source IS NULL AND p.reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM auth.invitations i JOIN auth.users u ON u.email = i.email
      WHERE i.id = p_invitation_id AND u.id = v_uid AND i.status = 'pending'
        AND i.expires_at > pg_catalog.now()
        AND i.role IN ('senior_lawyer', 'lawyer', 'trainee'));
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION app.mark_profile_invitation_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_profile_invitation_source(uuid) TO eda_app;

-- `app.email_enqueue` davet dalı (AS-0264 kapanışı; AS-0361): davet e-postası satırında `user_id`
-- davet eden kullanıcıdır (satır onun bağlamında okunur ve mühür AAD'si ona bağlıdır), alıcı adresi
-- worker'da `auth.invitations(email)`'den çözülür. eda_app oturumunda davet bekliyor ve davet eden
-- oturum kullanıcısı olmalıdır. İmza, yetkiler ve diğer davranış 0026 ile aynıdır. Fonksiyonun sahibi
-- eda_sec_definer olduğundan (eda_owner üyeliği INHERIT FALSE) değişiklik o rolle yapılır.
SET LOCAL ROLE eda_sec_definer;
CREATE OR REPLACE FUNCTION app.email_enqueue(
  p_kind text, p_template text, p_template_version text, p_class text, p_user_id uuid,
  p_org_id uuid, p_invitation_id uuid, p_dedupe_key text, p_params jsonb, p_sealed bytea,
  p_expires_at timestamptz, p_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_id uuid;
BEGIN
  IF session_user = 'eda_app' THEN
    IF app.current_user_id() IS NULL OR p_user_id IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'e-posta kaydı yalnız oturumdaki kullanıcı için açılabilir' USING ERRCODE = '42501';
    END IF;
    IF p_org_id IS NOT NULL AND p_org_id IS DISTINCT FROM app.current_org_id() THEN
      RAISE EXCEPTION 'e-posta kaydı yalnız aktif büro için açılabilir' USING ERRCODE = '42501';
    END IF;
    IF p_invitation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM auth.invitations i
      WHERE i.id = p_invitation_id AND i.inviter_id = p_user_id AND i.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'davet e-postası yalnız davet eden için açılabilir' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_kind IS NULL OR p_template IS NULL OR p_template_version IS NULL OR p_dedupe_key IS NULL
     OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'e-posta kaydı eksik alan içeriyor' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL AND p_invitation_id IS NULL AND p_sealed IS NULL THEN
    RAISE EXCEPTION 'e-posta kaydının alıcısı yok' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(v_params) <> 'object' THEN
    RAISE EXCEPTION 'e-posta parametreleri nesne olmalı' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.pg_column_size(v_params) > 2048 THEN
    RAISE EXCEPTION 'e-posta parametreleri 2048 baytı aşıyor' USING ERRCODE = '22001';
  END IF;
  INSERT INTO app.email_deliveries (id, org_id, user_id, invitation_id, kind, template_code,
    template_version, class, dedupe_key, params, sealed_params, expires_at)
  VALUES (coalesce(p_id, uuidv7()), p_org_id, p_user_id, p_invitation_id, p_kind, p_template,
    p_template_version, p_class, p_dedupe_key, v_params, p_sealed, p_expires_at)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION app.email_enqueue(text, text, text, text, uuid, uuid, uuid, text, jsonb, bytea, timestamptz, uuid) FROM PUBLIC;
RESET ROLE;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.org_seat_usage(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.mark_profile_invitation_source(uuid) OWNER TO eda_sec_definer;
