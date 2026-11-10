-- eda:kind rls
-- L5 (032 §2.1, §5; 031 §6): kimlik/büro, katalog ve müvekkil/dava/evrak tabloları için RLS +
-- kiracı kapısı + komut başına politikalar + değişmezlik/updated_at tetikleyicileri + açık GRANT'ler.
-- Politika kataloğu 031 §6.3; GRANT satırları RLS manifestinden üretilir (src/rls/manifest.ts,
-- scripts/gen-rls-grants.ts). Her E tabloda ENABLE + FORCE; GRANT RLS'den sonra, aynı işlemde.
-- K tabloları (031 §6.5): RLS yok, eda_app yalnız SELECT. "Tüm üyeler" = app.is_org_member(org_id).

-- app.lawyer_profiles (kullanıcı kapsamlı; meslektaş profili imza bloğu için okunur)
ALTER TABLE app.lawyer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lawyer_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY lawyer_profiles_tenant_guard ON app.lawyer_profiles AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING ((SELECT app.current_user_id()) IS NOT NULL)
  WITH CHECK ((SELECT app.current_user_id()) IS NOT NULL);
CREATE POLICY lawyer_profiles_select ON app.lawyer_profiles FOR SELECT
  USING (lawyer_profiles.user_id = (SELECT app.current_user_id()) OR ((SELECT app.member_role()) IS NOT NULL AND EXISTS (SELECT 1 FROM auth.members m WHERE m.organization_id = (SELECT app.current_org_id()) AND m.user_id = lawyer_profiles.user_id AND m.status = 'active')));
CREATE POLICY lawyer_profiles_insert ON app.lawyer_profiles FOR INSERT
  WITH CHECK (lawyer_profiles.user_id = (SELECT app.current_user_id()));
