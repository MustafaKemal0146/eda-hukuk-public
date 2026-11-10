-- eda:kind rls
-- L5 (032 §2.1, §5; 031 §6.2–§6.3): sohbet, atıf, arama ve belge tabloları için RLS + kiracı kapısı +
-- politikalar + tetikleyiciler + GRANT (manifestten). Çocuk tablolar üst tablonun görünürlüğünü
-- EXISTS ile izler (sorguyu yapan rolün politikalarıyla). Denetleyen (SV) belge ve sohbeti yalnız
-- okur: belge sürümü/önerisi/atıf yazımı yazılabilir belge koşulunu (DOCW) ister (AS-0116).

-- app.conversations (varsayılan özel; paylaşım yalnız shared_with_case + dava erişimi; sınıf yalnız yükselir)
ALTER TABLE app.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_tenant_guard ON app.conversations AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY conversations_select ON app.conversations FOR SELECT
  USING ((conversations.user_id = (SELECT app.current_user_id()) AND (conversations.case_id IS NULL OR app.has_case_access(conversations.case_id))) OR (conversations.case_id IS NOT NULL AND conversations.shared_with_case AND app.has_case_access(conversations.case_id)) OR (app.can_supervise(conversations.user_id) AND (conversations.case_id IS NULL OR app.has_case_access(conversations.case_id))));
CREATE POLICY conversations_insert ON app.conversations FOR INSERT
  WITH CHECK (conversations.user_id = (SELECT app.current_user_id()) AND app.is_org_member(conversations.org_id) AND (conversations.case_id IS NULL OR app.has_case_access(conversations.case_id)));
CREATE POLICY conversations_update ON app.conversations FOR UPDATE
  USING (conversations.user_id = (SELECT app.current_user_id()) AND (conversations.case_id IS NULL OR app.has_case_access(conversations.case_id)))
  WITH CHECK (conversations.user_id = (SELECT app.current_user_id()) AND (conversations.case_id IS NULL OR app.has_case_access(conversations.case_id)));
CREATE POLICY conversations_delete ON app.conversations FOR DELETE
  USING (conversations.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER conversations_forbid_key_change BEFORE UPDATE ON app.conversations
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON app.conversations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER conversations_guard_data_class
  BEFORE INSERT OR UPDATE OF data_class ON app.conversations
  FOR EACH ROW EXECUTE FUNCTION app.guard_conversation_data_class();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.conversations TO eda_app;
GRANT DELETE ON app.conversations TO eda_jobs;
GRANT SELECT (id, org_id, user_id, case_id, data_class, last_message_at, archived_at, created_at, updated_at) ON app.conversations TO eda_jobs;

-- app.messages
ALTER TABLE app.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_tenant_guard ON app.messages AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY messages_select ON app.messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.conversations x WHERE x.id = messages.conversation_id));
CREATE POLICY messages_insert ON app.messages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = messages.conversation_id AND c.user_id = (SELECT app.current_user_id())));
CREATE POLICY messages_update ON app.messages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = messages.conversation_id AND c.user_id = (SELECT app.current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = messages.conversation_id AND c.user_id = (SELECT app.current_user_id())));
CREATE TRIGGER messages_forbid_key_change BEFORE UPDATE ON app.messages
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'conversation_id');
CREATE TRIGGER messages_set_updated_at BEFORE UPDATE ON app.messages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.messages TO eda_app;
GRANT SELECT (id, org_id, conversation_id, role, status, model_alias, provider_id, data_class, created_at, updated_at, completed_at) ON app.messages TO eda_jobs;
GRANT UPDATE (reasoning) ON app.messages TO eda_jobs;

-- app.message_sources ([K#] değişmez: UPDATE/DELETE yok)
ALTER TABLE app.message_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY message_sources_tenant_guard ON app.message_sources AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY message_sources_select ON app.message_sources FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.conversations x WHERE x.id = message_sources.conversation_id));
CREATE POLICY message_sources_insert ON app.message_sources FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = message_sources.conversation_id AND c.user_id = (SELECT app.current_user_id())));
CREATE TRIGGER message_sources_forbid_key_change BEFORE UPDATE ON app.message_sources
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'conversation_id');
GRANT SELECT, INSERT ON app.message_sources TO eda_app;

-- app.message_citations (mesaj VE belge atıfları (030 Açık Soru 2))
ALTER TABLE app.message_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_citations FORCE ROW LEVEL SECURITY;
CREATE POLICY message_citations_tenant_guard ON app.message_citations AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY message_citations_select ON app.message_citations FOR SELECT
  USING ((message_citations.conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.conversations x WHERE x.id = message_citations.conversation_id)) OR (message_citations.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents x WHERE x.id = message_citations.document_id)));
