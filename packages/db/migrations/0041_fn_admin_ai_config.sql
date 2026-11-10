-- eda:kind fn
-- Yönetim paneli "Yapay zekâ" modülü (053-ekranlar/11; platform:ai_catalog_read/write): sağlayıcı ve
-- model kataloğunun salt okur görünümü, son 7 günün çağrı/hata özeti ve model etkin/pasif anahtarı.
-- Sahibi eda_sec_definer, EXECUTE yalnız eda_readonly_admin. Aktör her çağrıda `p_actor_id ->
-- platform_role = 'super_admin'` (yasaklı/askıda değil) ile doğrulanır. Yalnız katalog meta verisi ve
-- toplulaştırılmış sayaç döner (içerik YOK). Veri sınıfı izinleri (`allowed_data_classes`) bu
-- fonksiyonlarla DEĞİŞTİRİLEMEZ: yazma yalnız `ai_models.enabled` kolonudur .

GRANT SELECT (id, kind, region, transfer_basis, allowed_data_classes, secret_ref, training_use,
  human_review, retention_days, enabled, priority) ON app.ai_providers TO eda_sec_definer;
GRANT SELECT (id, alias, provider_id, label, thinking, max_output_tokens, context_budget,
  capabilities, priority, enabled, eval_gate_passed_at) ON app.ai_models TO eda_sec_definer;
GRANT UPDATE (enabled, updated_at) ON app.ai_models TO eda_sec_definer;

CREATE OR REPLACE FUNCTION app.admin_ai_providers(p_actor_id uuid)
RETURNS TABLE (
  id text, kind text, region text, transfer_basis text, allowed_data_classes text[],
  secret_ref text, training_use boolean, human_review boolean, retention_days integer,
  enabled boolean, priority integer
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
    RAISE EXCEPTION 'yalnız süper yönetici sağlayıcı kataloğunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.kind, p.region, p.transfer_basis, p.allowed_data_classes, p.secret_ref,
         p.training_use, p.human_review, p.retention_days, p.enabled, p.priority
  FROM app.ai_providers p
  ORDER BY p.priority DESC, p.id;
END
$$;

CREATE OR REPLACE FUNCTION app.admin_ai_models(p_actor_id uuid)
RETURNS TABLE (
  id uuid, alias text, provider_id text, label text, thinking text, max_output_tokens integer,
  context_budget integer, capabilities jsonb, priority integer, enabled boolean,
  eval_gate_passed_at timestamptz
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
    RAISE EXCEPTION 'yalnız süper yönetici model kataloğunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.id, m.alias, m.provider_id, m.label, m.thinking, m.max_output_tokens, m.context_budget,
         m.capabilities, m.priority, m.enabled, m.eval_gate_passed_at
  FROM app.ai_models m
  ORDER BY m.alias, m.priority, m.provider_id;
END
$$;

-- Model başına son p_days gün (1..30) çağrı/hata sayısı ve ortalama gecikme (kullanıcı/büro kırılımı yok).
CREATE OR REPLACE FUNCTION app.admin_ai_usage(p_actor_id uuid, p_days integer)
RETURNS TABLE (
  model_alias text, provider_id text, calls bigint, errors bigint, avg_latency_ms integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_since timestamptz := pg_catalog.now()
    - pg_catalog.make_interval(days => LEAST(GREATEST(coalesce(p_days, 7), 1), 30));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici model kullanımını okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT u.model_alias, u.provider_id, pg_catalog.count(*),
         pg_catalog.count(*) FILTER (WHERE u.status <> 'success'),
         pg_catalog.round(pg_catalog.avg(u.latency_ms))::integer
  FROM app.ai_usage u
  WHERE u.created_at >= v_since
  GROUP BY u.model_alias, u.provider_id
  ORDER BY u.model_alias, u.provider_id;
END
$$;

-- Model etkin/pasif anahtarı. Dönüş: durum değişti mi (aynı değer: false, denetim yazılmaz).
-- Kurallar: pasif sağlayıcının modeli etkinleştirilemez; bir takma adın etkin sağlayıcıdaki SON
-- etkin modeli pasifleştirilemez (sohbet çözümlemesi kırılmasın). Veri sınıfı kolonlarına dokunulmaz.
CREATE OR REPLACE FUNCTION app.admin_set_ai_model_enabled(
  p_actor_id uuid, p_model_id uuid, p_enabled boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_alias text;
  v_provider text;
  v_current boolean;
  v_provider_enabled boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici model durumunu değiştirebilir' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled boş olamaz' USING ERRCODE = '22023';
  END IF;
  SELECT m.alias, m.provider_id, m.enabled INTO v_alias, v_provider, v_current
  FROM app.ai_models m WHERE m.id = p_model_id
  FOR UPDATE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'model bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_current = p_enabled THEN
    RETURN false;
  END IF;
  SELECT p.enabled INTO v_provider_enabled FROM app.ai_providers p WHERE p.id = v_provider;
  IF p_enabled AND NOT coalesce(v_provider_enabled, false) THEN
    RAISE EXCEPTION 'sağlayıcı pasif: önce sağlayıcı etkinleştirilmeli' USING ERRCODE = '55000';
  END IF;
  IF NOT p_enabled AND NOT EXISTS (
       SELECT 1 FROM app.ai_models o JOIN app.ai_providers op ON op.id = o.provider_id
       WHERE o.alias = v_alias AND o.id <> p_model_id AND o.enabled AND op.enabled) THEN
    RAISE EXCEPTION 'takma adın son etkin modeli pasifleştirilemez' USING ERRCODE = '55000';
  END IF;
  UPDATE app.ai_models SET enabled = p_enabled, updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_model_id;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (NULL, 'platform_staff', p_actor_id, 'ai_model.changed', 'ai_model', p_model_id::text, NULL,
    pg_catalog.jsonb_build_object('alias', v_alias, 'providerId', v_provider,
      'enabled', p_enabled, 'previous', v_current));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION app.admin_ai_providers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_models(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_usage(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_set_ai_model_enabled(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_ai_providers(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_models(uuid) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_ai_usage(uuid, integer) TO eda_readonly_admin;
GRANT EXECUTE ON FUNCTION app.admin_set_ai_model_enabled(uuid, uuid, boolean) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_ai_providers(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_models(uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_ai_usage(uuid, integer) OWNER TO eda_sec_definer;
ALTER FUNCTION app.admin_set_ai_model_enabled(uuid, uuid, boolean) OWNER TO eda_sec_definer;