CREATE POLICY lawyer_profiles_update ON app.lawyer_profiles FOR UPDATE
  USING (lawyer_profiles.user_id = (SELECT app.current_user_id()))
  WITH CHECK (lawyer_profiles.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER lawyer_profiles_forbid_key_change BEFORE UPDATE ON app.lawyer_profiles
  FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('user_id');
CREATE TRIGGER lawyer_profiles_set_updated_at BEFORE UPDATE ON app.lawyer_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.lawyer_profiles TO eda_app;
GRANT INSERT (user_id, baro, sicil_no, trainee_registry_no, ai_instructions) ON app.lawyer_profiles TO eda_app;
GRANT UPDATE (baro, sicil_no, trainee_registry_no, ai_instructions, submitted_at) ON app.lawyer_profiles TO eda_app;

-- app.org_settings
ALTER TABLE app.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.org_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY org_settings_tenant_guard ON app.org_settings AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY org_settings_select ON app.org_settings FOR SELECT
  USING (app.is_org_member(org_settings.org_id));
CREATE POLICY org_settings_insert ON app.org_settings FOR INSERT
  WITH CHECK ((SELECT app.member_role()) = 'owner');
CREATE POLICY org_settings_update ON app.org_settings FOR UPDATE
  USING ((SELECT app.member_role()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER org_settings_forbid_key_change BEFORE UPDATE ON app.org_settings
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER org_settings_set_updated_at BEFORE UPDATE ON app.org_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.org_settings TO eda_app;
GRANT DELETE ON app.org_settings TO eda_jobs;
GRANT SELECT (org_id, legal_hold, retention_years_after_mandate, updated_at) ON app.org_settings TO eda_jobs;

-- app.org_keys
ALTER TABLE app.org_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.org_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY org_keys_tenant_guard ON app.org_keys AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY org_keys_select ON app.org_keys FOR SELECT
  USING (app.is_org_member(org_keys.org_id));
CREATE POLICY org_keys_insert ON app.org_keys FOR INSERT
  WITH CHECK ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER org_keys_forbid_key_change BEFORE UPDATE ON app.org_keys
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
GRANT SELECT, INSERT ON app.org_keys TO eda_app;
GRANT DELETE ON app.org_keys TO eda_jobs;
GRANT SELECT (id, org_id, key_version, kek_version, status, created_at, retired_at, shredded_at) ON app.org_keys TO eda_jobs;
GRANT UPDATE (status, wrapped_dek, retired_at, shredded_at) ON app.org_keys TO eda_jobs;

-- app.partners (K)
GRANT SELECT (id, code, is_active) ON app.partners TO eda_jobs;

-- app.partner_members (— (V1.1))

-- app.partner_organizations (— (V1.1))

-- app.user_preferences (kullanıcı kapsamlı; withUserScope)
ALTER TABLE app.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY user_preferences_tenant_guard ON app.user_preferences AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (user_preferences.user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_preferences.user_id = (SELECT app.current_user_id()));
CREATE POLICY user_preferences_select ON app.user_preferences FOR SELECT
  USING (user_preferences.user_id = (SELECT app.current_user_id()));
CREATE POLICY user_preferences_insert ON app.user_preferences FOR INSERT
  WITH CHECK (user_preferences.user_id = (SELECT app.current_user_id()));
CREATE POLICY user_preferences_update ON app.user_preferences FOR UPDATE
  USING (user_preferences.user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_preferences.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER user_preferences_forbid_key_change BEFORE UPDATE ON app.user_preferences
  FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('user_id');
CREATE TRIGGER user_preferences_set_updated_at BEFORE UPDATE ON app.user_preferences
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.user_preferences TO eda_app;

-- app.courts (K)
CREATE TRIGGER courts_set_updated_at BEFORE UPDATE ON app.courts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.courts TO eda_app;

-- app.chambers (K)
CREATE TRIGGER chambers_set_updated_at BEFORE UPDATE ON app.chambers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.chambers TO eda_app;

-- app.case_types (K)
CREATE TRIGGER case_types_set_updated_at BEFORE UPDATE ON app.case_types
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.case_types TO eda_app;

-- app.deadline_rules (K)
GRANT SELECT ON app.deadline_rules TO eda_app;

-- app.holidays (K)
GRANT SELECT ON app.holidays TO eda_app;
GRANT SELECT (id, holiday_date, code, kind, is_half_day, verified_at) ON app.holidays TO eda_jobs;

-- app.judicial_recesses (K)
GRANT SELECT ON app.judicial_recesses TO eda_app;
GRANT SELECT (id, branch, year, period, verified_at) ON app.judicial_recesses TO eda_jobs;

-- app.clients
ALTER TABLE app.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clients FORCE ROW LEVEL SECURITY;
CREATE POLICY clients_tenant_guard ON app.clients AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY clients_select ON app.clients FOR SELECT
  USING (app.is_org_member(clients.org_id));
CREATE POLICY clients_insert ON app.clients FOR INSERT
  WITH CHECK (app.is_org_member(clients.org_id));
CREATE POLICY clients_update ON app.clients FOR UPDATE
  USING (app.is_org_member(clients.org_id))
  WITH CHECK (app.is_org_member(clients.org_id));
CREATE POLICY clients_delete ON app.clients FOR DELETE
  USING (app.is_org_member(clients.org_id));
CREATE TRIGGER clients_forbid_key_change BEFORE UPDATE ON app.clients
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'created_by');
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON app.clients
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.clients TO eda_app;
GRANT DELETE ON app.clients TO eda_jobs;
GRANT SELECT (id, org_id, created_at, updated_at) ON app.clients TO eda_jobs;

-- app.powers_of_attorney
ALTER TABLE app.powers_of_attorney ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.powers_of_attorney FORCE ROW LEVEL SECURITY;
CREATE POLICY powers_of_attorney_tenant_guard ON app.powers_of_attorney AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY powers_of_attorney_select ON app.powers_of_attorney FOR SELECT
  USING (app.is_org_member(powers_of_attorney.org_id));
CREATE POLICY powers_of_attorney_insert ON app.powers_of_attorney FOR INSERT
  WITH CHECK (app.is_org_member(powers_of_attorney.org_id));
CREATE POLICY powers_of_attorney_update ON app.powers_of_attorney FOR UPDATE
  USING (app.is_org_member(powers_of_attorney.org_id))
  WITH CHECK (app.is_org_member(powers_of_attorney.org_id));
CREATE TRIGGER powers_of_attorney_forbid_key_change BEFORE UPDATE ON app.powers_of_attorney
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'created_by');
CREATE TRIGGER powers_of_attorney_set_updated_at BEFORE UPDATE ON app.powers_of_attorney
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.powers_of_attorney TO eda_app;
GRANT DELETE ON app.powers_of_attorney TO eda_jobs;
GRANT SELECT (id, org_id, client_id, ended_at, created_at) ON app.powers_of_attorney TO eda_jobs;

-- app.cases (dava erişimi satır üzerinde de değerlendirilir: INSERT ... RETURNING aynı deyimde eklenen satırı app.has_case_access() alt sorgusunda göremez (AS-0115))
ALTER TABLE app.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cases FORCE ROW LEVEL SECURITY;
CREATE POLICY cases_tenant_guard ON app.cases AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY cases_select ON app.cases FOR SELECT
  USING (app.is_org_member(cases.org_id) AND (cases.visibility = 'org' OR cases.created_by = (SELECT app.current_user_id()) OR app.has_case_access(cases.id)));
CREATE POLICY cases_insert ON app.cases FOR INSERT
  WITH CHECK (app.is_org_member(cases.org_id) AND cases.created_by = (SELECT app.current_user_id()));
CREATE POLICY cases_update ON app.cases FOR UPDATE
  USING (app.is_org_member(cases.org_id) AND (cases.visibility = 'org' OR cases.created_by = (SELECT app.current_user_id()) OR app.has_case_access(cases.id)))
  WITH CHECK (app.is_org_member(cases.org_id));
CREATE TRIGGER cases_forbid_key_change BEFORE UPDATE ON app.cases
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'created_by');
CREATE TRIGGER cases_set_updated_at BEFORE UPDATE ON app.cases
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.cases TO eda_app;
GRANT DELETE ON app.cases TO eda_jobs;
GRANT SELECT (id, org_id, status, visibility, legal_hold, mandate_ended_at, created_at, updated_at) ON app.cases TO eda_jobs;

-- app.case_members
ALTER TABLE app.case_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.case_members FORCE ROW LEVEL SECURITY;
CREATE POLICY case_members_tenant_guard ON app.case_members AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY case_members_select ON app.case_members FOR SELECT
  USING (app.has_case_access(case_members.case_id));
CREATE POLICY case_members_insert ON app.case_members FOR INSERT
  WITH CHECK (app.has_case_access(case_members.case_id) AND EXISTS (SELECT 1 FROM auth.members m WHERE m.organization_id = case_members.org_id AND m.user_id = case_members.user_id AND m.status = 'active'));
CREATE POLICY case_members_delete ON app.case_members FOR DELETE
  USING (app.has_case_access(case_members.case_id));
CREATE TRIGGER case_members_forbid_key_change BEFORE UPDATE ON app.case_members
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT, INSERT, DELETE ON app.case_members TO eda_app;
GRANT DELETE ON app.case_members TO eda_jobs;
GRANT SELECT (id, org_id, case_id, user_id) ON app.case_members TO eda_jobs;

-- app.case_parties
ALTER TABLE app.case_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.case_parties FORCE ROW LEVEL SECURITY;
CREATE POLICY case_parties_tenant_guard ON app.case_parties AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY case_parties_select ON app.case_parties FOR SELECT
  USING (app.has_case_access(case_parties.case_id));
CREATE POLICY case_parties_insert ON app.case_parties FOR INSERT
  WITH CHECK (app.has_case_access(case_parties.case_id));
CREATE POLICY case_parties_update ON app.case_parties FOR UPDATE
  USING (app.has_case_access(case_parties.case_id))
  WITH CHECK (app.has_case_access(case_parties.case_id));
CREATE POLICY case_parties_delete ON app.case_parties FOR DELETE
  USING (app.has_case_access(case_parties.case_id));
CREATE TRIGGER case_parties_forbid_key_change BEFORE UPDATE ON app.case_parties
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER case_parties_set_updated_at BEFORE UPDATE ON app.case_parties
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.case_parties TO eda_app;
GRANT DELETE ON app.case_parties TO eda_jobs;
GRANT SELECT (id, org_id, case_id) ON app.case_parties TO eda_jobs;

-- app.files
ALTER TABLE app.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.files FORCE ROW LEVEL SECURITY;
CREATE POLICY files_tenant_guard ON app.files AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY files_select ON app.files FOR SELECT
  USING ((files.case_id IS NULL AND files.uploaded_by = (SELECT app.current_user_id())) OR (files.case_id IS NOT NULL AND app.has_case_access(files.case_id)));
CREATE POLICY files_insert ON app.files FOR INSERT
  WITH CHECK (app.is_org_member(files.org_id) AND files.uploaded_by = (SELECT app.current_user_id()) AND (files.case_id IS NULL OR app.has_case_access(files.case_id)));
CREATE POLICY files_update ON app.files FOR UPDATE
  USING ((files.case_id IS NULL AND files.uploaded_by = (SELECT app.current_user_id())) OR (files.case_id IS NOT NULL AND app.has_case_access(files.case_id)))
  WITH CHECK ((files.case_id IS NULL AND files.uploaded_by = (SELECT app.current_user_id())) OR (files.case_id IS NOT NULL AND app.has_case_access(files.case_id)));
CREATE POLICY files_delete ON app.files FOR DELETE
  USING ((files.case_id IS NULL AND files.uploaded_by = (SELECT app.current_user_id())) OR (files.case_id IS NOT NULL AND app.has_case_access(files.case_id)));
CREATE TRIGGER files_forbid_key_change BEFORE UPDATE ON app.files
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'uploaded_by');
CREATE TRIGGER files_set_updated_at BEFORE UPDATE ON app.files
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.files TO eda_app;
GRANT DELETE ON app.files TO eda_jobs;
GRANT SELECT (id, org_id, case_id, origin, status, size_bytes, object_key, scanned_at, ready_at, inbox_expires_at, delete_requested_at, created_at, updated_at) ON app.files TO eda_jobs;

