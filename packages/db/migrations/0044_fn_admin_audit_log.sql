-- eda:kind fn
-- Yönetim yüzeyi Denetim modülü (053-ekranlar/11): denetim günlüğü görüntüleyici ve hata özeti okuma
-- fonksiyonları. Sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin. Aktör `support` veya
-- `super_admin` olmalı (yasaklı/askıda değil; izin tablosu `platform:audit_read`). Yalnız içeriksiz
-- alanlar döner: ip_trunc ve request_id DÖNMEZ; olay meta verisi yalnız beyaz listeli anahtarların
-- skaler (metin/sayı/mantıksal) değerleridir. Gün sınırı Europe/Istanbul, aralık en çok 93 gündür.
-- Hata günlüğü için ayrı tablo yoktur: kaynaklar ai_usage hataları, auth.login.failure olayları ve
-- başarısız e-posta teslimleridir.

GRANT SELECT (id, org_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at)
  ON app.audit_log TO eda_sec_definer;
GRANT SELECT (status, template_code, created_at) ON app.email_deliveries TO eda_sec_definer;

CREATE OR REPLACE FUNCTION app.admin_audit_list(
  p_actor_id uuid, p_action text, p_actor_type text, p_from date, p_to date,
  p_limit integer, p_cursor_at timestamptz, p_cursor_id uuid
)
RETURNS TABLE (
  event_id uuid, occurred_at timestamptz, cursor_key text, action text, actor_type text,
  actor_ref uuid, org_ref uuid, target_type text, target_ref text, safe_metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_keys text[] := ARRAY['reasonCode', 'kind', 'noteCode', 'amount', 'orgId', 'role', 'oldRole',
    'newRole', 'oldValue', 'newValue', 'status', 'count', 'code', 'scope'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('super_admin', 'support')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel denetim günlüğünü okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  IF (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'imleç geçersiz' USING ERRCODE = '22023';
  END IF;
  v_t0 := p_from::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_t1 := (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  RETURN QUERY
  SELECT l.id, l.created_at,
         pg_catalog.to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
         l.action, l.actor_type, l.actor_id, l.org_id, l.target_type, l.target_id,
         (SELECT coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            FROM pg_catalog.jsonb_each(l.metadata) e
           WHERE e.key = ANY (v_keys)
             AND pg_catalog.jsonb_typeof(e.value) IN ('string', 'number', 'boolean'))
  FROM app.audit_log l
  WHERE l.created_at >= v_t0 AND l.created_at < v_t1
    AND (p_action IS NULL OR l.action = p_action)
    AND (p_actor_type IS NULL OR l.actor_type = p_actor_type)
    AND (p_cursor_at IS NULL OR (l.created_at, l.id) < (p_cursor_at, p_cursor_id))
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 101);
END
$$;

-- Hata özeti: (kaynak, gün, tür anahtarı, sayı). Tür anahtarı kod benzeridir; serbest metin dönmez.
CREATE OR REPLACE FUNCTION app.admin_audit_error_summary(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (source text, day date, key text, n bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_t0 timestamptz;
  v_t1 timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role IN ('super_admin', 'support')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel hata özetini okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  v_t0 := p_from::timestamp AT TIME ZONE 'Europe/Istanbul';
  v_t1 := (p_to + 1)::timestamp AT TIME ZONE 'Europe/Istanbul';
  RETURN QUERY
  SELECT 'ai_usage'::text, (a.created_at AT TIME ZONE 'Europe/Istanbul')::date,
         a.status || ':' || CASE WHEN a.error_code ~ '^[A-Za-z0-9_.-]{1,48}$' THEN a.error_code ELSE 'other' END,
         pg_catalog.count(*)
  FROM app.ai_usage a
  WHERE a.created_at >= v_t0 AND a.created_at < v_t1 AND a.status IN ('error', 'timeout')
  GROUP BY 2, 3
  UNION ALL
  SELECT 'auth_failure'::text, (l.created_at AT TIME ZONE 'Europe/Istanbul')::date, l.action::text,
         pg_catalog.count(*)
  FROM app.audit_log l
  WHERE l.created_at >= v_t0 AND l.created_at < v_t1 AND l.action = 'auth.login.failure'
  GROUP BY 2, 3
  UNION ALL
  SELECT 'email_delivery'::text, (d.created_at AT TIME ZONE 'Europe/Istanbul')::date,
         CASE WHEN d.template_code ~ '^[A-Za-z0-9_.-]{1,48}$' THEN d.template_code ELSE 'other' END,
         pg_catalog.count(*)
  FROM app.email_deliveries d
  WHERE d.created_at >= v_t0 AND d.created_at < v_t1 AND d.status = 'failed'
  GROUP BY 2, 3;
END
$$;

REVOKE ALL ON FUNCTION app.admin_audit_list(uuid, text, text, date, date, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_audit_error_summary(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_audit_list(uuid, text, text, date, date, integer, timestamptz, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_audit_error_summary(uuid, date, date) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_audit_list(uuid, text, text, date, date, integer, timestamptz, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_audit_error_summary(uuid, date, date) OWNER TO eda_sec_definer;