CREATE POLICY message_citations_insert ON app.message_citations FOR INSERT
  WITH CHECK ((message_citations.conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = message_citations.conversation_id AND c.user_id = (SELECT app.current_user_id()))) OR (message_citations.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents d WHERE d.id = message_citations.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id))))));
CREATE POLICY message_citations_update ON app.message_citations FOR UPDATE
  USING ((message_citations.conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = message_citations.conversation_id AND c.user_id = (SELECT app.current_user_id()))) OR (message_citations.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents d WHERE d.id = message_citations.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id))))))
  WITH CHECK ((message_citations.conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.conversations c WHERE c.id = message_citations.conversation_id AND c.user_id = (SELECT app.current_user_id()))) OR (message_citations.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents d WHERE d.id = message_citations.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id))))));
CREATE TRIGGER message_citations_forbid_key_change BEFORE UPDATE ON app.message_citations
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER message_citations_set_updated_at BEFORE UPDATE ON app.message_citations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.message_citations TO eda_app;
GRANT SELECT (id, org_id, conversation_id, message_id, document_id, status, check_attempts, last_checked_at, created_at, updated_at) ON app.message_citations TO eda_jobs;

-- app.message_feedback
ALTER TABLE app.message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY message_feedback_tenant_guard ON app.message_feedback AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY message_feedback_select ON app.message_feedback FOR SELECT
  USING (message_feedback.user_id = (SELECT app.current_user_id()));
CREATE POLICY message_feedback_insert ON app.message_feedback FOR INSERT
  WITH CHECK (message_feedback.user_id = (SELECT app.current_user_id()) AND EXISTS (SELECT 1 FROM app.messages x WHERE x.id = message_feedback.message_id));
CREATE POLICY message_feedback_update ON app.message_feedback FOR UPDATE
  USING (message_feedback.user_id = (SELECT app.current_user_id()))
  WITH CHECK (message_feedback.user_id = (SELECT app.current_user_id()));
CREATE POLICY message_feedback_delete ON app.message_feedback FOR DELETE
  USING (message_feedback.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER message_feedback_forbid_key_change BEFORE UPDATE ON app.message_feedback
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.message_feedback TO eda_app;

-- app.feedback_shares
ALTER TABLE app.feedback_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.feedback_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY feedback_shares_tenant_guard ON app.feedback_shares AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY feedback_shares_select ON app.feedback_shares FOR SELECT
  USING (feedback_shares.user_id = (SELECT app.current_user_id()));
CREATE POLICY feedback_shares_insert ON app.feedback_shares FOR INSERT
  WITH CHECK (feedback_shares.user_id = (SELECT app.current_user_id()) AND EXISTS (SELECT 1 FROM app.messages x WHERE x.id = feedback_shares.message_id));
CREATE TRIGGER feedback_shares_forbid_key_change BEFORE UPDATE ON app.feedback_shares
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT, INSERT ON app.feedback_shares TO eda_app;
GRANT DELETE ON app.feedback_shares TO eda_jobs;
GRANT SELECT (id, org_id, expires_at, created_at) ON app.feedback_shares TO eda_jobs;

-- app.prompt_library
ALTER TABLE app.prompt_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.prompt_library FORCE ROW LEVEL SECURITY;
CREATE POLICY prompt_library_tenant_guard ON app.prompt_library AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY prompt_library_select ON app.prompt_library FOR SELECT
  USING ((prompt_library.scope = 'org' AND app.is_org_member(prompt_library.org_id)) OR prompt_library.owner_user_id = (SELECT app.current_user_id()));
CREATE POLICY prompt_library_insert ON app.prompt_library FOR INSERT
  WITH CHECK ((prompt_library.scope = 'org' AND (SELECT app.member_role()) IN ('owner', 'admin')) OR (prompt_library.scope = 'user' AND prompt_library.owner_user_id = (SELECT app.current_user_id())));
CREATE POLICY prompt_library_update ON app.prompt_library FOR UPDATE
  USING ((prompt_library.scope = 'org' AND (SELECT app.member_role()) IN ('owner', 'admin')) OR (prompt_library.scope = 'user' AND prompt_library.owner_user_id = (SELECT app.current_user_id())))
  WITH CHECK ((prompt_library.scope = 'org' AND (SELECT app.member_role()) IN ('owner', 'admin')) OR (prompt_library.scope = 'user' AND prompt_library.owner_user_id = (SELECT app.current_user_id())));
CREATE POLICY prompt_library_delete ON app.prompt_library FOR DELETE
  USING ((prompt_library.scope = 'org' AND (SELECT app.member_role()) IN ('owner', 'admin')) OR (prompt_library.scope = 'user' AND prompt_library.owner_user_id = (SELECT app.current_user_id())));
CREATE TRIGGER prompt_library_forbid_key_change BEFORE UPDATE ON app.prompt_library
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'owner_user_id');
CREATE TRIGGER prompt_library_set_updated_at BEFORE UPDATE ON app.prompt_library
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.prompt_library TO eda_app;
GRANT DELETE ON app.prompt_library TO eda_jobs;
GRANT SELECT (id, org_id, scope, owner_user_id) ON app.prompt_library TO eda_jobs;