-- app.file_texts
ALTER TABLE app.file_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.file_texts FORCE ROW LEVEL SECURITY;
CREATE POLICY file_texts_tenant_guard ON app.file_texts AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY file_texts_select ON app.file_texts FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_texts.file_id));
CREATE POLICY file_texts_insert ON app.file_texts FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_texts.file_id));
CREATE POLICY file_texts_update ON app.file_texts FOR UPDATE
  USING (EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_texts.file_id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_texts.file_id));
CREATE TRIGGER file_texts_forbid_key_change BEFORE UPDATE ON app.file_texts
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.file_id IS DISTINCT FROM NEW.file_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'file_id');
CREATE TRIGGER file_texts_set_updated_at BEFORE UPDATE ON app.file_texts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.file_texts TO eda_app;

-- app.file_chunks
ALTER TABLE app.file_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.file_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY file_chunks_tenant_guard ON app.file_chunks AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY file_chunks_select ON app.file_chunks FOR SELECT
  USING ((file_chunks.case_id IS NOT NULL AND app.has_case_access(file_chunks.case_id)) OR (file_chunks.case_id IS NULL AND EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_chunks.file_id)));
CREATE POLICY file_chunks_insert ON app.file_chunks FOR INSERT
  WITH CHECK ((file_chunks.case_id IS NOT NULL AND app.has_case_access(file_chunks.case_id)) OR (file_chunks.case_id IS NULL AND EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_chunks.file_id)));
