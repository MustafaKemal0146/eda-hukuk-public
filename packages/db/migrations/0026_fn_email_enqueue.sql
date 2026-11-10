-- eda:kind fn
-- P04a (045 §6.2, §13.3; 002 §9 "Kimlik ve e-posta fonksiyonları"): e-posta outbox yazıcısı ve
-- worker yönlendirme okuması. Sahibi eda_sec_definer (BYPASSRLS, NOLOGIN), search_path sabit, PUBLIC'e
-- EXECUTE yok. app.email_deliveries'e doğrudan INSERT/UPDATE yetkisi eda_app'te YOKTUR; tek yazma
-- yolu bu fonksiyondur. `params` serbest metin taşımaz (Zod .strict uygulama katmanında); sır
-- yalnız `p_sealed` (AEAD) ile gelir.

GRANT SELECT (id, org_id, user_id, dedupe_key) ON app.email_deliveries TO eda_sec_definer;
GRANT INSERT (id, org_id, user_id, invitation_id, kind, template_code, template_version, class, dedupe_key, params, sealed_params, expires_at) ON app.email_deliveries TO eda_sec_definer;

-- Outbox kaydı: dedupe_key çakışmasında NULL (çift üretim yok). eda_app oturumu yalnız kendi kullanıcı
-- bağı (app.user_id) ve (verildiyse) aktif büro bağı için kayıt açabilir (aktör sahteciliği önlemi).
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
  -- p_id: mühür AAD'si teslimat kimliğine bağlı olduğundan (045 §6.2 madde 3) kimliği çağıran
  -- önceden üretebilir; verilmezse uuidv7() varsayılanı kullanılır.
  INSERT INTO app.email_deliveries (id, org_id, user_id, invitation_id, kind, template_code,
    template_version, class, dedupe_key, params, sealed_params, expires_at)
  VALUES (coalesce(p_id, uuidv7()), p_org_id, p_user_id, p_invitation_id, p_kind, p_template,
    p_template_version, p_class, p_dedupe_key, v_params, p_sealed, p_expires_at)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- email.send işleyicisi satırı alıcı bağlamında (withUserScope / withTenant) okur; bağ için yalnız
-- kimlikler döner (içerik, durum, parametre yok). Yalnız eda_worker.
CREATE OR REPLACE FUNCTION app.email_delivery_route(p_id uuid)
RETURNS TABLE (user_id uuid, org_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT d.user_id, d.org_id FROM app.email_deliveries d WHERE d.id = p_id $$;

REVOKE ALL ON FUNCTION app.email_enqueue(text, text, text, text, uuid, uuid, uuid, text, jsonb, bytea, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.email_delivery_route(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.email_enqueue(text, text, text, text, uuid, uuid, uuid, text, jsonb, bytea, timestamptz, uuid)
  TO eda_app, eda_worker, eda_jobs;
GRANT EXECUTE ON FUNCTION app.email_delivery_route(uuid) TO eda_worker;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.email_enqueue(text, text, text, text, uuid, uuid, uuid, text, jsonb, bytea, timestamptz, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.email_delivery_route(uuid) OWNER TO eda_sec_definer;
