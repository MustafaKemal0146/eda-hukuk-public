-- eda:kind fn
-- P04a (031 §8.2; 042 §3.3, §3.4; 046 §3; 045 §3.4; 002 §9 "Kimlik ve e-posta fonksiyonları"):
-- meslek başvurusu kararı ve `make approve-user` yardımcıları. Sahibi eda_sec_definer, EXECUTE yalnız
-- eda_readonly_admin. Aktör `p_actor_id` her çağrıda `auth.users.platform_role = 'super_admin'` ile
-- doğrulanır. Deneme gün/kredi sayısı, şablon sürümü ve e-posta parametreleri uygulama katmanındaki
-- yapılandırma (`trial.*`) ve `@eda/email` kataloğundan gelir; fonksiyonda sabit yoktur (AS-0265).
-- Karar, abonelik, kredi, bildirim, e-posta outbox kaydı ve denetim satırı TEK işlemdedir.

GRANT SELECT (id, email, platform_role, banned, verification_status) ON auth.users TO eda_sec_definer;
GRANT UPDATE (verification_status, updated_at) ON auth.users TO eda_sec_definer;
GRANT SELECT (role, created_at) ON auth.members TO eda_sec_definer;
GRANT SELECT (user_id, verification_source) ON app.lawyer_profiles TO eda_sec_definer;
GRANT UPDATE (verification_source, reviewed_by, reviewed_at, rejection_reason) ON app.lawyer_profiles TO eda_sec_definer;
GRANT SELECT (id, org_id, plan_code) ON app.subscriptions TO eda_sec_definer;
GRANT INSERT (org_id, plan_code, status, provider, seats, trial_ends_at, current_period_start, current_period_end) ON app.subscriptions TO eda_sec_definer;
GRANT SELECT (id, org_id, balance_after, created_at) ON app.credit_ledger TO eda_sec_definer;
GRANT INSERT (org_id, entry_type, amount, balance_after, user_id, subscription_id, expires_at, created_by) ON app.credit_ledger TO eda_sec_definer;
GRANT INSERT (org_id, user_id, type, payload) ON app.notifications TO eda_sec_definer;

-- Aktör çözümü: e-posta verilirse o (yasaklı olmayan) super_admin; NULL ise tek super_admin; aksi hata.
CREATE OR REPLACE FUNCTION app.admin_resolve_actor(p_actor_email text) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(u.id ORDER BY u.id), '{}') INTO v_ids
  FROM auth.users u
  WHERE u.platform_role = 'super_admin' AND NOT u.banned
    AND (p_actor_email IS NULL OR u.email = p_actor_email);
  IF pg_catalog.cardinality(v_ids) = 1 THEN
    RETURN v_ids[1];
  END IF;
  IF p_actor_email IS NOT NULL THEN
    RAISE EXCEPTION 'bu e-postayla etkin bir süper yönetici yok' USING ERRCODE = 'P0002';
  END IF;
  RAISE EXCEPTION 'aktör belirsiz: % süper yönetici var; --as ile personel e-postası verin',
    pg_catalog.cardinality(v_ids) USING ERRCODE = 'P0002';
END
$$;

-- Başvurunun kullanıcı kimliği ve durumu (yalnız super_admin aktör; içerik dönmez).
CREATE OR REPLACE FUNCTION app.admin_find_application(p_actor_id uuid, p_email text)
RETURNS TABLE (user_id uuid, verification_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned) THEN
    RAISE EXCEPTION 'yalnız süper yönetici başvuru arayabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id, u.verification_status
    FROM auth.users u
    WHERE u.email = p_email AND u.platform_role = 'user';
END
$$;