CREATE POLICY file_chunks_update ON app.file_chunks FOR UPDATE
  USING ((file_chunks.case_id IS NOT NULL AND app.has_case_access(file_chunks.case_id)) OR (file_chunks.case_id IS NULL AND EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_chunks.file_id)))
  WITH CHECK ((file_chunks.case_id IS NOT NULL AND app.has_case_access(file_chunks.case_id)) OR (file_chunks.case_id IS NULL AND EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_chunks.file_id)));
CREATE POLICY file_chunks_delete ON app.file_chunks FOR DELETE
  USING ((file_chunks.case_id IS NOT NULL AND app.has_case_access(file_chunks.case_id)) OR (file_chunks.case_id IS NULL AND EXISTS (SELECT 1 FROM app.files x WHERE x.id = file_chunks.file_id)));
CREATE TRIGGER file_chunks_forbid_key_change BEFORE UPDATE ON app.file_chunks
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.file_id IS DISTINCT FROM NEW.file_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'file_id');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.file_chunks TO eda_app;

-- app.custody_events (EKLİ; aylık bölüm; bölümler app.ensure_partitions() ile FORCE + REVOKE alır)
ALTER TABLE app.custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.custody_events FORCE ROW LEVEL SECURITY;
CREATE POLICY custody_events_tenant_guard ON app.custody_events AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY custody_events_select ON app.custody_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.files x WHERE x.id = custody_events.file_id));
CREATE POLICY custody_events_insert ON app.custody_events FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.files x WHERE x.id = custody_events.file_id) AND custody_events.actor_id = (SELECT app.current_user_id()));
CREATE TRIGGER custody_events_forbid_key_change BEFORE UPDATE ON app.custody_events
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER custody_events_forbid_mutation BEFORE UPDATE OR DELETE ON app.custody_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
REVOKE ALL ON app.custody_events FROM eda_app, eda_worker;
GRANT SELECT, INSERT ON app.custody_events TO eda_app;