-- app.decision_searches (büro kapsamlı okuma (defter §30.12); 24 saat)
ALTER TABLE app.decision_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.decision_searches FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_searches_tenant_guard ON app.decision_searches AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY decision_searches_select ON app.decision_searches FOR SELECT
  USING (app.is_org_member(decision_searches.org_id));
CREATE POLICY decision_searches_insert ON app.decision_searches FOR INSERT
  WITH CHECK (decision_searches.user_id = (SELECT app.current_user_id()));
CREATE POLICY decision_searches_delete ON app.decision_searches FOR DELETE
  USING (decision_searches.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER decision_searches_forbid_key_change BEFORE UPDATE ON app.decision_searches
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT, INSERT, DELETE ON app.decision_searches TO eda_app;
GRANT DELETE ON app.decision_searches TO eda_jobs;
GRANT SELECT (id, org_id, user_id, expires_at, created_at) ON app.decision_searches TO eda_jobs;

-- app.kunye_checks
ALTER TABLE app.kunye_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.kunye_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY kunye_checks_tenant_guard ON app.kunye_checks AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY kunye_checks_select ON app.kunye_checks FOR SELECT
  USING (kunye_checks.user_id = (SELECT app.current_user_id()));
CREATE POLICY kunye_checks_insert ON app.kunye_checks FOR INSERT
  WITH CHECK (kunye_checks.user_id = (SELECT app.current_user_id()));
CREATE POLICY kunye_checks_update ON app.kunye_checks FOR UPDATE
  USING (kunye_checks.user_id = (SELECT app.current_user_id()))
  WITH CHECK (kunye_checks.user_id = (SELECT app.current_user_id()));
CREATE POLICY kunye_checks_delete ON app.kunye_checks FOR DELETE
  USING (kunye_checks.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER kunye_checks_forbid_key_change BEFORE UPDATE ON app.kunye_checks
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER kunye_checks_set_updated_at BEFORE UPDATE ON app.kunye_checks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.kunye_checks TO eda_app;
GRANT DELETE ON app.kunye_checks TO eda_jobs;
GRANT SELECT (id, org_id, user_id, status, expires_at, completed_at, created_at, updated_at) ON app.kunye_checks TO eda_jobs;

-- app.templates (org_id NULL = platform şablonu; herkes okur, yalnız seed (eda_owner) yazar)
ALTER TABLE app.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.templates FORCE ROW LEVEL SECURITY;
CREATE POLICY templates_tenant_guard ON app.templates AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING ((org_id IS NULL OR org_id = (SELECT app.current_org_id())) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY templates_select ON app.templates FOR SELECT
  USING (templates.org_id IS NULL OR app.is_org_member(templates.org_id));
CREATE POLICY templates_insert ON app.templates FOR INSERT
  WITH CHECK ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY templates_update ON app.templates FOR UPDATE
  USING (templates.org_id IS NOT NULL AND (SELECT app.member_role()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY templates_delete ON app.templates FOR DELETE
  USING (templates.org_id IS NOT NULL AND (SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY templates_platform_seed ON app.templates FOR ALL TO eda_owner
  USING (templates.org_id IS NULL)
  WITH CHECK (templates.org_id IS NULL);
CREATE TRIGGER templates_forbid_key_change BEFORE UPDATE ON app.templates
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'created_by');
CREATE TRIGGER templates_set_updated_at BEFORE UPDATE ON app.templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.templates TO eda_app;
GRANT DELETE ON app.templates TO eda_jobs;
GRANT SELECT (id, org_id) ON app.templates TO eda_jobs;

-- app.documents (denetleyen (SV) yalnız okur)
ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_tenant_guard ON app.documents AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY documents_select ON app.documents FOR SELECT
  USING ((documents.case_id IS NULL AND documents.owner_id = (SELECT app.current_user_id())) OR (documents.case_id IS NOT NULL AND app.has_case_access(documents.case_id)) OR (app.can_supervise(documents.owner_id) AND (documents.case_id IS NULL OR app.has_case_access(documents.case_id))));
CREATE POLICY documents_insert ON app.documents FOR INSERT
  WITH CHECK (documents.owner_id = (SELECT app.current_user_id()) AND (documents.case_id IS NULL OR app.has_case_access(documents.case_id)));
CREATE POLICY documents_update ON app.documents FOR UPDATE
  USING ((documents.case_id IS NULL AND documents.owner_id = (SELECT app.current_user_id())) OR (documents.case_id IS NOT NULL AND app.has_case_access(documents.case_id)))
  WITH CHECK ((documents.case_id IS NULL AND documents.owner_id = (SELECT app.current_user_id())) OR (documents.case_id IS NOT NULL AND app.has_case_access(documents.case_id)));
CREATE POLICY documents_delete ON app.documents FOR DELETE
  USING ((documents.case_id IS NULL AND documents.owner_id = (SELECT app.current_user_id())) OR (documents.case_id IS NOT NULL AND app.has_case_access(documents.case_id)));
CREATE TRIGGER documents_forbid_key_change BEFORE UPDATE ON app.documents
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.owner_id IS DISTINCT FROM NEW.owner_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'owner_id');
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.documents TO eda_app;
GRANT DELETE ON app.documents TO eda_jobs;
GRANT SELECT (id, org_id, owner_id, case_id, status, created_at, updated_at) ON app.documents TO eda_jobs;

-- app.document_versions (tam kopya, değişmez)
ALTER TABLE app.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY document_versions_tenant_guard ON app.document_versions AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY document_versions_select ON app.document_versions FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.documents x WHERE x.id = document_versions.document_id));
CREATE POLICY document_versions_insert ON app.document_versions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.documents d WHERE d.id = document_versions.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id)))));
CREATE TRIGGER document_versions_forbid_key_change BEFORE UPDATE ON app.document_versions
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.document_id IS DISTINCT FROM NEW.document_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'document_id');
GRANT SELECT, INSERT ON app.document_versions TO eda_app;

