-- eda:kind fn
-- Yönetim paneli "Şablonlar", "Destek" ve "Veri seti" modülleri: okuma fonksiyonları ve destek talebi
-- durum değişikliği. Sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin. Okuma fonksiyonları
-- aktörü `support` veya `super_admin` (yasaklı/askıda değil) olarak doğrular; durum değişikliği yalnız
-- `super_admin` içindir. Hiçbir fonksiyon içerik dönmez: destek talebinin konu ve gövdesi, belge
-- şablonunun başlık ve gövdesi, kullanıcı/büro adı OKUNMAZ (yetki kolon düzeyindedir; KK-031-9).
-- Denetim kaydı: katalogda destek talebi için ayrı olay adı yoktur (002 §22 kapalı katalog); durum
-- değişikliği `system_setting.changed` olayı, `target_type = 'support_ticket'` ile yazılır. Katalog
-- genişleyince tek satır değişir (bkz. app.admin_set_support_ticket_status).

GRANT USAGE ON SCHEMA corpus TO eda_sec_definer;
GRANT SELECT (source, live_enabled, breaker_state, state, last_success_at, last_error_at,
  last_error_code, p95_ms, bucket_fill_pct, last_canary_at, last_canary_ok, updated_at)
  ON corpus.source_status TO eda_sec_definer;
GRANT SELECT (source, origin, withdrawn_at, retrieved_at) ON corpus.decisions TO eda_sec_definer;
GRANT SELECT (id, law_type, status, last_snapshot_at, last_amended_date) ON corpus.laws TO eda_sec_definer;
GRANT SELECT (id, law_id) ON corpus.law_articles TO eda_sec_definer;
GRANT SELECT (id, kind, source, status, items_seen, items_inserted, items_updated, items_failed,
  started_at, finished_at) ON corpus.ingestion_runs TO eda_sec_definer;

GRANT SELECT (id, org_id, user_id, category, priority, status, closed_at, created_at, updated_at)
  ON app.support_tickets TO eda_sec_definer;
GRANT UPDATE (status, closed_at, updated_at) ON app.support_tickets TO eda_sec_definer;
GRANT SELECT (id, org_id, kind, case_type_code, version, is_active, updated_at)
  ON app.templates TO eda_sec_definer;

-- Belge şablonları envanteri: yalnız platform şablonları (org_id NULL); başlık ve gövde dönmez.
CREATE OR REPLACE FUNCTION app.admin_document_templates(p_actor_id uuid)
RETURNS TABLE (
  template_id uuid, template_kind text, case_type_code text, template_version integer,
  is_active boolean, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel şablon envanterini okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.kind, t.case_type_code, t.version, t.is_active, t.updated_at
  FROM app.templates t
  WHERE t.org_id IS NULL
  ORDER BY t.kind, t.case_type_code NULLS FIRST, t.id;
END
$$;

-- Destek paneli sayaçları (tek satır).
CREATE OR REPLACE FUNCTION app.admin_support_counts(p_actor_id uuid)
RETURNS TABLE (
  pending_applications integer, oldest_pending_at timestamptz, suspended_users integer,
  suspended_orgs integer, unverified_emails integer, oldest_unverified_at timestamptz,
  tickets_open integer, tickets_in_progress integer, tickets_waiting integer,
  tickets_urgent integer, oldest_open_ticket_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel destek sayaçlarını okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'),
    (SELECT pg_catalog.min(p.submitted_at) FROM app.lawyer_profiles p
       JOIN auth.users u ON u.id = p.user_id
      WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'),
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND u.verification_status = 'suspended'),
    (SELECT pg_catalog.count(*)::integer FROM auth.organizations o WHERE o.suspended_at IS NOT NULL),
    (SELECT pg_catalog.count(*)::integer FROM auth.users u
      WHERE u.platform_role = 'user' AND NOT u.email_verified),
    (SELECT pg_catalog.min(u.created_at) FROM auth.users u
      WHERE u.platform_role = 'user' AND NOT u.email_verified),
    (SELECT pg_catalog.count(*)::integer FROM app.support_tickets s WHERE s.status = 'open'),
    (SELECT pg_catalog.count(*)::integer FROM app.support_tickets s WHERE s.status = 'in_progress'),
    (SELECT pg_catalog.count(*)::integer FROM app.support_tickets s WHERE s.status = 'waiting'),
    (SELECT pg_catalog.count(*)::integer FROM app.support_tickets s
      WHERE s.status <> 'closed' AND s.priority = 'urgent'),
    (SELECT pg_catalog.min(s.created_at) FROM app.support_tickets s WHERE s.status <> 'closed');
END
$$;

-- Toplulaştırılmış iş listesi: bekleyen başvurular, askıdaki hesaplar, doğrulama bekleyen e-postalar.
-- Her tür için en eski `p_limit` satır (kimlik, e-posta, durum, zaman; içerik yok).
CREATE OR REPLACE FUNCTION app.admin_support_worklist(p_actor_id uuid, p_limit integer)
RETURNS TABLE (
  item_kind text, ref_id uuid, party_email text, item_status text, since_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 10), 1), 50);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel iş listesini okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  (SELECT 'pending_application'::text, u.id, u.email::text, u.verification_status::text,
          coalesce(p.submitted_at, u.created_at)
   FROM auth.users u
   LEFT JOIN app.lawyer_profiles p ON p.user_id = u.id
   WHERE u.platform_role = 'user' AND u.verification_status = 'pending_verification'
   ORDER BY coalesce(p.submitted_at, u.created_at), u.id
   LIMIT v_limit)
  UNION ALL
  (SELECT 'suspended_user'::text, u.id, u.email::text, u.verification_status::text, u.created_at
   FROM auth.users u
   WHERE u.platform_role = 'user' AND u.verification_status = 'suspended'
   ORDER BY u.created_at, u.id
   LIMIT v_limit)
  UNION ALL
  (SELECT 'unverified_email'::text, u.id, u.email::text, u.verification_status::text, u.created_at
   FROM auth.users u
   WHERE u.platform_role = 'user' AND NOT u.email_verified
   ORDER BY u.created_at, u.id
   LIMIT v_limit);
