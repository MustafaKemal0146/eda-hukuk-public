-- eda:kind rls
-- L5 (032 §2.1, §5; 031 §6.3, §6.5, §6.6, §11): AI işletimi, ticari ve platform tabloları için RLS +
-- politikalar + tetikleyiciler + GRANT (manifestten). Ekli tablolarda (audit_log, ai_usage,
-- credit_ledger, tool_calls, product_events, ai_policy_acceptances) çalışma zamanı rollerinin önceki
-- tüm yetkileri geri alınıp yalnız manifestteki ekleme/okuma verilir; bölümlü üç tabloda deyim düzeyi app.forbid_mutation() sahip
-- dahil her değişikliği reddeder. audit_log'a eda_app doğrudan yazamaz: tek yol app.audit_append().

-- app.ai_providers (K; izin kolonları yalnız seed migrasyonu)
CREATE TRIGGER ai_providers_set_updated_at BEFORE UPDATE ON app.ai_providers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.ai_providers TO eda_app;

-- app.ai_models (K)
CREATE TRIGGER ai_models_set_updated_at BEFORE UPDATE ON app.ai_models
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.ai_models TO eda_app;

-- app.ai_task_routes (K)
CREATE TRIGGER ai_task_routes_set_updated_at BEFORE UPDATE ON app.ai_task_routes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.ai_task_routes TO eda_app;

-- app.prompt_versions (K; gövde ve özet değişmez (030 §10))
CREATE TRIGGER prompt_versions_forbid_key_change BEFORE UPDATE ON app.prompt_versions
  FOR EACH ROW WHEN (OLD.prompt_key IS DISTINCT FROM NEW.prompt_key OR OLD.version IS DISTINCT FROM NEW.version OR OLD.body IS DISTINCT FROM NEW.body OR OLD.sha256 IS DISTINCT FROM NEW.sha256 OR OLD.locked_sha256 IS DISTINCT FROM NEW.locked_sha256 OR OLD.variables IS DISTINCT FROM NEW.variables)
  EXECUTE FUNCTION app.forbid_key_change('prompt_key', 'version', 'body', 'sha256', 'locked_sha256', 'variables');
GRANT SELECT ON app.prompt_versions TO eda_app;

-- app.eval_runs (K; yalnız CI ve admin fonksiyonları)

-- app.ai_usage (EKLİ; aylık bölüm; org_id NULL satırlar kiracıya görünmez)
ALTER TABLE app.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_tenant_guard ON app.ai_usage AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY ai_usage_select ON app.ai_usage FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin') OR ai_usage.user_id = (SELECT app.current_user_id()));
CREATE POLICY ai_usage_insert ON app.ai_usage FOR INSERT
  WITH CHECK (ai_usage.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER ai_usage_forbid_key_change BEFORE UPDATE ON app.ai_usage
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER ai_usage_forbid_mutation BEFORE UPDATE OR DELETE ON app.ai_usage
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
REVOKE ALL ON app.ai_usage FROM eda_app, eda_worker;
GRANT SELECT, INSERT ON app.ai_usage TO eda_app;
GRANT SELECT (id, org_id, user_id, conversation_id, message_id, case_id, document_id, file_id, reservation_id, task, op_code, model_alias, provider_id, ai_model_id, model_id, region, data_class, thinking, step_no, attempt_no, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens, usage_source, pricing_window, cost_micro_usd, ttft_ms, latency_ms, status, error_code, finish_reason, fallback_from_provider_id, prefix_hash, prompt_version_id, flags, request_id, created_at) ON app.ai_usage TO eda_jobs;

-- app.tool_calls (ekli; argüman/içerik yok; SELECT yok (tabloda user_id yok: yazan üye, AS-0117))
ALTER TABLE app.tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tool_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY tool_calls_tenant_guard ON app.tool_calls AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY tool_calls_insert ON app.tool_calls FOR INSERT
  WITH CHECK (app.is_org_member(tool_calls.org_id));
CREATE TRIGGER tool_calls_forbid_key_change BEFORE UPDATE ON app.tool_calls
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
REVOKE ALL ON app.tool_calls FROM eda_app, eda_worker;
GRANT INSERT ON app.tool_calls TO eda_app;
GRANT DELETE ON app.tool_calls TO eda_jobs;
GRANT SELECT (id, org_id, conversation_id, message_id, tool_name, status, duration_ms, result_tokens, live, source, error_code, created_at) ON app.tool_calls TO eda_jobs;

-- app.ai_policy_acceptances (ekli; iptal alanları yalnız fonksiyonla)
ALTER TABLE app.ai_policy_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_policy_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_policy_acceptances_tenant_guard ON app.ai_policy_acceptances AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY ai_policy_acceptances_select ON app.ai_policy_acceptances FOR SELECT
  USING (app.is_org_member(ai_policy_acceptances.org_id));
CREATE POLICY ai_policy_acceptances_insert ON app.ai_policy_acceptances FOR INSERT
  WITH CHECK (((ai_policy_acceptances.kind = 'org_ai_policy' AND (SELECT app.member_role()) IN ('owner', 'admin')) OR (ai_policy_acceptances.kind <> 'org_ai_policy' AND (SELECT app.member_role()) = 'owner')) AND ai_policy_acceptances.accepted_by = (SELECT app.current_user_id()));
CREATE TRIGGER ai_policy_acceptances_forbid_key_change BEFORE UPDATE ON app.ai_policy_acceptances
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.accepted_by IS DISTINCT FROM NEW.accepted_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'accepted_by');
REVOKE ALL ON app.ai_policy_acceptances FROM eda_app, eda_worker;
GRANT SELECT, INSERT ON app.ai_policy_acceptances TO eda_app;
GRANT DELETE ON app.ai_policy_acceptances TO eda_jobs;
GRANT SELECT (id, org_id, kind, accepted_at, revoked_at) ON app.ai_policy_acceptances TO eda_jobs;