-- app.document_suggestions
ALTER TABLE app.document_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY document_suggestions_tenant_guard ON app.document_suggestions AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY document_suggestions_select ON app.document_suggestions FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.documents x WHERE x.id = document_suggestions.document_id));
CREATE POLICY document_suggestions_insert ON app.document_suggestions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.documents d WHERE d.id = document_suggestions.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id)))));
CREATE POLICY document_suggestions_update ON app.document_suggestions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM app.documents d WHERE d.id = document_suggestions.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id)))))
  WITH CHECK (EXISTS (SELECT 1 FROM app.documents d WHERE d.id = document_suggestions.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id)))));
CREATE TRIGGER document_suggestions_forbid_key_change BEFORE UPDATE ON app.document_suggestions
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.document_id IS DISTINCT FROM NEW.document_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'document_id');
CREATE TRIGGER document_suggestions_set_updated_at BEFORE UPDATE ON app.document_suggestions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.document_suggestions TO eda_app;

-- app.document_exports (tüm eda-exports nesneleri; data türü yalnız talep edene görünür)
ALTER TABLE app.document_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY document_exports_tenant_guard ON app.document_exports AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY document_exports_select ON app.document_exports FOR SELECT
  USING (document_exports.requested_by = (SELECT app.current_user_id()) OR (document_exports.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents x WHERE x.id = document_exports.document_id)) OR (document_exports.case_id IS NOT NULL AND app.has_case_access(document_exports.case_id)));
CREATE POLICY document_exports_insert ON app.document_exports FOR INSERT
  WITH CHECK (document_exports.requested_by = (SELECT app.current_user_id()) AND (document_exports.document_id IS NULL OR EXISTS (SELECT 1 FROM app.documents x WHERE x.id = document_exports.document_id)) AND (document_exports.case_id IS NULL OR app.has_case_access(document_exports.case_id)));
CREATE POLICY document_exports_update ON app.document_exports FOR UPDATE
  USING (document_exports.requested_by = (SELECT app.current_user_id()) OR (document_exports.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents x WHERE x.id = document_exports.document_id)) OR (document_exports.case_id IS NOT NULL AND app.has_case_access(document_exports.case_id)))
  WITH CHECK (document_exports.requested_by = (SELECT app.current_user_id()) OR (document_exports.document_id IS NOT NULL AND EXISTS (SELECT 1 FROM app.documents x WHERE x.id = document_exports.document_id)) OR (document_exports.case_id IS NOT NULL AND app.has_case_access(document_exports.case_id)));
CREATE TRIGGER document_exports_forbid_key_change BEFORE UPDATE ON app.document_exports
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.requested_by IS DISTINCT FROM NEW.requested_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'requested_by');
GRANT SELECT, INSERT, UPDATE ON app.document_exports TO eda_app;
GRANT DELETE ON app.document_exports TO eda_jobs;
GRANT SELECT (id, org_id, subject_type, status, object_key, size_bytes, expires_at, completed_at, created_at) ON app.document_exports TO eda_jobs;
