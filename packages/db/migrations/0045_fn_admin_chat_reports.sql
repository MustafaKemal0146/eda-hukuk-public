-- eda:kind fn
-- Yönetim paneli "Sohbetler ve raporlar" modülü (053-ekranlar/11): yalnız TOPLULAŞTIRILMIŞ okuma
-- fonksiyonları. Sohbet/mesaj İÇERİĞİ (parts, llm_parts, llm_context, reasoning, başlık, özet, künye,
-- masked_content, araç argümanı) hiçbir yerde seçilmez ve dönmez: avukat-müvekkil sırrı, KVKK.
-- Kullanıcı kimliği ve büro kimliği dönmez; büro yalnız `kind` (bireysel/büro) kırılımında sayılır.
-- Sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin; aktör her çağrıda super_admin doğrulanır.
-- Gün sınırı Europe/Istanbul, aralık en çok 93 gündür (0037 ile aynı).

-- Kolon düzeyinde (içerik kolonu YOK) ek okuma yetkileri.
GRANT SELECT (model_alias, completed_at) ON app.messages TO eda_sec_definer;
GRANT SELECT (org_id, tool_name, status, duration_ms, created_at) ON app.tool_calls TO eda_sec_definer;
GRANT SELECT (org_id, rating, category, created_at) ON app.message_feedback TO eda_sec_definer;
GRANT SELECT (org_id, source_kind, origin, created_at) ON app.message_sources TO eda_sec_definer;

