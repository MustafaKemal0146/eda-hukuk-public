-- eda:kind fn
-- Pano düzeltmesi: "bekleyen başvuru" sayısı yalnız GÖNDERİLMİŞ başvuruları sayar (app.lawyer_profiles
-- satırı olan, submitted_at dolu). Meslek bilgisini henüz göndermemiş `pending_verification` hesap bir
-- başvuru değildir; Başvurular listesi (admin_list_applications) de yalnız profil satırı olanları döner,
-- sayaç ve liste böylece tutarlı kalır. Etkilenen: admin_overview (pending_applications, oldest_pending_at)
-- ve admin_stats_funnel (pending). Huni anlamı: signups = kayıt (users.created_at), email_verified = kayıtlardan
-- e-postasını doğrulayan, applications = dönemde gönderilen başvuru (lawyer_profiles.submitted_at),
-- approved/rejected = dönemde karara bağlanan (reviewed_at), pending = ŞU AN karar bekleyen gönderilmiş başvuru.
-- İmza, sahiplik ve GRANT'lar değişmez: CREATE OR REPLACE ACL'yi korur; sahip eda_sec_definer olduğundan
-- değişiklik o rolle yapılır (0030 örneği). Destek sayaçları (0043) kasıtlı olarak değişmedi: destek iş
-- listesi profilsiz bekleyen hesapları da gösterir.

SET LOCAL ROLE eda_sec_definer;

CREATE OR REPLACE FUNCTION app.admin_overview(p_actor_id uuid)
RETURNS TABLE (
  verified_users integer, orgs_individual integer, orgs_firm integer, orgs_suspended integer,
  pending_applications integer, oldest_pending_at timestamptz,
  subs_trialing integer, subs_active integer, subs_past_due integer,
  signups_7d integer, chat_turns_today integer, active_users_today integer,
  llm_calls_today integer, llm_cost_today_micro_usd bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                             AT TIME ZONE 'Europe/Istanbul';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici özeti okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.verification_status = 'verified'),
    (SELECT pg_catalog.count(*)::integer FROM auth.organizations o
      WHERE o.kind = 'individual' AND o.suspended_at IS NULL),
    (SELECT pg_catalog.count(*)::integer FROM auth.organizations o
      WHERE o.kind <> 'individual' AND o.suspended_at IS NULL),
    (SELECT pg_catalog.count(*)::integer FROM auth.organizations o WHERE o.suspended_at IS NOT NULL),
    (SELECT pg_catalog.count(*)::integer FROM app.lawyer_profiles p
       JOIN auth.users u ON u.id = p.user_id
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'
        AND p.submitted_at IS NOT NULL),
    (SELECT pg_catalog.min(p.submitted_at) FROM app.lawyer_profiles p
       JOIN auth.users u ON u.id = p.user_id
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'
        AND p.submitted_at IS NOT NULL),
    (SELECT pg_catalog.count(*)::integer FROM app.subscriptions s WHERE s.status = 'trialing'),
    (SELECT pg_catalog.count(*)::integer FROM app.subscriptions s WHERE s.status = 'active'),
    (SELECT pg_catalog.count(*)::integer FROM app.subscriptions s WHERE s.status = 'past_due'),
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.created_at >= pg_catalog.now() - interval '7 days'),
    (SELECT pg_catalog.count(*)::integer FROM app.messages m
      WHERE m.role = 'assistant' AND m.created_at >= v_day_start),
    (SELECT pg_catalog.count(DISTINCT m.user_id)::integer FROM app.messages m
      WHERE m.role = 'user' AND m.user_id IS NOT NULL AND m.created_at >= v_day_start),
    (SELECT pg_catalog.count(*)::integer FROM app.ai_usage a WHERE a.created_at >= v_day_start),
    (SELECT coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint FROM app.ai_usage a
      WHERE a.created_at >= v_day_start);
END
$$;

CREATE OR REPLACE FUNCTION app.admin_stats_funnel(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (
  signups integer, email_verified integer, applications integer, approved integer, rejected integer,
  pending integer, median_decision_hours numeric
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
    RAISE EXCEPTION 'yalnız süper yönetici istatistik okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.created_at >= v_t0 AND u.created_at < v_t1),
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.email_verified AND u.created_at >= v_t0 AND u.created_at < v_t1),
    (SELECT pg_catalog.count(*)::integer FROM app.lawyer_profiles p
      WHERE p.submitted_at >= v_t0 AND p.submitted_at < v_t1),
    (SELECT pg_catalog.count(*)::integer FROM app.lawyer_profiles p JOIN auth.users u ON u.id = p.user_id
      WHERE p.reviewed_at >= v_t0 AND p.reviewed_at < v_t1 AND u.verification_status = 'verified'),
    (SELECT pg_catalog.count(*)::integer FROM app.lawyer_profiles p JOIN auth.users u ON u.id = p.user_id
      WHERE p.reviewed_at >= v_t0 AND p.reviewed_at < v_t1 AND u.verification_status = 'rejected'),
    (SELECT pg_catalog.count(*)::integer FROM app.lawyer_profiles p
       JOIN auth.users u ON u.id = p.user_id
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'
        AND p.submitted_at IS NOT NULL),
    (SELECT pg_catalog.round(
        (pg_catalog.percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM p.reviewed_at - p.submitted_at) / 3600.0))::numeric, 1)
       FROM app.lawyer_profiles p
      WHERE p.reviewed_at >= v_t0 AND p.reviewed_at < v_t1 AND p.reviewed_at >= p.submitted_at);
END
$$;

-- ACL CREATE OR REPLACE ile korunur; 0037 ile aynı değerler açıkça yinelenir (idempotent).
REVOKE ALL ON FUNCTION app.admin_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_stats_funnel(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_overview(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_stats_funnel(uuid, date, date) TO eda_readonly_admin;

RESET ROLE;