END
$$;

-- Destek talebi kuyruğu: yalnız meta veri (kategori, öncelik, durum, zaman, büro türü, talep eden
-- e-postası). Konu ve gövde DÖNMEZ. `p_status` NULL ise kapalı olmayanlar.
CREATE OR REPLACE FUNCTION app.admin_list_support_tickets(
  p_actor_id uuid, p_status text, p_limit integer, p_before timestamptz
)
RETURNS TABLE (
  ticket_id uuid, org_ref uuid, org_kind text, requester_email text, category text, priority text,
  ticket_status text, created_at timestamptz, updated_at timestamptz, closed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel destek kuyruğunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'in_progress', 'waiting', 'closed') THEN
    RAISE EXCEPTION 'durum open, in_progress, waiting veya closed olmalı' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT s.id, s.org_id, o.kind::text, u.email::text, s.category, s.priority, s.status,
         s.created_at, s.updated_at, s.closed_at
  FROM app.support_tickets s
  JOIN auth.organizations o ON o.id = s.org_id
  LEFT JOIN auth.users u ON u.id = s.user_id
  WHERE (p_status IS NULL AND s.status <> 'closed' OR s.status = p_status)
    AND (p_before IS NULL OR s.created_at < p_before)
  ORDER BY CASE WHEN s.priority = 'urgent' THEN 0 WHEN s.priority = 'high' THEN 1 ELSE 2 END,
           s.created_at DESC, s.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 100);
END
$$;

-- Destek talebi durum değişikliği (yalnız super_admin). Denetim satırı aynı işlemde; içerik yok.
CREATE OR REPLACE FUNCTION app.admin_set_support_ticket_status(
  p_actor_id uuid, p_ticket_id uuid, p_status text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_old text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici destek talebi durumunu değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'waiting', 'closed') THEN
    RAISE EXCEPTION 'durum open, in_progress, waiting veya closed olmalı' USING ERRCODE = '22023';
  END IF;
  SELECT s.status INTO v_old FROM app.support_tickets s WHERE s.id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'destek talebi bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_old = p_status THEN
    RAISE EXCEPTION 'talep zaten bu durumda' USING ERRCODE = '55000';
  END IF;
  UPDATE app.support_tickets
  SET status = p_status, updated_at = v_now,
      closed_at = CASE WHEN p_status = 'closed' THEN v_now ELSE NULL END
  WHERE id = p_ticket_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'support_ticket',
    p_ticket_id::text, NULL, pg_catalog.jsonb_build_object('from', v_old, 'to', p_status));
  RETURN p_status;
END
$$;

