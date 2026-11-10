-- eda:kind fn
-- L4 (032 §2.1; 031 §5): altı RLS yardımcısı, sahipliği eda_rls_helper (BYPASSRLS, NOLOGIN; politika
-- özyinelemesi önlemi, 031 §5.1) ve yalnız gereken kolon okumaları (031 §5.3). Bu dosya
-- auth.members, auth.users, auth.organizations, app.cases, app.case_members ve app.org_settings'ten
-- SONRA koşar (LANGUAGE sql gövdeleri oluşturulurken doğrulanır). Politikalar argümansız
-- yardımcıları `(SELECT app.current_org_id())` biçiminde sarar (InitPlan; 031 §5.4).
-- member_role() askıdaki büro için de NULL döner (031 Açık Soru 10; AS-0112).

-- Dar kolon okumaları (auth.members ve auth.users: 0003).
GRANT SELECT (id, suspended_at) ON auth.organizations TO eda_rls_helper;
GRANT SELECT (id, org_id, visibility, created_by) ON app.cases TO eda_rls_helper;
GRANT SELECT (case_id, user_id) ON app.case_members TO eda_rls_helper;
GRANT SELECT (org_id, trainee_supervision) ON app.org_settings TO eda_rls_helper;

CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(pg_catalog.current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid $$;

-- Aktif üyelik yoksa; kullanıcı reddedilmiş/askıda/yasaklıysa veya büro askıdaysa NULL.
CREATE OR REPLACE FUNCTION app.member_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT m.role
  FROM auth.members m
  JOIN auth.users u ON u.id = m.user_id
  JOIN auth.organizations o ON o.id = m.organization_id
  WHERE m.organization_id = app.current_org_id()
    AND m.user_id = app.current_user_id()
    AND m.status = 'active'
    AND u.verification_status NOT IN ('rejected', 'suspended')
    AND coalesce(u.banned, false) = false
    AND o.suspended_at IS NULL
$$;

CREATE OR REPLACE FUNCTION app.is_org_member(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT p_org IS NOT NULL AND p_org = app.current_org_id() AND app.member_role() IS NOT NULL $$;

-- Dava erişimi: aynı büro + aktif üye + (visibility = 'org' VEYA oluşturan VEYA dosya ekibi).
CREATE OR REPLACE FUNCTION app.has_case_access(p_case_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.cases c
    WHERE c.id = p_case_id
      AND c.org_id = app.current_org_id()
      AND app.member_role() IS NOT NULL
      AND ( c.visibility = 'org'
         OR c.created_by = app.current_user_id()
         OR EXISTS (SELECT 1 FROM app.case_members cm
                    WHERE cm.case_id = c.id AND cm.user_id = app.current_user_id()) )
  )
$$;

-- Stajyer denetimi: denetleyen owner/admin/senior_lawyer, büro ayarı açık, hedef aktif stajyer, kendisi değil.
CREATE OR REPLACE FUNCTION app.can_supervise(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_user_id IS DISTINCT FROM app.current_user_id()
     AND app.member_role() IN ('owner', 'admin', 'senior_lawyer')
     AND EXISTS (SELECT 1 FROM app.org_settings s
                 WHERE s.org_id = app.current_org_id() AND s.trainee_supervision)
     AND EXISTS (SELECT 1 FROM auth.members m
                 WHERE m.organization_id = app.current_org_id()
                   AND m.user_id = p_user_id AND m.role = 'trainee' AND m.status = 'active')
$$;

REVOKE ALL ON FUNCTION app.current_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.member_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.has_case_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_supervise(uuid) FROM PUBLIC;

-- Politika ifadeleri sorguyu yapan rolün yetkisiyle çalışır: EXECUTE zorunlu (031 §5.3).
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_user_id(), app.member_role(),
  app.is_org_member(uuid), app.has_case_access(uuid), app.can_supervise(uuid)
  TO eda_app, eda_worker, eda_sec_definer;

-- Sahiplik devri en sonda: yetkiler sahip eda_owner iken verilir (devirle ACL korunur).
ALTER FUNCTION app.current_org_id() OWNER TO eda_rls_helper;
ALTER FUNCTION app.current_user_id() OWNER TO eda_rls_helper;
ALTER FUNCTION app.member_role() OWNER TO eda_rls_helper;
ALTER FUNCTION app.is_org_member(uuid) OWNER TO eda_rls_helper;
ALTER FUNCTION app.has_case_access(uuid) OWNER TO eda_rls_helper;
ALTER FUNCTION app.can_supervise(uuid) OWNER TO eda_rls_helper;

-- Sahip değişince eski sahibin (eda_owner) EXECUTE girdisi sahip girdisine katlanır; FORCE RLS altında
-- eda_owner da politikaları değerlendirir (FK doğrulaması, seed; 031 §6.1), bu yüzden yeni sahip
-- adına yeniden verilir (eda_owner, eda_rls_helper'a SET TRUE üyedir; 031 §2.2).
SET LOCAL ROLE eda_rls_helper;
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_user_id(), app.member_role(),
  app.is_org_member(uuid), app.has_case_access(uuid), app.can_supervise(uuid) TO eda_owner;
RESET ROLE;
