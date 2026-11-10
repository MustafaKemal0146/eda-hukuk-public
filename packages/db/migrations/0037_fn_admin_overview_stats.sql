-- eda:kind fn
-- P27 (031 §8.2; 053-ekranlar/11 §3.1, §3.2 ve "İstatistikler" modülü): yönetim yüzeyi okuma
-- fonksiyonları. Sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin. Her fonksiyon aktörü
-- `p_actor_id -> platform_role` ile doğrular (super_admin, yasaklı değil). Yalnız SAYI ve durum döner:
-- sohbet/mesaj/belge/etkinlik içeriği, başlık, taraf adı, kullanıcı bazlı davranış DÖNMEZ (KK-031-9).
-- Gün sınırı Europe/Istanbul'dur. Aralık en çok 93 gündür (calendar.rangeMaxDays ile aynı üst sınır).

GRANT SELECT (name, email_verified, created_at) ON auth.users TO eda_sec_definer;
GRANT SELECT (id, kind, suspended_at, created_at) ON auth.organizations TO eda_sec_definer;
GRANT SELECT (baro, sicil_no, trainee_registry_no, verification_source, reviewed_at, rejection_reason, submitted_at)
  ON app.lawyer_profiles TO eda_sec_definer;
GRANT SELECT (status) ON app.subscriptions TO eda_sec_definer;
GRANT SELECT (id, org_id, user_id, created_at) ON app.conversations TO eda_sec_definer;
GRANT SELECT (id, org_id, role, user_id, status, error_code, created_at) ON app.messages TO eda_sec_definer;
GRANT SELECT (id, org_id, kind, created_at) ON app.documents TO eda_sec_definer;
GRANT SELECT (id, org_id, type, created_at) ON app.calendar_events TO eda_sec_definer;
-- ai_usage bölümlüdür (partitioned): kolon yetkisi bölümlerde tutarsız görünür; tablo düzeyinde SELECT
-- verilir (tabloda içerik kolonu yoktur: yalnız kimlik, sayaç ve durum alanları).
GRANT SELECT ON app.ai_usage TO eda_sec_definer;

