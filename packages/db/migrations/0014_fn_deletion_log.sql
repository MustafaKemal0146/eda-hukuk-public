-- eda:kind fn
-- L3 (032 §2.1; 030 §1.8, §14): app.log_deletion() ve kök tablo bağları. Silinen kök kaydın yalnız
-- kimliği, bürosu, zamanı ve nedeni app.deletion_log'a yazılır (içerik YOK); geri yüklemeden sonra
-- yeniden uygulanır (035). Neden oturum değişkeni app.deletion_reason'dan okunur (yalnız imha işlemi
-- içinde ayarlanır; boşsa 'user_request'). Çocuk satırlar köke CASCADE ile bağlıdır.

CREATE OR REPLACE FUNCTION app.log_deletion() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF TG_TABLE_SCHEMA = 'auth' AND TG_TABLE_NAME = 'organizations' THEN
    v_org := OLD.id;
  ELSE
    v_org := (pg_catalog.to_jsonb(OLD) ->> 'org_id')::uuid;
  END IF;
  INSERT INTO app.deletion_log (table_name, row_id, org_id, reason)
  VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, OLD.id, v_org,
          coalesce(nullif(pg_catalog.current_setting('app.deletion_reason', true), ''), 'user_request'))
  ON CONFLICT (table_name, row_id) DO NOTHING;
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION app.log_deletion() FROM PUBLIC;
GRANT SELECT (table_name, row_id) ON app.deletion_log TO eda_sec_definer;
GRANT INSERT (table_name, row_id, org_id, reason) ON app.deletion_log TO eda_sec_definer;

CREATE TRIGGER users_log_deletion AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER organizations_log_deletion AFTER DELETE ON auth.organizations
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER clients_log_deletion AFTER DELETE ON app.clients
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER powers_of_attorney_log_deletion AFTER DELETE ON app.powers_of_attorney
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER cases_log_deletion AFTER DELETE ON app.cases
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER case_parties_log_deletion AFTER DELETE ON app.case_parties
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER files_log_deletion AFTER DELETE ON app.files
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER conversations_log_deletion AFTER DELETE ON app.conversations
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER documents_log_deletion AFTER DELETE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER document_versions_log_deletion AFTER DELETE ON app.document_versions
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER calendar_events_log_deletion AFTER DELETE ON app.calendar_events
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER deadlines_log_deletion AFTER DELETE ON app.deadlines
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER prompt_library_log_deletion AFTER DELETE ON app.prompt_library
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
-- Yalnız büro şablonları (platform şablonu, org_id NULL, kök değildir).
CREATE TRIGGER templates_log_deletion AFTER DELETE ON app.templates
  FOR EACH ROW WHEN (OLD.org_id IS NOT NULL) EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER feedback_shares_log_deletion AFTER DELETE ON app.feedback_shares
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER kunye_checks_log_deletion AFTER DELETE ON app.kunye_checks
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER decision_searches_log_deletion AFTER DELETE ON app.decision_searches
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER support_tickets_log_deletion AFTER DELETE ON app.support_tickets
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();
CREATE TRIGGER kvkk_requests_log_deletion AFTER DELETE ON app.kvkk_requests
  FOR EACH ROW EXECUTE FUNCTION app.log_deletion();

-- Sahiplik devri tetikleyiciler bağlandıktan sonra (CREATE TRIGGER, fonksiyonda EXECUTE ister).
ALTER FUNCTION app.log_deletion() OWNER TO eda_sec_definer;