-- Günlük seri: sohbet, mesaj, tur, süre, çağrı modu, kaynak ve geri bildirim sayaçları.
CREATE OR REPLACE FUNCTION app.admin_chat_report_daily(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (
  day date, conversations integer, messages integer, user_messages integer, turns integer,
  turns_error integer, avg_turn_seconds numeric, active_orgs integer, chat_calls integer,
  petition_calls integer, sources_decision integer, sources_legislation integer,
  feedback_up integer, feedback_down integer
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
    RAISE EXCEPTION 'yalnız süper yönetici sohbet raporu okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH days AS (SELECT g::date AS d FROM pg_catalog.generate_series(p_from, p_to, interval '1 day') g),
  ist AS (SELECT p_from::timestamp AT TIME ZONE 'Europe/Istanbul' AS t0,
                 (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul' AS t1),
  cv AS (SELECT (c.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d, pg_catalog.count(*)::integer AS n
         FROM app.conversations c, ist WHERE c.created_at >= ist.t0 AND c.created_at < ist.t1 GROUP BY 1),
  ms AS (SELECT (m.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                pg_catalog.count(*) FILTER (WHERE m.role IN ('user', 'assistant'))::integer AS total,
                pg_catalog.count(*) FILTER (WHERE m.role = 'user')::integer AS usr,
                pg_catalog.count(*) FILTER (WHERE m.role = 'assistant')::integer AS turns,
                pg_catalog.count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'error')::integer AS err,
                pg_catalog.avg(extract(epoch FROM m.completed_at - m.created_at))
                  FILTER (WHERE m.role = 'assistant' AND m.status = 'complete'
                            AND m.completed_at IS NOT NULL AND m.completed_at >= m.created_at) AS avg_s,
                pg_catalog.count(DISTINCT m.org_id) FILTER (WHERE m.role = 'user')::integer AS orgs
         FROM app.messages m, ist WHERE m.created_at >= ist.t0 AND m.created_at < ist.t1 GROUP BY 1),
  ai AS (SELECT (a.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                pg_catalog.count(*) FILTER (WHERE a.task = 'chat')::integer AS chat,
                pg_catalog.count(*) FILTER (WHERE a.task IN ('draft_document', 'edit_document'))::integer AS petition
         FROM app.ai_usage a, ist WHERE a.created_at >= ist.t0 AND a.created_at < ist.t1 GROUP BY 1),
  so AS (SELECT (s.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                pg_catalog.count(*) FILTER (WHERE s.source_kind = 'decision')::integer AS dec,
                pg_catalog.count(*) FILTER (WHERE s.source_kind = 'legislation')::integer AS leg
         FROM app.message_sources s, ist WHERE s.created_at >= ist.t0 AND s.created_at < ist.t1 GROUP BY 1),
  fb AS (SELECT (f.created_at AT TIME ZONE 'Europe/Istanbul')::date AS d,
                pg_catalog.count(*) FILTER (WHERE f.rating = 1)::integer AS up,
                pg_catalog.count(*) FILTER (WHERE f.rating = -1)::integer AS down
         FROM app.message_feedback f, ist WHERE f.created_at >= ist.t0 AND f.created_at < ist.t1 GROUP BY 1)
  SELECT days.d, coalesce(cv.n, 0), coalesce(ms.total, 0), coalesce(ms.usr, 0), coalesce(ms.turns, 0),
         coalesce(ms.err, 0), pg_catalog.round(ms.avg_s::numeric, 1), coalesce(ms.orgs, 0),
         coalesce(ai.chat, 0), coalesce(ai.petition, 0), coalesce(so.dec, 0), coalesce(so.leg, 0),
         coalesce(fb.up, 0), coalesce(fb.down, 0)
  FROM days
  LEFT JOIN cv ON cv.d = days.d LEFT JOIN ms ON ms.d = days.d LEFT JOIN ai ON ai.d = days.d
  LEFT JOIN so ON so.d = days.d LEFT JOIN fb ON fb.d = days.d
  ORDER BY days.d;
END
$$;

-- Dönem kırılımı: mod, takma ad, araç, kaynak, geri bildirim ve büro türü. `key` yalnız kod değeridir.
-- total: sayı; errors: hata sayısı (araçta error/timeout); avg_ms: ortalama süre (yalnız araç, yoksa 0).
CREATE OR REPLACE FUNCTION app.admin_chat_report_breakdown(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (dimension text, key text, total bigint, errors bigint, avg_ms integer)
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
    RAISE EXCEPTION 'yalnız süper yönetici sohbet raporu okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT 'mode'::text,
         CASE WHEN a.task = 'chat' THEN 'chat' ELSE 'petition' END,
         pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE a.status <> 'success'), 0
  FROM app.ai_usage a
  WHERE a.created_at >= v_t0 AND a.created_at < v_t1 AND a.task IN ('chat', 'draft_document', 'edit_document')
  GROUP BY 2
  UNION ALL
  SELECT 'model_alias'::text, m.model_alias, pg_catalog.count(*),
         pg_catalog.count(*) FILTER (WHERE m.status = 'error'), 0
  FROM app.messages m
  WHERE m.role = 'assistant' AND m.model_alias IS NOT NULL AND m.created_at >= v_t0 AND m.created_at < v_t1
  GROUP BY m.model_alias
  UNION ALL
  SELECT 'tool'::text, t.tool_name, pg_catalog.count(*),
         pg_catalog.count(*) FILTER (WHERE t.status IN ('error', 'timeout')),
         coalesce(pg_catalog.round(pg_catalog.avg(t.duration_ms)), 0)::integer
  FROM app.tool_calls t WHERE t.created_at >= v_t0 AND t.created_at < v_t1 GROUP BY t.tool_name
  UNION ALL
  SELECT 'source_kind'::text, s.source_kind, pg_catalog.count(*), 0::bigint, 0
  FROM app.message_sources s WHERE s.created_at >= v_t0 AND s.created_at < v_t1 GROUP BY s.source_kind
  UNION ALL
  SELECT 'source_origin'::text, s.origin, pg_catalog.count(*), 0::bigint, 0
  FROM app.message_sources s WHERE s.created_at >= v_t0 AND s.created_at < v_t1 GROUP BY s.origin
  UNION ALL
  SELECT 'feedback_rating'::text, CASE WHEN f.rating = 1 THEN 'up' ELSE 'down' END, pg_catalog.count(*), 0::bigint, 0
  FROM app.message_feedback f WHERE f.created_at >= v_t0 AND f.created_at < v_t1 GROUP BY 2
  UNION ALL
  SELECT 'feedback_category'::text, coalesce(f.category, 'none'), pg_catalog.count(*), 0::bigint, 0
  FROM app.message_feedback f
  WHERE f.rating = -1 AND f.created_at >= v_t0 AND f.created_at < v_t1 GROUP BY 2
  UNION ALL
  SELECT 'org_kind'::text, o.kind, pg_catalog.count(*), 0::bigint, 0
  FROM app.conversations c JOIN auth.organizations o ON o.id = c.org_id
  WHERE c.created_at >= v_t0 AND c.created_at < v_t1 GROUP BY o.kind;
END
$$;

REVOKE ALL ON FUNCTION app.admin_chat_report_daily(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_chat_report_breakdown(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_chat_report_daily(uuid, date, date) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_chat_report_breakdown(uuid, date, date) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_chat_report_daily(uuid, date, date) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_chat_report_breakdown(uuid, date, date) OWNER TO eda_sec_definer;
