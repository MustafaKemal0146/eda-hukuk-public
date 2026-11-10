-- eda:kind fn
-- L6 (032 §2.1; 031 §8.1): uygulama SECURITY DEFINER fonksiyonları; sahibi eda_sec_definer
-- (BYPASSRLS, NOLOGIN), search_path sabit, adlar tam nitelikli, PUBLIC'e EXECUTE yok. Kiracı ve
-- aktör bilgisi parametreden DEĞİL oturum bağından okunur (sahtecilik önlenir). Sahip rol yalnız
-- fonksiyonların gerektirdiği kolon yetkilerini alır (manifest grants.eda_sec_definer; E5 denetler).
-- Kapsam: audit_append, transfer_member_content, org_audit_seals, validate_partner_code. Diğerleri
-- (email_enqueue P04a, billing_*/redeem_coupon P25, admin_* P27) kendi promptlarındadır.

-- Fonksiyonların ihtiyacı kadar kolon yetkisi (031 §8).
GRANT SELECT (id) ON app.audit_log TO eda_sec_definer;
GRANT INSERT (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata) ON app.audit_log TO eda_sec_definer;
GRANT SELECT (id, chain_key, org_id, period_start, period_end, row_count, merkle_root, prev_seal_hash, seal_hash, published_object_key, published_at) ON app.audit_seals TO eda_sec_definer;
GRANT SELECT (id, org_id, user_id, case_id) ON app.calendar_events TO eda_sec_definer;
GRANT UPDATE (user_id) ON app.calendar_events TO eda_sec_definer;
GRANT SELECT (org_id, case_id, user_id) ON app.case_members TO eda_sec_definer;
GRANT INSERT (org_id, case_id, user_id, added_by) ON app.case_members TO eda_sec_definer;
GRANT SELECT (id, org_id, visibility, created_by) ON app.cases TO eda_sec_definer;
GRANT SELECT (id, org_id, user_id, case_id) ON app.conversations TO eda_sec_definer;
GRANT UPDATE (user_id) ON app.conversations TO eda_sec_definer;
GRANT SELECT (id, org_id, owner_id, case_id) ON app.documents TO eda_sec_definer;
GRANT UPDATE (owner_id) ON app.documents TO eda_sec_definer;
GRANT SELECT (code, is_active) ON app.partners TO eda_sec_definer;
GRANT SELECT (id, org_id, scope, owner_user_id) ON app.prompt_library TO eda_sec_definer;
GRANT UPDATE (owner_user_id) ON app.prompt_library TO eda_sec_definer;
GRANT SELECT (organization_id, user_id, status) ON auth.members TO eda_sec_definer;