-- Pano özeti: tek satır.
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
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'),
    (SELECT pg_catalog.min(p.submitted_at) FROM app.lawyer_profiles p
       JOIN auth.users u ON u.id = p.user_id
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'),
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

-- Meslek başvuruları listesi (kimlik ve baro bilgisi; belge/kimlik dosyası YOK).
CREATE OR REPLACE FUNCTION app.admin_list_applications(
  p_actor_id uuid, p_status text, p_limit integer, p_before timestamptz
)
RETURNS TABLE (
  user_id uuid, applicant_name text, applicant_email text, baro text, sicil_no text, trainee_registry_no text,
  verification_status text, verification_source text, submitted_at timestamptz,
  reviewed_at timestamptz, reject_code text
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
    RAISE EXCEPTION 'yalnız süper yönetici başvuruları listeleyebilir' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending_verification', 'verified', 'rejected') THEN
    RAISE EXCEPTION 'durum pending_verification, verified veya rejected olmalı' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT u.id, u.name::text, u.email::text, p.baro, p.sicil_no, p.trainee_registry_no,
         u.verification_status, p.verification_source, p.submitted_at, p.reviewed_at,
         p.rejection_reason
  FROM auth.users u
  JOIN app.lawyer_profiles p ON p.user_id = u.id
  WHERE u.platform_role = 'user'
    AND u.verification_status = p_status
    AND (p_before IS NULL OR p.submitted_at < p_before)
  ORDER BY CASE WHEN p_status = 'pending_verification' THEN p.submitted_at END ASC,
           CASE WHEN p_status <> 'pending_verification' THEN p.submitted_at END DESC,
           u.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 100);
END
$$;

-- Günlük istatistik serisi (içeriksiz sayaçlar). Aralık dahil; en çok 93 gün.
CREATE OR REPLACE FUNCTION app.admin_stats_daily(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (
  day date, signups integer, applications integer, approvals integer, rejections integer,
  active_users integer, conversations integer, chat_turns integer, documents integer,
  calendar_events integer, llm_calls integer, llm_errors integer, llm_cost_micro_usd bigint
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
    RAISE EXCEPTION 'yalnız süper yönetici istatistik okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH days AS (SELECT g::date AS d FROM pg_catalog.generate_series(p_from, p_to, interval '1 day') g),
  ist AS (SELECT p_from::timestamp AT TIME ZONE 'Europe/Istanbul' AS t0,
                 (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AS t1),
  su AS (SELECT (u.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n
         FROM auth.users u, ist WHERE u.platform_role = 'user' AND u.created_at >= ist.t0 AND u.created_at < ist.t1
         GROUP BY 1),
  ap AS (SELECT (p.submitted_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n
         FROM app.lawyer_profiles p, ist WHERE p.submitted_at >= ist.t0 AND p.submitted_at < ist.t1 GROUP BY 1),
  dec AS (SELECT (p.reviewed_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                 pg_catalog.count(*) FILTER (WHERE u.verification_status = 'verified')::integer AS ok,
                 pg_catalog.count(*) FILTER (WHERE u.verification_status = 'rejected')::integer AS no
          FROM app.lawyer_profiles p JOIN auth.users u ON u.id = p.user_id, ist
          WHERE p.reviewed_at >= ist.t0 AND p.reviewed_at < ist.t1 GROUP BY 1),
  au AS (SELECT (m.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                pg_catalog.count(DISTINCT m.user_id)::integer AS n,
                pg_catalog.count(*) FILTER (WHERE m.role = 'assistant')::integer AS turns
         FROM app.messages m, ist
         WHERE m.created_at >= ist.t0 AND m.created_at < ist.t1 AND (m.role = 'assistant' OR m.user_id IS NOT NULL)
         GROUP BY 1),
  cv AS (SELECT (c.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n
         FROM app.conversations c, ist WHERE c.created_at >= ist.t0 AND c.created_at < ist.t1 GROUP BY 1),
  dc AS (SELECT (x.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n
         FROM app.documents x, ist WHERE x.created_at >= ist.t0 AND x.created_at < ist.t1 GROUP BY 1),
  ce AS (SELECT (x.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n
         FROM app.calendar_events x, ist WHERE x.created_at >= ist.t0 AND x.created_at < ist.t1 GROUP BY 1),
  ai AS (SELECT (a.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n,
                pg_catalog.count(*) FILTER (WHERE a.status <> 'success')::integer AS err,
                coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint AS cost
         FROM app.ai_usage a, ist WHERE a.created_at >= ist.t0 AND a.created_at < ist.t1 GROUP BY 1)
  SELECT days.d, coalesce(su.n, 0), coalesce(ap.n, 0), coalesce(dec.ok, 0), coalesce(dec.no, 0),
         coalesce(au.n, 0), coalesce(cv.n, 0), coalesce(au.turns, 0), coalesce(dc.n, 0),
         coalesce(ce.n, 0), coalesce(ai.n, 0), coalesce(ai.err, 0), coalesce(ai.cost, 0)
  FROM days
  LEFT JOIN su ON su.d = days.d LEFT JOIN ap ON ap.d = days.d LEFT JOIN dec ON dec.d = days.d
  LEFT JOIN au ON au.d = days.d LEFT JOIN cv ON cv.d = days.d LEFT JOIN dc ON dc.d = days.d
  LEFT JOIN ce ON ce.d = days.d LEFT JOIN ai ON ai.d = days.d
  ORDER BY days.d;
END
$$;

-- Dönemin toplamları: başvuru hunisi ve görev/model kırılımı (kullanıcı kırılımı yok).
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
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'),
    (SELECT pg_catalog.round(
        (pg_catalog.percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM p.reviewed_at - p.submitted_at) / 3600.0))::numeric, 1)
       FROM app.lawyer_profiles p
      WHERE p.reviewed_at >= v_t0 AND p.reviewed_at < v_t1 AND p.reviewed_at >= p.submitted_at);
END
$$;

CREATE OR REPLACE FUNCTION app.admin_stats_breakdown(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (dimension text, key text, calls bigint, errors bigint, cost_micro_usd bigint)
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
  SELECT 'task'::text, a.task, pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE a.status <> 'success'),
         coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint
  FROM app.ai_usage a WHERE a.created_at >= v_t0 AND a.created_at < v_t1 GROUP BY a.task
  UNION ALL
  SELECT 'model_alias'::text, a.model_alias, pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE a.status <> 'success'),
         coalesce(pg_catalog.sum(a.cost_micro_usd), 0)::bigint
  FROM app.ai_usage a WHERE a.created_at >= v_t0 AND a.created_at < v_t1 GROUP BY a.model_alias
  UNION ALL
  SELECT 'document_kind'::text, x.kind, pg_catalog.count(*), 0::bigint, 0::bigint
  FROM app.documents x WHERE x.created_at >= v_t0 AND x.created_at < v_t1 GROUP BY x.kind
  UNION ALL
  SELECT 'event_type'::text, x.type, pg_catalog.count(*), 0::bigint, 0::bigint
  FROM app.calendar_events x WHERE x.created_at >= v_t0 AND x.created_at < v_t1 GROUP BY x.type;
END
$$;

REVOKE ALL ON FUNCTION app.admin_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_list_applications(uuid, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_stats_daily(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_stats_funnel(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_stats_breakdown(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_overview(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_list_applications(uuid, text, integer, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_stats_daily(uuid, date, date) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_stats_funnel(uuid, date, date) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_stats_breakdown(uuid, date, date) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_overview(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_list_applications(uuid, text, integer, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_stats_daily(uuid, date, date) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_stats_funnel(uuid, date, date) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_stats_breakdown(uuid, date, date) OWNER TO eda_sec_definer;
