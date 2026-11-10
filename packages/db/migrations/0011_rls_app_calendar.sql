-- eda:kind rls
-- L5 (032 §2.1, §5; 031 §6.3): takvim, süre ve bildirim tabloları için RLS + politikalar +
-- tetikleyiciler + GRANT (manifestten). Davasız etkinlik/süre kişiseldir (031 §6.4). Bildirim ve push
-- abonelikleri kullanıcı kapılıdır (withUserScope); bildirimi worker alıcı bağlamında ekler.

-- app.deadlines (davasız süre onaylayana görünür (030: created_by yok))
ALTER TABLE app.deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.deadlines FORCE ROW LEVEL SECURITY;
CREATE POLICY deadlines_tenant_guard ON app.deadlines AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY deadlines_select ON app.deadlines FOR SELECT
  USING ((deadlines.case_id IS NOT NULL AND app.has_case_access(deadlines.case_id)) OR (deadlines.case_id IS NULL AND deadlines.approved_by = (SELECT app.current_user_id())));
CREATE POLICY deadlines_insert ON app.deadlines FOR INSERT
  WITH CHECK (deadlines.approved_by = (SELECT app.current_user_id()) AND (deadlines.case_id IS NULL OR app.has_case_access(deadlines.case_id)));
CREATE POLICY deadlines_update ON app.deadlines FOR UPDATE
  USING ((deadlines.case_id IS NOT NULL AND app.has_case_access(deadlines.case_id)) OR (deadlines.case_id IS NULL AND deadlines.approved_by = (SELECT app.current_user_id())))
  WITH CHECK ((deadlines.case_id IS NOT NULL AND app.has_case_access(deadlines.case_id)) OR (deadlines.case_id IS NULL AND deadlines.approved_by = (SELECT app.current_user_id())));
CREATE TRIGGER deadlines_forbid_key_change BEFORE UPDATE ON app.deadlines
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.approved_by IS DISTINCT FROM NEW.approved_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'approved_by');
CREATE TRIGGER deadlines_set_updated_at BEFORE UPDATE ON app.deadlines
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.deadlines TO eda_app;
GRANT DELETE ON app.deadlines TO eda_jobs;
GRANT SELECT (id, org_id, case_id, status, due_date, due_at, approved_by, created_at) ON app.deadlines TO eda_jobs;

-- app.calendar_events
ALTER TABLE app.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.calendar_events FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_events_tenant_guard ON app.calendar_events AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY calendar_events_select ON app.calendar_events FOR SELECT
  USING ((calendar_events.case_id IS NOT NULL AND app.has_case_access(calendar_events.case_id)) OR (calendar_events.case_id IS NULL AND calendar_events.user_id = (SELECT app.current_user_id())));
CREATE POLICY calendar_events_insert ON app.calendar_events FOR INSERT
  WITH CHECK (calendar_events.user_id = (SELECT app.current_user_id()) AND (calendar_events.case_id IS NULL OR app.has_case_access(calendar_events.case_id)));
CREATE POLICY calendar_events_update ON app.calendar_events FOR UPDATE
  USING ((calendar_events.case_id IS NOT NULL AND app.has_case_access(calendar_events.case_id)) OR (calendar_events.case_id IS NULL AND calendar_events.user_id = (SELECT app.current_user_id())))
  WITH CHECK ((calendar_events.case_id IS NOT NULL AND app.has_case_access(calendar_events.case_id)) OR (calendar_events.case_id IS NULL AND calendar_events.user_id = (SELECT app.current_user_id())));
CREATE POLICY calendar_events_delete ON app.calendar_events FOR DELETE
  USING ((calendar_events.case_id IS NOT NULL AND app.has_case_access(calendar_events.case_id)) OR (calendar_events.case_id IS NULL AND calendar_events.user_id = (SELECT app.current_user_id())));
CREATE TRIGGER calendar_events_forbid_key_change BEFORE UPDATE ON app.calendar_events
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER calendar_events_set_updated_at BEFORE UPDATE ON app.calendar_events
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.calendar_events TO eda_app;
GRANT DELETE ON app.calendar_events TO eda_jobs;
GRANT SELECT (id, org_id, user_id, case_id, deadline_id, starts_at, ends_at, completed_at, cancelled_at, created_at) ON app.calendar_events TO eda_jobs;

-- app.reminders
ALTER TABLE app.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY reminders_tenant_guard ON app.reminders AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY reminders_select ON app.reminders FOR SELECT
  USING (reminders.user_id = (SELECT app.current_user_id()));