-- Denetim yazıcısı (031 §8.1; KK-031-12): tek yazma yolu. 'org' kapsamında büro ve aktör YALNIZ
-- oturum bağından; 'platform' kapsamında org_id NULL, aktör yoksa actor_type = 'system'. Olay
-- kodu audit_log_action_chk ile (AUDIT_ACTIONS) doğrulanır: katalog dışı olay 23514.
CREATE OR REPLACE FUNCTION app.audit_append(
  p_action text, p_scope text, p_target_type text, p_target_id text, p_metadata jsonb,
  p_ip_trunc text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_actor uuid := app.current_user_id();
  v_type text;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_id uuid;
BEGIN
  IF p_scope = 'org' THEN
    v_org := app.current_org_id();
    IF v_org IS NULL OR v_actor IS NULL OR app.member_role() IS NULL THEN
      RAISE EXCEPTION 'büro denetim kaydı için geçerli kiracı bağı gerekir' USING ERRCODE = '42501';
    END IF;
    v_type := 'user';
  ELSIF p_scope = 'platform' THEN
    v_org := NULL;
    v_type := CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END;
  ELSE
    RAISE EXCEPTION 'geçersiz denetim kapsamı: %', p_scope USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(v_meta) <> 'object' THEN
    RAISE EXCEPTION 'denetim meta verisi nesne olmalı' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.pg_column_size(v_meta) > 2048 THEN
    RAISE EXCEPTION 'denetim meta verisi 2048 baytı aşıyor' USING ERRCODE = '22001';
  END IF;
  INSERT INTO app.audit_log (org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, metadata)
  VALUES (v_org, v_type, v_actor, p_action, p_target_type, p_target_id, p_ip_trunc::inet, v_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Üye içeriği devri (031 §8.1, §6.4; KK-031-13): OA + aktif bağ. Sohbetler, davasız belgeler, kişisel
-- istemler ve davasız takvim etkinlikleri hedefe geçer (davasız süre approved_by kaydı değişmez);
-- kaynağın ekibinde olduğu veya oluşturduğu kısıtlı davaların ekibine hedef eklenir.
CREATE OR REPLACE FUNCTION app.transfer_member_content(p_from_user uuid, p_to_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid := app.current_org_id();
  v_role text := app.member_role();
  v_n integer;
  v_total integer := 0;
BEGIN
  IF v_org IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'içerik devri yalnız büro sahibi veya yöneticisi tarafından yapılabilir'
      USING ERRCODE = '42501';
  END IF;
  IF p_from_user IS NULL OR p_to_user IS NULL OR p_from_user = p_to_user THEN
    RAISE EXCEPTION 'devreden ve devralan farklı kullanıcılar olmalı' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.members m
                 WHERE m.organization_id = v_org AND m.user_id = p_from_user) THEN
    RAISE EXCEPTION 'devreden kullanıcı bu büronun üyesi değil' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.members m
                 WHERE m.organization_id = v_org AND m.user_id = p_to_user AND m.status = 'active') THEN
    RAISE EXCEPTION 'devralan kullanıcı bu büronun aktif üyesi değil' USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.case_members (org_id, case_id, user_id, added_by)
  SELECT v_org, c.id, p_to_user, app.current_user_id()
  FROM app.cases c
  WHERE c.org_id = v_org AND c.visibility = 'restricted'
    AND (c.created_by = p_from_user
         OR EXISTS (SELECT 1 FROM app.case_members cm
                    WHERE cm.org_id = v_org AND cm.case_id = c.id AND cm.user_id = p_from_user))
  ON CONFLICT (org_id, case_id, user_id) DO NOTHING;

  UPDATE app.conversations SET user_id = p_to_user
  WHERE org_id = v_org AND user_id = p_from_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  UPDATE app.documents SET owner_id = p_to_user
  WHERE org_id = v_org AND owner_id = p_from_user AND case_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  UPDATE app.prompt_library SET owner_user_id = p_to_user
  WHERE org_id = v_org AND scope = 'user' AND owner_user_id = p_from_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  UPDATE app.calendar_events SET user_id = p_to_user
  WHERE org_id = v_org AND user_id = p_from_user AND case_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  PERFORM app.audit_append('org.conversations.transferred', 'org', 'user', p_from_user::text,
    pg_catalog.jsonb_build_object('toUserId', p_to_user, 'count', v_total), NULL);
  RETURN v_total;
END
$$;

-- Büronun mühür başları (031 §8.1): yalnız OA, yalnız mevcut büronun zinciri.
CREATE OR REPLACE FUNCTION app.org_audit_seals(p_from date, p_to date)
RETURNS TABLE (
  id uuid, period_start timestamptz, period_end timestamptz, row_count integer,
  merkle_root bytea, prev_seal_hash bytea, seal_hash bytea, published_object_key text,
  published_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid := app.current_org_id();
BEGIN
  IF v_org IS NULL OR app.member_role() IS NULL OR app.member_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'mühür kayıtları yalnız büro sahibi veya yöneticisine açıktır'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.period_start, s.period_end, s.row_count, s.merkle_root, s.prev_seal_hash,
           s.seal_hash, s.published_object_key, s.published_at
    FROM app.audit_seals s
    WHERE s.chain_key = v_org::text
      AND s.period_start >= p_from::timestamptz
      AND s.period_start < (p_to + 1)::timestamptz
    ORDER BY s.period_start;
END
$$;

-- Bayi kodu doğrulama (031 §8.1): withNoTenant('catalog'); yalnız var/yok, bayi bilgisi döndürmez.
CREATE OR REPLACE FUNCTION app.validate_partner_code(p_code text) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM app.partners p WHERE p.code = p_code AND p.is_active) $$;

REVOKE ALL ON FUNCTION app.audit_append(text, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.transfer_member_content(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.org_audit_seals(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.validate_partner_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_append(text, text, text, text, jsonb, text)
  TO eda_app, eda_worker, eda_jobs;
GRANT EXECUTE ON FUNCTION app.transfer_member_content(uuid, uuid) TO eda_app;
GRANT EXECUTE ON FUNCTION app.org_audit_seals(date, date) TO eda_app;
GRANT EXECUTE ON FUNCTION app.validate_partner_code(text) TO eda_app;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.audit_append(text, text, text, text, jsonb, text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.transfer_member_content(uuid, uuid) OWNER TO eda_sec_definer;
ALTER FUNCTION app.org_audit_seals(date, date) OWNER TO eda_sec_definer;
ALTER FUNCTION app.validate_partner_code(text) OWNER TO eda_sec_definer;
