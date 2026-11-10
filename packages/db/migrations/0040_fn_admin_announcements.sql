-- eda:kind fn
-- P27 yönetim paneli "Duyurular ve bildirimler" (053-ekranlar/11; 041 §9.11; 030 `app.announcements`):
-- duyuru yönetimi ve bildirim gönderim özeti. Yeni tablo YOK: `app.announcements` (sınıf K, katalog)
-- 0012/0013'te vardır; yönetim yazması yalnız bu SECURITY DEFINER fonksiyonlarındandır (eda_app yalnız
-- SELECT). Sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin. Aktör `p_actor_id` her çağrıda
-- veritabanında doğrulanır: okuma `support|super_admin`, yazma `super_admin` (banned/askıda değil).
-- Her yazma aynı işlemde `audit_log` satırı üretir (içerik YOK: yalnız işlem, ciddiyet, hedef kitle).
-- Denetim olayı: katalogda duyuru olayı yoktur (053 Açık Soru 6); `system_setting.changed` olayı
-- `metadata.scope = 'announcement'` ile yazılır, katalog CHECK'i değişmez. Dönüş kolon adları içerik
-- listesinde olmamalı (başlık `headline`, metin `message_text`).

GRANT SELECT (id, severity, audience, title, body, active_during, created_at, updated_at)
  ON app.announcements TO eda_sec_definer;
GRANT INSERT (severity, audience, title, body, active_during, created_by)
  ON app.announcements TO eda_sec_definer;
GRANT UPDATE (severity, audience, title, body, active_during) ON app.announcements TO eda_sec_definer;
GRANT SELECT (type, read_at, created_at) ON app.notifications TO eda_sec_definer;

-- Duyuru listesi: en yeniden eskiye; durum veritabanı saatiyle (`scheduled|active|ended`).
CREATE OR REPLACE FUNCTION app.admin_list_announcements(
  p_actor_id uuid, p_limit integer, p_before timestamptz
)
RETURNS TABLE (
  announcement_id uuid, severity text, audience text, headline text, message_text text,
  active_from timestamptz, active_until timestamptz, state text,
  created_at timestamptz, updated_at timestamptz
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
    RAISE EXCEPTION 'yalnız personel duyuruları listeleyebilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.id, n.severity, n.audience, n.title, n.body,
         coalesce(pg_catalog.lower(n.active_during), n.created_at),
         pg_catalog.upper(n.active_during),
         CASE WHEN pg_catalog.isempty(n.active_during)
                   OR pg_catalog.upper(n.active_during) <= pg_catalog.now() THEN 'ended'
              WHEN pg_catalog.lower(n.active_during) > pg_catalog.now() THEN 'scheduled'
              ELSE 'active' END,
         n.created_at, n.updated_at
  FROM app.announcements n
  WHERE p_before IS NULL OR n.created_at < p_before
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 25), 1), 100);
END
$$;

-- Yayımla: `p_from` NULL ise şimdi; `p_until` NULL ise süresiz. Dönüş: duyuru kimliği.
CREATE OR REPLACE FUNCTION app.admin_publish_announcement(
  p_actor_id uuid, p_severity text, p_audience text, p_headline text, p_message text,
  p_from timestamptz, p_until timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_from timestamptz;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici duyuru yayımlayabilir' USING ERRCODE = '42501';
  END IF;
  IF p_severity IS NULL OR p_severity NOT IN ('info', 'warning', 'critical')
     OR p_audience IS NULL OR p_audience NOT IN ('all', 'org_admins') THEN
    RAISE EXCEPTION 'ciddiyet veya hedef kitle geçersiz' USING ERRCODE = '22023';
  END IF;
  IF p_headline IS NULL OR pg_catalog.char_length(p_headline) NOT BETWEEN 1 AND 120
     OR p_message IS NULL OR pg_catalog.char_length(p_message) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'başlık 1-120, metin 1-1000 karakter olmalı' USING ERRCODE = '22023';
  END IF;
  v_from := coalesce(p_from, v_now);
  IF p_until IS NOT NULL AND p_until <= v_from THEN
    RAISE EXCEPTION 'bitiş başlangıçtan sonra olmalı' USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.announcements (severity, audience, title, body, active_during, created_by)
  VALUES (p_severity, p_audience, p_headline, p_message,
          pg_catalog.tstzrange(v_from, p_until, '[)'), p_actor_id)
  RETURNING id INTO v_id;

  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'announcement', v_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'announcement', 'op', 'published',
                                  'severity', p_severity, 'audience', p_audience));
  RETURN v_id;
END
$$;