-- Veri seti: kaynak başına karar sayısı ve kaynak durumu. Kaynak kümesi `source_status` ile `decisions`
-- birleşimidir (kaynağı olup satırı olmayan veya tersi de görünür).
CREATE OR REPLACE FUNCTION app.admin_dataset_sources(p_actor_id uuid)
RETURNS TABLE (
  source text, live_enabled boolean, source_state text, breaker_state text,
  last_success_at timestamptz, last_error_at timestamptz, last_error_code text, p95_ms integer,
  bucket_fill_pct integer, last_canary_at timestamptz, last_canary_ok boolean,
  status_updated_at timestamptz, decision_count bigint, corpus_count bigint, live_count bigint,
  withdrawn_count bigint, last_retrieved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel veri seti durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH dec AS (
    SELECT d.source,
           pg_catalog.count(*) AS total,
           pg_catalog.count(*) FILTER (WHERE d.origin = 'corpus') AS from_corpus,
           pg_catalog.count(*) FILTER (WHERE d.origin = 'live') AS from_live,
           pg_catalog.count(*) FILTER (WHERE d.withdrawn_at IS NOT NULL) AS withdrawn,
           pg_catalog.max(d.retrieved_at) AS last_retrieved
    FROM corpus.decisions d
    GROUP BY d.source
  ),
  codes AS (
    SELECT st.source FROM corpus.source_status st
    UNION
    SELECT dec.source FROM dec
  )
  SELECT c.source, coalesce(st.live_enabled, false), st.state, st.breaker_state,
         st.last_success_at, st.last_error_at, st.last_error_code, st.p95_ms, st.bucket_fill_pct,
         st.last_canary_at, st.last_canary_ok, st.updated_at,
         coalesce(dec.total, 0), coalesce(dec.from_corpus, 0), coalesce(dec.from_live, 0),
         coalesce(dec.withdrawn, 0), dec.last_retrieved
  FROM codes c
  LEFT JOIN corpus.source_status st ON st.source = c.source
  LEFT JOIN dec ON dec.source = c.source
  ORDER BY c.source;
END
$$;

-- Veri seti: mevzuat özeti (tür başına kanun, madde ve son anlık görüntü).
CREATE OR REPLACE FUNCTION app.admin_dataset_legislation(p_actor_id uuid)
RETURNS TABLE (
  law_type text, law_count bigint, in_force_count bigint, repealed_count bigint,
  article_count bigint, last_snapshot_at timestamptz, last_amended_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel veri seti durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.law_type,
         pg_catalog.count(*),
         pg_catalog.count(*) FILTER (WHERE l.status = 'in_force'),
         pg_catalog.count(*) FILTER (WHERE l.status = 'repealed'),
         (SELECT pg_catalog.count(*) FROM corpus.law_articles la
           JOIN corpus.laws l2 ON l2.id = la.law_id WHERE l2.law_type = l.law_type),
         pg_catalog.max(l.last_snapshot_at),
         pg_catalog.max(l.last_amended_date)
  FROM corpus.laws l
  GROUP BY l.law_type
  ORDER BY l.law_type;
END
$$;

-- Veri seti: son alım (ingestion) çalıştırmaları. Hata ayrıntısı (error_summary) OKUNMAZ.
CREATE OR REPLACE FUNCTION app.admin_dataset_runs(p_actor_id uuid, p_limit integer)
RETURNS TABLE (
  run_id uuid, run_kind text, source text, run_status text, items_seen integer,
  items_inserted integer, items_updated integer, items_failed integer, started_at timestamptz,
  finished_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel veri seti durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.kind, r.source, r.status, r.items_seen, r.items_inserted, r.items_updated,
         r.items_failed, r.started_at, r.finished_at
  FROM corpus.ingestion_runs r
  ORDER BY r.started_at DESC, r.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 100);
END
$$;

REVOKE ALL ON FUNCTION app.admin_document_templates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_support_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_support_worklist(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_list_support_tickets(uuid, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_set_support_ticket_status(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_dataset_sources(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_dataset_legislation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_dataset_runs(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_document_templates(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_support_counts(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_support_worklist(uuid, integer) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_list_support_tickets(uuid, text, integer, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_set_support_ticket_status(uuid, uuid, text) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_dataset_sources(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_dataset_legislation(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_dataset_runs(uuid, integer) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_document_templates(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_support_counts(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_support_worklist(uuid, integer) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_list_support_tickets(uuid, text, integer, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_set_support_ticket_status(uuid, uuid, text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_dataset_sources(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_dataset_legislation(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_dataset_runs(uuid, integer) OWNER TO eda_sec_definer;