-- app.plans (K)
CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON app.plans
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.plans TO eda_app;

-- app.provider_plan_refs (K)
GRANT SELECT ON app.provider_plan_refs TO eda_app;

-- app.coupons (K; eda_app yetkisi YOK (kod listelenemez))
CREATE TRIGGER coupons_set_updated_at BEFORE UPDATE ON app.coupons
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- app.subscriptions (yazma yalnız faturalama fonksiyonlarıyla (P25))
ALTER TABLE app.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant_guard ON app.subscriptions AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY subscriptions_select ON app.subscriptions FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER subscriptions_forbid_key_change BEFORE UPDATE ON app.subscriptions
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON app.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.subscriptions TO eda_app;
GRANT DELETE ON app.subscriptions TO eda_jobs;
GRANT SELECT (id, org_id, plan_code, status, billing_period, seats, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, canceled_at, past_due_since, coupon_ends_at, created_at, updated_at) ON app.subscriptions TO eda_jobs;

-- app.credit_ledger (EKLİ; aylık bölüm; diğer hareket türleri fonksiyonlarla)
ALTER TABLE app.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_ledger_tenant_guard ON app.credit_ledger AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY credit_ledger_select ON app.credit_ledger FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin') OR credit_ledger.user_id = (SELECT app.current_user_id()));
CREATE POLICY credit_ledger_insert ON app.credit_ledger FOR INSERT
  WITH CHECK (credit_ledger.user_id = (SELECT app.current_user_id()) AND credit_ledger.entry_type IN ('consume', 'refund'));
CREATE TRIGGER credit_ledger_forbid_key_change BEFORE UPDATE ON app.credit_ledger
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER credit_ledger_forbid_mutation BEFORE UPDATE OR DELETE ON app.credit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
REVOKE ALL ON app.credit_ledger FROM eda_app, eda_worker;
GRANT SELECT, INSERT ON app.credit_ledger TO eda_app;
GRANT SELECT (id, org_id, entry_type, amount, balance_after, op_code, reservation_id, user_id, subscription_id, payment_id, coupon_redemption_id, expires_at, note_code, created_by, created_at) ON app.credit_ledger TO eda_jobs;