-- Düzenle (kısmi): NULL = değişmez; bitiş için `p_set_until` açıkça verilir (NULL bitiş = süresiz).
-- Biten duyuru düzenlenemez (55000); yoksa P0002.
CREATE OR REPLACE FUNCTION app.admin_update_announcement(
  p_actor_id uuid, p_id uuid, p_severity text, p_audience text, p_headline text, p_message text,
  p_from timestamptz, p_set_until boolean, p_until timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_range tstzrange;
  v_from timestamptz;
  v_until timestamptz;
  v_fields text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici duyuru düzenleyebilir' USING ERRCODE = '42501';
  END IF;
  IF (p_severity IS NOT NULL AND p_severity NOT IN ('info', 'warning', 'critical'))
     OR (p_audience IS NOT NULL AND p_audience NOT IN ('all', 'org_admins'))
     OR (p_headline IS NOT NULL AND pg_catalog.char_length(p_headline) NOT BETWEEN 1 AND 120)
     OR (p_message IS NOT NULL AND pg_catalog.char_length(p_message) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'alan değeri geçersiz' USING ERRCODE = '22023';
  END IF;

  SELECT n.active_during INTO v_range FROM app.announcements n WHERE n.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'duyuru bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.isempty(v_range) OR pg_catalog.upper(v_range) <= v_now THEN
    RAISE EXCEPTION 'biten duyuru düzenlenemez' USING ERRCODE = '55000';
  END IF;

  v_from := coalesce(p_from, pg_catalog.lower(v_range));
  v_until := CASE WHEN p_set_until THEN p_until ELSE pg_catalog.upper(v_range) END;
  IF v_until IS NOT NULL AND v_until <= v_from THEN
    RAISE EXCEPTION 'bitiş başlangıçtan sonra olmalı' USING ERRCODE = '22023';
  END IF;

  UPDATE app.announcements
  SET severity = coalesce(p_severity, severity),
      audience = coalesce(p_audience, audience),
      title = coalesce(p_headline, title),
      body = coalesce(p_message, body),
      active_during = pg_catalog.tstzrange(v_from, v_until, '[)')
  WHERE id = p_id;

  IF p_severity IS NOT NULL THEN v_fields := pg_catalog.array_append(v_fields, 'severity'); END IF;
  IF p_audience IS NOT NULL THEN v_fields := pg_catalog.array_append(v_fields, 'audience'); END IF;
  IF p_headline IS NOT NULL THEN v_fields := pg_catalog.array_append(v_fields, 'title'); END IF;
  IF p_message IS NOT NULL THEN v_fields := pg_catalog.array_append(v_fields, 'body'); END IF;
  IF p_from IS NOT NULL THEN v_fields := pg_catalog.array_append(v_fields, 'activeFrom'); END IF;
  IF p_set_until THEN v_fields := pg_catalog.array_append(v_fields, 'activeUntil'); END IF;

  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'announcement', p_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'announcement', 'op', 'updated',
                                  'fields', pg_catalog.to_jsonb(v_fields)));
  RETURN p_id;
END
$$;

-- Yayından kaldır: etkinse bitişi şimdiye çeker; zamanlanmışsa aralığı boşaltır (`ended`).
CREATE OR REPLACE FUNCTION app.admin_withdraw_announcement(p_actor_id uuid, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_range tstzrange;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici duyuru kaldırabilir' USING ERRCODE = '42501';
  END IF;
  SELECT n.active_during INTO v_range FROM app.announcements n WHERE n.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'duyuru bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.isempty(v_range) OR pg_catalog.upper(v_range) <= v_now THEN
    RAISE EXCEPTION 'duyuru zaten bitmiş' USING ERRCODE = '55000';
  END IF;
  UPDATE app.announcements
  SET active_during = CASE WHEN pg_catalog.lower(v_range) > v_now
                           THEN 'empty'::tstzrange
                           ELSE pg_catalog.tstzrange(pg_catalog.lower(v_range), v_now, '[)') END
  WHERE id = p_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'system_setting.changed', 'announcement', p_id::text, NULL,
    pg_catalog.jsonb_build_object('scope', 'announcement', 'op', 'withdrawn'));
  RETURN p_id;
END
$$;

-- Bildirim gönderim özeti: tür başına gönderilen/okunan sayısı (Europe/Istanbul gün sınırı; en çok 93 gün).
-- Alıcı, büro, yük veya zaman damgası satırı DÖNMEZ.
CREATE OR REPLACE FUNCTION app.admin_notification_summary(p_actor_id uuid, p_from date, p_to date)
RETURNS TABLE (notification_type text, sent_count bigint, read_count bigint)
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
                 WHERE a.id = p_actor_id AND a.platform_role IN ('support', 'super_admin')
                   AND NOT a.banned AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız personel bildirim özetini okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'tarih aralığı geçersiz (en çok 93 gün)' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT x.type, pg_catalog.count(*), pg_catalog.count(x.read_at)
  FROM app.notifications x
  WHERE x.created_at >= v_t0 AND x.created_at < v_t1
  GROUP BY x.type
  ORDER BY x.type;
END
$$;

REVOKE ALL ON FUNCTION app.admin_list_announcements(uuid, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_publish_announcement(uuid, text, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_update_announcement(uuid, uuid, text, text, text, text, timestamptz, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_withdraw_announcement(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_notification_summary(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_list_announcements(uuid, integer, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_publish_announcement(uuid, text, text, text, text, timestamptz, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_update_announcement(uuid, uuid, text, text, text, text, timestamptz, boolean, timestamptz) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_withdraw_announcement(uuid, uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_notification_summary(uuid, date, date) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_list_announcements(uuid, integer, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_publish_announcement(uuid, text, text, text, text, timestamptz, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_update_announcement(uuid, uuid, text, text, text, text, timestamptz, boolean, timestamptz) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_withdraw_announcement(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_notification_summary(uuid, date, date) OWNER TO eda_sec_definer;