-- app.case_ai_logs (ekli davranış: UPDATE/DELETE yetkisi yok)
ALTER TABLE app.case_ai_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.case_ai_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY case_ai_logs_tenant_guard ON app.case_ai_logs AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY case_ai_logs_select ON app.case_ai_logs FOR SELECT
  USING (app.has_case_access(case_ai_logs.case_id));
CREATE POLICY case_ai_logs_insert ON app.case_ai_logs FOR INSERT
  WITH CHECK (app.has_case_access(case_ai_logs.case_id));
CREATE TRIGGER case_ai_logs_forbid_key_change BEFORE UPDATE ON app.case_ai_logs
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
REVOKE ALL ON app.case_ai_logs FROM eda_app, eda_worker;
GRANT SELECT, INSERT ON app.case_ai_logs TO eda_app;
GRANT DELETE ON app.case_ai_logs TO eda_jobs;
GRANT SELECT (id, org_id, case_id, created_at) ON app.case_ai_logs TO eda_jobs;

-- app.pending_file_jobs
ALTER TABLE app.pending_file_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pending_file_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY pending_file_jobs_tenant_guard ON app.pending_file_jobs AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY pending_file_jobs_select ON app.pending_file_jobs FOR SELECT
  USING (app.is_org_member(pending_file_jobs.org_id));
CREATE POLICY pending_file_jobs_insert ON app.pending_file_jobs FOR INSERT
  WITH CHECK (app.is_org_member(pending_file_jobs.org_id));
CREATE POLICY pending_file_jobs_update ON app.pending_file_jobs FOR UPDATE
  USING (app.is_org_member(pending_file_jobs.org_id))
  WITH CHECK (app.is_org_member(pending_file_jobs.org_id));
CREATE POLICY pending_file_jobs_delete ON app.pending_file_jobs FOR DELETE
  USING (app.is_org_member(pending_file_jobs.org_id));
CREATE TRIGGER pending_file_jobs_forbid_key_change BEFORE UPDATE ON app.pending_file_jobs
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.file_id IS DISTINCT FROM NEW.file_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'file_id');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.pending_file_jobs TO eda_app;
GRANT DELETE ON app.pending_file_jobs TO eda_jobs;
GRANT SELECT (id, org_id, file_id, queue, job_name, priority, created_at) ON app.pending_file_jobs TO eda_jobs;
GRANT UPDATE (priority) ON app.pending_file_jobs TO eda_jobs;