-- app.credit_reservations
ALTER TABLE app.credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.credit_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_reservations_tenant_guard ON app.credit_reservations AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY credit_reservations_select ON app.credit_reservations FOR SELECT
  USING (credit_reservations.user_id = (SELECT app.current_user_id()) OR (SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY credit_reservations_insert ON app.credit_reservations FOR INSERT
  WITH CHECK (credit_reservations.user_id = (SELECT app.current_user_id()));
CREATE POLICY credit_reservations_update ON app.credit_reservations FOR UPDATE
  USING (credit_reservations.user_id = (SELECT app.current_user_id()))
  WITH CHECK (credit_reservations.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER credit_reservations_forbid_key_change BEFORE UPDATE ON app.credit_reservations
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER credit_reservations_set_updated_at BEFORE UPDATE ON app.credit_reservations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.credit_reservations TO eda_app;
GRANT DELETE ON app.credit_reservations TO eda_jobs;
GRANT SELECT (id, org_id, user_id, op_code, credits, status, expires_at, settled_at, created_at, updated_at) ON app.credit_reservations TO eda_jobs;
GRANT UPDATE (status) ON app.credit_reservations TO eda_jobs;

-- app.invoices (yasal saklama; fonksiyonlarla yazılır)
ALTER TABLE app.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant_guard ON app.invoices AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY invoices_select ON app.invoices FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER invoices_forbid_key_change BEFORE UPDATE ON app.invoices
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.invoices TO eda_app;

-- app.payments (fonksiyonlarla yazılır)
ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant_guard ON app.payments AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY payments_select ON app.payments FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER payments_forbid_key_change BEFORE UPDATE ON app.payments
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.payments TO eda_app;
GRANT SELECT (id, org_id, invoice_id, subscription_id, provider, status, amount_kurus, currency, occurred_at, created_at) ON app.payments TO eda_jobs;

-- app.coupon_redemptions (app.redeem_coupon() ile (P25))
ALTER TABLE app.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.coupon_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY coupon_redemptions_tenant_guard ON app.coupon_redemptions AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY coupon_redemptions_select ON app.coupon_redemptions FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER coupon_redemptions_forbid_key_change BEFORE UPDATE ON app.coupon_redemptions
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
GRANT SELECT ON app.coupon_redemptions TO eda_app;
GRANT DELETE ON app.coupon_redemptions TO eda_jobs;
GRANT SELECT (id, org_id, coupon_id, subscription_id, created_at) ON app.coupon_redemptions TO eda_jobs;

-- app.partner_commissions (— (V1.1))
CREATE TRIGGER partner_commissions_set_updated_at BEFORE UPDATE ON app.partner_commissions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- app.billing_profiles
ALTER TABLE app.billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_profiles_tenant_guard ON app.billing_profiles AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY billing_profiles_select ON app.billing_profiles FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY billing_profiles_insert ON app.billing_profiles FOR INSERT
  WITH CHECK ((SELECT app.member_role()) = 'owner');
CREATE POLICY billing_profiles_update ON app.billing_profiles FOR UPDATE
  USING ((SELECT app.member_role()) = 'owner')
  WITH CHECK ((SELECT app.member_role()) = 'owner');
CREATE TRIGGER billing_profiles_forbid_key_change BEFORE UPDATE ON app.billing_profiles
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER billing_profiles_set_updated_at BEFORE UPDATE ON app.billing_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.billing_profiles TO eda_app;
GRANT DELETE ON app.billing_profiles TO eda_jobs;
GRANT SELECT (org_id) ON app.billing_profiles TO eda_jobs;

-- app.billing_checkouts
ALTER TABLE app.billing_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_checkouts FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_checkouts_tenant_guard ON app.billing_checkouts AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY billing_checkouts_select ON app.billing_checkouts FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER billing_checkouts_forbid_key_change BEFORE UPDATE ON app.billing_checkouts
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER billing_checkouts_set_updated_at BEFORE UPDATE ON app.billing_checkouts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.billing_checkouts TO eda_app;
GRANT DELETE ON app.billing_checkouts TO eda_jobs;
GRANT SELECT (id, org_id, status, created_at, updated_at) ON app.billing_checkouts TO eda_jobs;

-- app.billing_events (org_id NULL olaylar kiracıya görünmez)
ALTER TABLE app.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.billing_events FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_events_tenant_guard ON app.billing_events AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY billing_events_select ON app.billing_events FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER billing_events_forbid_key_change BEFORE UPDATE ON app.billing_events
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
GRANT SELECT ON app.billing_events TO eda_app;

-- app.subscription_changes
ALTER TABLE app.subscription_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.subscription_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_changes_tenant_guard ON app.subscription_changes AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY subscription_changes_select ON app.subscription_changes FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER subscription_changes_forbid_key_change BEFORE UPDATE ON app.subscription_changes
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER subscription_changes_set_updated_at BEFORE UPDATE ON app.subscription_changes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.subscription_changes TO eda_app;
GRANT DELETE ON app.subscription_changes TO eda_jobs;
GRANT SELECT (id, org_id, subscription_id, kind, effective_at, status, created_at) ON app.subscription_changes TO eda_jobs;

-- app.audit_log (EKLİ; aylık bölüm; okuma owner/admin; platform zinciri (org_id NULL) uygulamaya kapalı)
ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_tenant_guard ON app.audit_log AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY audit_log_select ON app.audit_log FOR SELECT
  USING ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER audit_log_forbid_key_change BEFORE UPDATE ON app.audit_log
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER audit_log_forbid_mutation BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_mutation();
REVOKE ALL ON app.audit_log FROM eda_app, eda_worker;
GRANT SELECT ON app.audit_log TO eda_app;
GRANT SELECT (id, org_id, actor_type, actor_id, action, target_type, target_id, ip_trunc, request_id, metadata, created_at) ON app.audit_log TO eda_jobs;

-- app.audit_seals (K; eda_app yalnız app.org_audit_seals() ile)
GRANT SELECT (id, chain_key, org_id, period_start, period_end, row_count, first_row_id, last_row_id, merkle_root, prev_seal_hash, seal_hash, published_object_key, published_at, created_at) ON app.audit_seals TO eda_jobs;
GRANT INSERT (id, chain_key, org_id, period_start, period_end, row_count, first_row_id, last_row_id, merkle_root, prev_seal_hash, seal_hash, published_object_key, published_at, created_at) ON app.audit_seals TO eda_jobs;
GRANT UPDATE (published_object_key, published_at) ON app.audit_seals TO eda_jobs;

-- app.deletion_log (K; yalnız app.log_deletion() ve eda_jobs yazar)
GRANT SELECT (id, table_name, row_id, org_id, reason, deleted_at, exported_at) ON app.deletion_log TO eda_jobs;
GRANT INSERT (table_name, row_id, org_id, reason, deleted_at) ON app.deletion_log TO eda_jobs;
GRANT UPDATE (exported_at) ON app.deletion_log TO eda_jobs;

-- app.announcements (K)
CREATE TRIGGER announcements_set_updated_at BEFORE UPDATE ON app.announcements
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.announcements TO eda_app;

-- app.feature_flags (K)
CREATE TRIGGER feature_flags_set_updated_at BEFORE UPDATE ON app.feature_flags
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.feature_flags TO eda_app;

-- app.system_settings (K)
CREATE TRIGGER system_settings_set_updated_at BEFORE UPDATE ON app.system_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.system_settings TO eda_app;

-- app.support_tickets
ALTER TABLE app.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.support_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY support_tickets_tenant_guard ON app.support_tickets AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY support_tickets_select ON app.support_tickets FOR SELECT
  USING (support_tickets.user_id = (SELECT app.current_user_id()) OR (SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY support_tickets_insert ON app.support_tickets FOR INSERT
  WITH CHECK (support_tickets.user_id = (SELECT app.current_user_id()));
CREATE POLICY support_tickets_update ON app.support_tickets FOR UPDATE
  USING (support_tickets.user_id = (SELECT app.current_user_id()))
  WITH CHECK (support_tickets.user_id = (SELECT app.current_user_id()));
CREATE TRIGGER support_tickets_forbid_key_change BEFORE UPDATE ON app.support_tickets
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER support_tickets_set_updated_at BEFORE UPDATE ON app.support_tickets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.support_tickets TO eda_app;
GRANT DELETE ON app.support_tickets TO eda_jobs;
GRANT SELECT (id, org_id, user_id, status, closed_at, created_at, updated_at) ON app.support_tickets TO eda_jobs;

-- app.org_closures (okuma owner; yazan api (definer) ve eda_jobs (035 §8.2))
ALTER TABLE app.org_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.org_closures FORCE ROW LEVEL SECURITY;
CREATE POLICY org_closures_tenant_guard ON app.org_closures AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY org_closures_select ON app.org_closures FOR SELECT
  USING ((SELECT app.member_role()) = 'owner');
CREATE TRIGGER org_closures_forbid_key_change BEFORE UPDATE ON app.org_closures
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
CREATE TRIGGER org_closures_set_updated_at BEFORE UPDATE ON app.org_closures
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT ON app.org_closures TO eda_app;
GRANT SELECT (id, org_id, phase, mode, requested_at, return_until, frozen_at, delete_after, deleting_started_at, deleted_at, cancelled_at, export_ids, export_verified_at, return_confirmed_at, blocked_reason) ON app.org_closures TO eda_jobs;
GRANT UPDATE (phase, frozen_at, delete_after, deleting_started_at, deleted_at, cancelled_at, export_verified_at, blocked_reason) ON app.org_closures TO eda_jobs;

-- app.kvkk_requests
ALTER TABLE app.kvkk_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.kvkk_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY kvkk_requests_tenant_guard ON app.kvkk_requests AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY kvkk_requests_select ON app.kvkk_requests FOR SELECT
  USING (kvkk_requests.requester_user_id = (SELECT app.current_user_id()) OR (SELECT app.member_role()) IN ('owner', 'admin'));
CREATE POLICY kvkk_requests_insert ON app.kvkk_requests FOR INSERT
  WITH CHECK (kvkk_requests.requester_user_id = (SELECT app.current_user_id()));
CREATE POLICY kvkk_requests_update ON app.kvkk_requests FOR UPDATE
  USING ((SELECT app.member_role()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT app.member_role()) IN ('owner', 'admin'));
CREATE TRIGGER kvkk_requests_forbid_key_change BEFORE UPDATE ON app.kvkk_requests
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.requester_user_id IS DISTINCT FROM NEW.requester_user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'requester_user_id');
CREATE TRIGGER kvkk_requests_set_updated_at BEFORE UPDATE ON app.kvkk_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT, INSERT, UPDATE ON app.kvkk_requests TO eda_app;
GRANT DELETE ON app.kvkk_requests TO eda_jobs;
GRANT SELECT (id, org_id, requester_user_id, request_type, status, scope, due_at, completed_at, created_at, updated_at) ON app.kvkk_requests TO eda_jobs;
GRANT UPDATE (status, completed_at) ON app.kvkk_requests TO eda_jobs;

-- app.product_events (içeriksiz; ekli)
ALTER TABLE app.product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_events FORCE ROW LEVEL SECURITY;
CREATE POLICY product_events_tenant_guard ON app.product_events AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY product_events_insert ON app.product_events FOR INSERT
  WITH CHECK (app.is_org_member(product_events.org_id));
CREATE TRIGGER product_events_forbid_key_change BEFORE UPDATE ON app.product_events
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id');
REVOKE ALL ON app.product_events FROM eda_app, eda_worker;
GRANT INSERT ON app.product_events TO eda_app;
GRANT DELETE ON app.product_events TO eda_jobs;
GRANT SELECT (id, org_id, user_id, event_name, props, created_at) ON app.product_events TO eda_jobs;

-- app.support_access_grants (V1.1; politika MVP'de kurulur)
ALTER TABLE app.support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.support_access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY support_access_grants_tenant_guard ON app.support_access_grants AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL)
  WITH CHECK (org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
CREATE POLICY support_access_grants_select ON app.support_access_grants FOR SELECT
  USING ((SELECT app.member_role()) = 'owner');
CREATE POLICY support_access_grants_insert ON app.support_access_grants FOR INSERT
  WITH CHECK ((SELECT app.member_role()) = 'owner');
CREATE POLICY support_access_grants_update ON app.support_access_grants FOR UPDATE
  USING ((SELECT app.member_role()) = 'owner')
  WITH CHECK ((SELECT app.member_role()) = 'owner');
CREATE TRIGGER support_access_grants_forbid_key_change BEFORE UPDATE ON app.support_access_grants
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.granted_by IS DISTINCT FROM NEW.granted_by)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'granted_by');
GRANT SELECT, INSERT, UPDATE ON app.support_access_grants TO eda_app;
GRANT DELETE ON app.support_access_grants TO eda_jobs;
GRANT SELECT (id, org_id, expires_at, created_at) ON app.support_access_grants TO eda_jobs;

-- app.email_deliveries (kullanıcıya SELECT yok; yazma app.email_enqueue() (P04a), durum güncellemesi worker)
ALTER TABLE app.email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY email_deliveries_tenant_guard ON app.email_deliveries AS RESTRICTIVE FOR ALL TO eda_app, eda_worker
  USING (user_id = (SELECT app.current_user_id()) AND (org_id IS NULL OR org_id = (SELECT app.current_org_id())))
  WITH CHECK (user_id = (SELECT app.current_user_id()) AND (org_id IS NULL OR org_id = (SELECT app.current_org_id())));
CREATE POLICY email_deliveries_select ON app.email_deliveries FOR SELECT TO eda_worker
  USING (true);
CREATE POLICY email_deliveries_update ON app.email_deliveries FOR UPDATE TO eda_worker
  USING (true)
  WITH CHECK (true);
CREATE TRIGGER email_deliveries_forbid_key_change BEFORE UPDATE ON app.email_deliveries
  FOR EACH ROW WHEN (OLD.org_id IS DISTINCT FROM NEW.org_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION app.forbid_key_change('org_id', 'user_id');
CREATE TRIGGER email_deliveries_set_updated_at BEFORE UPDATE ON app.email_deliveries
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
GRANT SELECT (id, org_id, user_id, invitation_id, kind, template_code, template_version, class, dedupe_key, params, sealed_params, expires_at, status, attempts, created_at) ON app.email_deliveries TO eda_worker;
GRANT UPDATE (status, attempts, provider_message_id, error_code, sent_at, sealed_params) ON app.email_deliveries TO eda_worker;
GRANT DELETE ON app.email_deliveries TO eda_jobs;
GRANT SELECT (id, org_id, user_id, kind, class, status, attempts, expires_at, created_at, updated_at) ON app.email_deliveries TO eda_jobs;
GRANT UPDATE (status) ON app.email_deliveries TO eda_jobs;

-- app.admin_rollup_usage_daily (K; yalnız eda_jobs yazar, eda_readonly_admin okur)
GRANT SELECT (day, org_id, model_alias, provider_id, task, data_class, calls, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_micro_usd, credits) ON app.admin_rollup_usage_daily TO eda_jobs;
GRANT INSERT (day, org_id, model_alias, provider_id, task, data_class, calls, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_micro_usd, credits) ON app.admin_rollup_usage_daily TO eda_jobs;
GRANT UPDATE (day, org_id, model_alias, provider_id, task, data_class, calls, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_micro_usd, credits) ON app.admin_rollup_usage_daily TO eda_jobs;
GRANT SELECT ON app.admin_rollup_usage_daily TO eda_readonly_admin;

-- app.admin_rollup_orgs_daily (K)
GRANT SELECT (day, org_id, plan_code, active_users, seats, storage_bytes, files_count) ON app.admin_rollup_orgs_daily TO eda_jobs;
GRANT INSERT (day, org_id, plan_code, active_users, seats, storage_bytes, files_count) ON app.admin_rollup_orgs_daily TO eda_jobs;
GRANT UPDATE (day, org_id, plan_code, active_users, seats, storage_bytes, files_count) ON app.admin_rollup_orgs_daily TO eda_jobs;
GRANT SELECT ON app.admin_rollup_orgs_daily TO eda_readonly_admin;

-- app.admin_rollup_sources_hourly (K)
GRANT SELECT (hour, source, requests, errors, p95_ms, breaker_state, bucket_fill_pct, live_fallback_count) ON app.admin_rollup_sources_hourly TO eda_jobs;
GRANT INSERT (hour, source, requests, errors, p95_ms, breaker_state, bucket_fill_pct, live_fallback_count) ON app.admin_rollup_sources_hourly TO eda_jobs;
GRANT UPDATE (hour, source, requests, errors, p95_ms, breaker_state, bucket_fill_pct, live_fallback_count) ON app.admin_rollup_sources_hourly TO eda_jobs;
GRANT SELECT ON app.admin_rollup_sources_hourly TO eda_readonly_admin;

-- app.admin_rollup_product_daily (K)
GRANT SELECT (day, metric, value) ON app.admin_rollup_product_daily TO eda_jobs;
GRANT INSERT (day, metric, value) ON app.admin_rollup_product_daily TO eda_jobs;
GRANT UPDATE (day, metric, value) ON app.admin_rollup_product_daily TO eda_jobs;
GRANT SELECT ON app.admin_rollup_product_daily TO eda_readonly_admin;

-- app.partner_rollup_monthly (K; kullanıcı kırılımı yok)
GRANT SELECT (month, partner_code, org_id, credits_used, paid_amount_kurus) ON app.partner_rollup_monthly TO eda_jobs;
GRANT INSERT (month, partner_code, org_id, credits_used, paid_amount_kurus) ON app.partner_rollup_monthly TO eda_jobs;
GRANT UPDATE (month, partner_code, org_id, credits_used, paid_amount_kurus) ON app.partner_rollup_monthly TO eda_jobs;
GRANT SELECT ON app.partner_rollup_monthly TO eda_readonly_admin;