CREATE POLICY reminders_insert ON app.reminders FOR INSERT
  WITH CHECK (reminders.user_id = (SELECT app.current_user_id()));
CREATE POLICY reminders_update ON app.reminders FOR UPDATE
  USING (reminders.user_id = (SELECT app.current_user_id()))
  WITH CHECK (reminders.user_id = (SELECT app.current_user_id()));
CREATE POLICY reminders_delete ON app.reminders FOR DELETE
  USING (reminders.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER reminders_forbid_key_change BEFORE UPDATE ON app.reminders
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT, INSERT, UPDATE, DELETE ON app.reminders TO eda_app;
GRANT DELETE ON app.reminders TO eda_jobs;
GRANT SELECT (id, org_id, user_id, calendar_event_id, deadline_id, remind_at, channel, status, attempts, sent_at, created_at) ON app.reminders TO eda_jobs;
GRANT UPDATE (status, attempts, sent_at, last_error_code) ON app.reminders TO eda_jobs;

-- app.push_subscriptions (özel kapı: kullanıcı; withUserScope)
ALTER TABLE app.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_tenant_guard ON app.push_subscriptions AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_id = (SELECT app.current_user_id()));
CREATE POLICY push_subscriptions_select ON app.push_subscriptions FOR SELECT
  USING (push_subscriptions.user_id = (SELECT app.current_user_id()));
CREATE POLICY push_subscriptions_insert ON app.push_subscriptions FOR INSERT
  WITH CHECK (push_subscriptions.user_id = (SELECT app.current_user_id()));
CREATE POLICY push_subscriptions_delete ON app.push_subscriptions FOR DELETE
  USING (push_subscriptions.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER push_subscriptions_forbid_key_change BEFORE UPDATE ON app.push_subscriptions
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT, INSERT, DELETE ON app.push_subscriptions TO eda_app;
GRANT DELETE ON app.push_subscriptions TO eda_jobs;
GRANT SELECT (id, org_id, user_id, disabled_at, created_at) ON app.push_subscriptions TO eda_jobs;

-- app.notifications (özel kapı; INSERT yalnız worker (alıcı bağlamında); kullanıcı yalnız read_at günceller)
ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_guard ON app.notifications AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (user_id = (SELECT app.current_user_id()) AND (org_id IS NULL OR org_id = (SELECT app.current_org_id())))
  WITH CHECK (user_id = (SELECT app.current_user_id()) AND (org_id IS NULL OR org_id = (SELECT app.current_org_id())));
CREATE POLICY notifications_select ON app.notifications FOR SELECT
  USING (notifications.user_id = (SELECT app.current_user_id()));
CREATE POLICY notifications_insert ON app.notifications FOR INSERT TO eda_worker
  WITH CHECK (notifications.user_id = (SELECT app.current_user_id()));
CREATE POLICY notifications_update ON app.notifications FOR UPDATE
  USING (notifications.user_id = (SELECT app.current_user_id()))
  WITH CHECK (notifications.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER notifications_forbid_key_change BEFORE UPDATE ON app.notifications
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
GRANT SELECT ON app.notifications TO eda_app;
GRANT UPDATE (read_at) ON app.notifications TO eda_app;
GRANT INSERT ON app.notifications TO eda_worker;
GRANT DELETE ON app.notifications TO eda_jobs;
GRANT SELECT (id, org_id, user_id, type, read_at, created_at) ON app.notifications TO eda_jobs;

-- app.notification_preferences (kullanıcı kapsamlı; withUserScope (045 §13.1))
ALTER TABLE app.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_tenant_guard ON app.notification_preferences AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (user_id = (SELECT app.current_user_id()))
  WITH CHECK (user_id = (SELECT app.current_user_id()));
CREATE POLICY notification_preferences_select ON app.notification_preferences FOR SELECT
  USING (notification_preferences.user_id = (SELECT app.current_user_id()));
CREATE POLICY notification_preferences_insert ON app.notification_preferences FOR INSERT
  WITH CHECK (notification_preferences.user_id = (SELECT app.current_user_id()));
CREATE POLICY notification_preferences_update ON app.notification_preferences FOR UPDATE
  USING (notification_preferences.user_id = (SELECT app.current_user_id()))
  WITH CHECK (notification_preferences.user_id = (SELECT app.current_user_id()));
CREATE POLICY notification_preferences_delete ON app.notification_preferences FOR DELETE
  USING (notification_preferences.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER notification_preferences_forbid_key_change BEFORE UPDATE ON app.notification_preferences
  FOR EACH ROW WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('user_id');
CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON app.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON app.notification_preferences TO eda_app;