-- Meslek başvurusu kararı. Dönüş: e-posta teslimat kimliği (çağıran commit sonrası email.send işini
-- kuyruğa ekler; kaçarsa email_outbox.sweep yakalar). Ret nedeni yalnız sabit kod kümesindendir
-- (002 §11.11 AdminApplicationRejectInput.reasonCode); serbest metin yazılmaz.
CREATE OR REPLACE FUNCTION app.admin_decide_application(
  p_actor_id uuid, p_user_id uuid, p_decision text, p_reason_code text, p_trial_days integer,
  p_trial_credits integer, p_template_version text, p_email_params jsonb,
  p_email_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_status text;
  v_org uuid;
  v_sub uuid;
  v_trial_end timestamptz;
  v_balance integer;
  v_delivery uuid;
  v_template text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned) THEN
    RAISE EXCEPTION 'yalnız süper yönetici başvuru kararı verebilir' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'karar approved veya rejected olmalı' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'rejected' AND (p_reason_code IS NULL OR p_reason_code NOT IN (
       'not_found_in_registry', 'identity_mismatch', 'incomplete_information',
       'duplicate_registry', 'not_eligible', 'other')) THEN
    RAISE EXCEPTION 'ret için geçerli bir neden kodu gerekir' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'approved' AND (p_trial_days IS NULL OR p_trial_days < 1
       OR p_trial_credits IS NULL OR p_trial_credits < 1) THEN
    RAISE EXCEPTION 'deneme gün ve kredi sayısı pozitif olmalı' USING ERRCODE = '22023';
  END IF;

  SELECT u.verification_status INTO v_status
  FROM auth.users u WHERE u.id = p_user_id AND u.platform_role = 'user'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'başvuru bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending_verification' THEN
    RAISE EXCEPTION 'başvuru karar beklemiyor (durum: %)', v_status USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.lawyer_profiles p WHERE p.user_id = p_user_id) THEN
    RAISE EXCEPTION 'kullanıcının meslek başvurusu yok' USING ERRCODE = 'P0002';
  END IF;

  UPDATE auth.users SET verification_status = CASE p_decision WHEN 'approved' THEN 'verified' ELSE 'rejected' END,
         updated_at = v_now
  WHERE id = p_user_id;
  UPDATE app.lawyer_profiles
  SET reviewed_by = p_actor_id, reviewed_at = v_now,
      rejection_reason = CASE p_decision WHEN 'rejected' THEN p_reason_code END,
      verification_source = coalesce(verification_source, 'admin_review')
  WHERE user_id = p_user_id;

  -- Bireysel büro (e-posta doğrulamasında açılır; 042 §3.1).
  SELECT m.organization_id INTO v_org
  FROM auth.members m JOIN auth.organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id AND m.role = 'owner' AND m.status = 'active' AND o.kind = 'individual'
  ORDER BY m.created_at
  LIMIT 1;

  IF p_decision = 'approved' THEN
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'onay için kullanıcının bireysel bürosu gerekir' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.subscriptions s WHERE s.org_id = v_org AND s.plan_code = 'trial') THEN
      v_trial_end := v_now + pg_catalog.make_interval(days => p_trial_days);
      INSERT INTO app.subscriptions (org_id, plan_code, status, provider, seats, trial_ends_at,
        current_period_start, current_period_end)
      VALUES (v_org, 'trial', 'trialing', 'manual', 1, v_trial_end, v_now, v_trial_end)
      RETURNING id INTO v_sub;
      -- Kredi defteri protokolü (046 §5): rezervasyonla aynı danışma kilidi, bakiye son satırdan.
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('credit:' || v_org::text, 0));
      SELECT coalesce((SELECT c.balance_after FROM app.credit_ledger c WHERE c.org_id = v_org
                       ORDER BY c.created_at DESC, c.id DESC LIMIT 1), 0)
        INTO v_balance;
      INSERT INTO app.credit_ledger (org_id, entry_type, amount, balance_after, user_id,
        subscription_id, expires_at, created_by)
      VALUES (v_org, 'trial_grant', p_trial_credits, v_balance + p_trial_credits, p_user_id, v_sub,
        v_trial_end, p_actor_id);
    END IF;
  END IF;

  v_template := 'verification_' || p_decision;
  IF v_org IS NOT NULL THEN
    INSERT INTO app.notifications (org_id, user_id, type, payload)
    VALUES (v_org, p_user_id, v_template, '{}'::jsonb);
  END IF;

  v_delivery := app.email_enqueue(v_template, v_template, p_template_version, 'service', p_user_id,
    NULL, NULL,
    'decision:' || p_user_id::text || ':' || p_decision || ':'
      || pg_catalog.to_char(v_now AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSUS'),
    p_email_params, NULL, p_email_expires_at);

  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'admin.application.' || p_decision, 'user',
    p_user_id::text, NULL,
    CASE WHEN p_decision = 'rejected' THEN pg_catalog.jsonb_build_object('reasonCode', p_reason_code)
         ELSE '{}'::jsonb END);
  RETURN v_delivery;
END
$$;

REVOKE ALL ON FUNCTION app.admin_resolve_actor(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_find_application(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_decide_application(uuid, uuid, text, text, integer, integer, text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_resolve_actor(text) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_find_application(uuid, text) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_decide_application(uuid, uuid, text, text, integer, integer, text, jsonb, timestamptz) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_resolve_actor(text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_find_application(uuid, text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_decide_application(uuid, uuid, text, text, integer, integer, text, jsonb, timestamptz) OWNER TO eda_sec_definer;
