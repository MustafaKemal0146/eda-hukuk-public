-- eda:kind schema
-- eda:patched ai_usage, credit_ledger ve audit_log aylık RANGE bölümleme (030 §1.6); credit_reservations fillfactor = 90 (030 §1.5); ON DELETE SET NULL (kolon) (030 §1.4)
-- L2 (032 §2.1): app AI işletimi, ticari ve platform tabloları (030 §10–§12, 046 §11.1, 045 §13.2);
-- drizzle-kit generate çıktısı. Bölümler app.ensure_partitions() ile kurulur (partition_initial);
-- DEFAULT bölüm YOK. RLS + GRANT aynı commit'teki rls_app_ai_billing_platform'dadır.
CREATE TABLE "app"."admin_rollup_orgs_daily" (
	"day" date NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_code" text,
	"active_users" integer NOT NULL,
	"seats" integer NOT NULL,
	"storage_bytes" bigint NOT NULL,
	"files_count" integer NOT NULL,
	CONSTRAINT "admin_rollup_orgs_daily_pkey" PRIMARY KEY("day","org_id")
);
--> statement-breakpoint
CREATE TABLE "app"."admin_rollup_product_daily" (
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "admin_rollup_product_daily_pkey" PRIMARY KEY("day","metric"),
	CONSTRAINT "admin_rollup_product_daily_metric_chk" CHECK ("metric" IN ('time_to_first_verified_answer', 'weekly_active_lawyers', 'petitions_exported', 'deadlines_confirmed', 'kunye_checks_run', 'trial_to_paid_conversion'))
);
--> statement-breakpoint
CREATE TABLE "app"."admin_rollup_sources_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"requests" integer NOT NULL,
	"errors" integer NOT NULL,
	"p95_ms" integer,
	"breaker_state" text NOT NULL,
	"bucket_fill_pct" integer,
	"live_fallback_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "admin_rollup_sources_hourly_pkey" PRIMARY KEY("hour","source"),
	CONSTRAINT "admin_rollup_sources_hourly_breaker_state_chk" CHECK ("breaker_state" IN ('closed', 'open', 'half_open'))
);
--> statement-breakpoint
CREATE TABLE "app"."admin_rollup_usage_daily" (
	"day" date NOT NULL,
	"org_id" uuid,
	"model_alias" text NOT NULL,
	"provider_id" text NOT NULL,
	"task" text NOT NULL,
	"data_class" text NOT NULL,
	"calls" integer NOT NULL,
	"input_tokens" bigint NOT NULL,
	"cached_input_tokens" bigint NOT NULL,
	"output_tokens" bigint NOT NULL,
	"reasoning_tokens" bigint NOT NULL,
	"cost_micro_usd" bigint NOT NULL,
	"credits" bigint NOT NULL,
	CONSTRAINT "admin_rollup_usage_daily_uq" UNIQUE NULLS NOT DISTINCT("day","org_id","model_alias","provider_id","task","data_class")
);
--> statement-breakpoint
CREATE TABLE "app"."ai_models" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"alias" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"cache_hit_offpeak_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"cache_hit_peak_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"input_offpeak_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"input_peak_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"output_offpeak_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"output_peak_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"cache_write_micro_usd_per_mtok" bigint DEFAULT 0 NOT NULL,
	"peak_schedule" jsonb,
	"context_budget" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"thinking" text DEFAULT 'off' NOT NULL,
	"capabilities" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"eval_gate_passed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_uq" UNIQUE("alias","provider_id","model_id"),
	CONSTRAINT "ai_models_alias_chk" CHECK ("alias" IN ('edai-flash', 'edai-pro')),
	CONSTRAINT "ai_models_context_budget_chk" CHECK ("context_budget" > 0),
	CONSTRAINT "ai_models_max_output_tokens_chk" CHECK ("max_output_tokens" > 0),
	CONSTRAINT "ai_models_thinking_chk" CHECK ("thinking" IN ('off', 'low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "app"."ai_policy_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"policy_version" text NOT NULL,
	"text_sha256" "bytea" NOT NULL,
	"provider_id" text,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_trunc" "inet",
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_policy_acceptances_kind_chk" CHECK ("kind" IN ('org_ai_policy', 'public_mode_enable', 'case_ai_authorization', 'sensitive_eu_scc_ack')),
	CONSTRAINT "ai_policy_acceptances_text_sha256_chk" CHECK (octet_length("text_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "app"."ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"region" text NOT NULL,
	"transfer_basis" text,
	"allowed_data_classes" text[] DEFAULT '{public}'::text[] NOT NULL,
	"secret_ref" text,
	"base_url" text,
	"training_use" boolean DEFAULT true NOT NULL,
	"human_review" boolean DEFAULT true NOT NULL,
	"retention_days" integer,
	"abuse_monitoring_exemption_ref" text,
	"dpa_ref" text,
	"scc_notified_at" timestamp with time zone,
	"client_access_from" timestamp with time zone,
	"enabled" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_id_chk" CHECK ("id" ~ '^[a-z0-9-]{2,32}$'),
	CONSTRAINT "ai_providers_kind_chk" CHECK ("kind" IN ('deepseek', 'azure', 'vertex', 'anthropic', 'openai_compatible', 'mock')),
	CONSTRAINT "ai_providers_region_chk" CHECK ("region" IN ('TR', 'EU', 'US', 'CN', 'NONE')),
	CONSTRAINT "ai_providers_transfer_basis_chk" CHECK ("transfer_basis" IN ('none', 'domestic', 'scc_pending', 'scc_notified')),
	CONSTRAINT "ai_providers_allowed_data_classes_chk" CHECK ("allowed_data_classes" <@ ARRAY['public', 'client', 'case']::text[]),
	CONSTRAINT "ai_providers_mock_chk" CHECK (("kind" = 'mock') = ("region" = 'NONE') AND (("kind" = 'mock') = ("transfer_basis" IS NULL))),
	CONSTRAINT "ai_providers_class_basis_chk" CHECK ("kind" = 'mock' OR "allowed_data_classes" <@ ARRAY['public']::text[] OR "transfer_basis" IN ('domestic', 'scc_notified')),
	CONSTRAINT "ai_providers_class_terms_chk" CHECK ("kind" = 'mock' OR "allowed_data_classes" <@ ARRAY['public']::text[] OR (NOT "training_use" AND NOT "human_review" AND "retention_days" <= 30)),
	CONSTRAINT "ai_providers_scc_chk" CHECK ("transfer_basis" IS DISTINCT FROM 'scc_notified' OR "scc_notified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."ai_task_routes" (
	"task" text PRIMARY KEY NOT NULL,
	"alias_source" text NOT NULL,
	"default_alias" text,
	"thinking_override" text,
	"tool_set" text NOT NULL,
	"credit_op_code" text,
	"max_output_tokens" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_task_routes_task_chk" CHECK ("task" IN ('chat', 'draft_document', 'edit_document', 'title', 'summarize_history', 'search_overview', 'decision_summary', 'file_card', 'pii_risk_check', 'citation_support_check')),
	CONSTRAINT "ai_task_routes_alias_source_chk" CHECK ("alias_source" IN ('fixed', 'user_choice', 'conversation_last', 'local_engine')),
	CONSTRAINT "ai_task_routes_default_alias_chk" CHECK ("default_alias" IN ('edai-flash', 'edai-pro')),
	CONSTRAINT "ai_task_routes_thinking_override_chk" CHECK ("thinking_override" IN ('off', 'low', 'medium', 'high')),
	CONSTRAINT "ai_task_routes_tool_set_chk" CHECK ("tool_set" IN ('chat_tools', 'submit_outline', 'edit_document', 'submit_result', 'none')),
	CONSTRAINT "ai_task_routes_credit_op_code_chk" CHECK ("credit_op_code" IN ('chat_fast', 'chat_deep', 'document_draft', 'edit_round', 'file_card', 'ocr_20_pages', 'decision_search', 'legislation_search', 'kunye_check', 'citation_verify', 'deadline_calc', 'search_overview', 'title', 'summarize')),
	CONSTRAINT "ai_task_routes_alias_chk" CHECK (("alias_source" = 'local_engine') = ("default_alias" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."ai_usage" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"conversation_id" uuid,
	"message_id" uuid,
	"case_id" uuid,
	"document_id" uuid,
	"file_id" uuid,
	"reservation_id" uuid,
	"task" text NOT NULL,
	"op_code" text,
	"model_alias" text NOT NULL,
	"provider_id" text NOT NULL,
	"ai_model_id" uuid,
	"model_id" text NOT NULL,
	"region" text NOT NULL,
	"data_class" text NOT NULL,
	"thinking" text NOT NULL,
	"step_no" smallint DEFAULT 0 NOT NULL,
	"attempt_no" smallint DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"usage_source" text DEFAULT 'provider' NOT NULL,
	"pricing_window" text NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"ttft_ms" integer,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error_code" text,
	"finish_reason" text,
	"fallback_from_provider_id" text,
	"prefix_hash" text,
	"prompt_version_id" uuid,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "ai_usage_task_chk" CHECK ("task" IN ('chat', 'draft_document', 'edit_document', 'title', 'summarize_history', 'search_overview', 'decision_summary', 'file_card', 'pii_risk_check', 'citation_support_check')),
	CONSTRAINT "ai_usage_region_chk" CHECK ("region" IN ('TR', 'EU', 'US', 'CN', 'NONE')),
	CONSTRAINT "ai_usage_data_class_chk" CHECK ("data_class" IN ('public', 'client', 'case')),
	CONSTRAINT "ai_usage_thinking_chk" CHECK ("thinking" IN ('off', 'low', 'medium', 'high')),
	CONSTRAINT "ai_usage_usage_source_chk" CHECK ("usage_source" IN ('provider', 'estimated')),
	CONSTRAINT "ai_usage_pricing_window_chk" CHECK ("pricing_window" IN ('peak', 'off_peak', 'flat')),
	CONSTRAINT "ai_usage_status_chk" CHECK ("status" IN ('success', 'error', 'timeout', 'stopped')),
	CONSTRAINT "ai_usage_flags_chk" CHECK ("flags" <@ ARRAY['cjk_leak', 'mock', 'dev_real_llm', 'beta_synthetic', 'no_tools_mode', 'reasoning_dropped', 'truncated_input', 'probe']::text[])
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "app"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"severity" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"active_during" "tstzrange" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_severity_chk" CHECK ("severity" IN ('info', 'warning', 'critical')),
	CONSTRAINT "announcements_audience_chk" CHECK ("audience" IN ('all', 'org_admins'))
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"org_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip_trunc" "inet",
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "audit_log_actor_type_chk" CHECK ("actor_type" IN ('user', 'platform_staff', 'system')),
	CONSTRAINT "audit_log_action_chk" CHECK ("action" IN ('auth.recovery.approved', 'auth.recovery.rejected', 'auth.recovery.canceled', 'auth.login.success', 'auth.login.failure', 'auth.logout', 'auth.step_up', 'auth.mfa.enrolled', 'auth.mfa.removed', 'auth.mfa.reset_requested', 'auth.mfa.reset_completed', 'auth.passkey.added', 'auth.passkey.removed', 'auth.password.changed', 'auth.password.reset_requested', 'auth.email.change_requested', 'auth.email.changed', 'auth.session.revoked', 'org.created', 'org.settings.changed', 'org.member.invited', 'org.member.joined', 'org.member.role_changed', 'org.member.removed', 'org.member.suspended', 'org.member.unsuspended', 'org.member.offboarded', 'org.closure.requested', 'org.closure.frozen', 'org.closure.cancelled', 'org.ownership.transferred', 'org.conversations.transferred', 'org.deleted', 'ai_policy.accepted', 'ai_policy.residency_changed', 'ai_policy.public_mode_changed', 'ai_policy.sensitive_policy_changed', 'case.ai_disabled_changed', 'case.client_ai_consent_changed', 'case.sensitivity_changed', 'case.visibility_changed', 'case.legal_hold_changed', 'document.exported', 'document.export_override', 'citation.attested', 'file.bulk_downloaded', 'case_ai_log.exported', 'conversation.exported', 'data.exported', 'data_subject.searched', 'feedback_share.created', 'ai_provider.changed', 'ai_provider.class_permission_changed', 'ai_model.changed', 'ai_route.changed', 'prompt_version.activated', 'system_setting.changed', 'feature_flag.changed', 'maintenance_mode.changed', 'admin.application.approved', 'admin.application.rejected', 'admin.user.suspended', 'admin.user.unsuspended', 'admin.org.suspended', 'admin.org.unsuspended', 'admin.session.revoked', 'admin.coupon.changed', 'admin.payout_report.generated', 'break_glass.requested', 'break_glass.granted', 'break_glass.used', 'break_glass.revoked', 'kvkk_request.received', 'kvkk_request.completed', 'kvkk_request.rejected', 'user.erased', 'retention.purge.run', 'org_key.rotated', 'org_key.shredded', 'restore.deletion_log_replayed', 'billing.subscription.changed', 'billing.credit.adjusted'))
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "app"."audit_seals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chain_key" text NOT NULL,
	"org_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"row_count" integer NOT NULL,
	"first_row_id" uuid,
	"last_row_id" uuid,
	"merkle_root" "bytea" NOT NULL,
	"prev_seal_hash" "bytea",
	"seal_hash" "bytea" NOT NULL,
	"published_object_key" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_seals_period_uq" UNIQUE("chain_key","period_start"),
	CONSTRAINT "audit_seals_merkle_root_chk" CHECK (octet_length("merkle_root") = 32),
	CONSTRAINT "audit_seals_seal_hash_chk" CHECK (octet_length("seal_hash") = 32),
	CONSTRAINT "audit_seals_chain_chk" CHECK ("chain_key" = coalesce("org_id"::text, 'platform'))
);
--> statement-breakpoint
CREATE TABLE "app"."billing_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"plan_code" text NOT NULL,
	"billing_period" text NOT NULL,
	"seats" integer NOT NULL,
	"list_price_kurus" bigint NOT NULL,
	"price_kurus" bigint NOT NULL,
	"coupon_id" uuid,
	"provider_plan_ref" text NOT NULL,
	"provider_token" text,
	"provider_token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'created' NOT NULL,
	"provider_subscription_ref" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkouts_billing_period_chk" CHECK ("billing_period" IN ('monthly', 'yearly')),
	CONSTRAINT "billing_checkouts_seats_chk" CHECK ("seats" >= 1),
	CONSTRAINT "billing_checkouts_status_chk" CHECK ("status" IN ('created', 'awaiting_payment', 'completed', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "app"."billing_events" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"org_id" uuid,
	"subscription_id" uuid,
	"outcome" text NOT NULL,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_outcome_chk" CHECK ("outcome" IN ('applied', 'ignored', 'amount_mismatch', 'unknown_subscription', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."billing_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"tax_kind" text NOT NULL,
	"tax_id_enc" "bytea" NOT NULL,
	"tax_id_last4" text NOT NULL,
	"tax_office" text,
	"address_line" text NOT NULL,
	"district" text,
	"city" text NOT NULL,
	"postal_code" text,
	"country" text DEFAULT 'TR' NOT NULL,
	"invoice_email" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_profiles_tax_kind_chk" CHECK ("tax_kind" IN ('tckn', 'vkn')),
	CONSTRAINT "billing_profiles_tax_id_last4_chk" CHECK ("tax_id_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "billing_profiles_invoice_email_chk" CHECK ("invoice_email" = lower("invoice_email")),
	CONSTRAINT "billing_profiles_vkn_office_chk" CHECK ("tax_kind" = 'tckn' OR "tax_office" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"subscription_id" uuid,
	"redeemed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_uq" UNIQUE("coupon_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "app"."coupons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"percent_off" integer,
	"amount_off_kurus" bigint,
	"plan_codes" text[],
	"duration_months" integer,
	"partner_id" uuid,
	"baro" text,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"valid_during" "tstzrange" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_uq" UNIQUE("code"),
	CONSTRAINT "coupons_code_chk" CHECK ("code" ~ '^[A-Z0-9-]{4,32}$'),
	CONSTRAINT "coupons_discount_type_chk" CHECK ("discount_type" IN ('percent', 'amount')),
	CONSTRAINT "coupons_percent_off_chk" CHECK ("percent_off" BETWEEN 1 AND 100),
	CONSTRAINT "coupons_amount_off_kurus_chk" CHECK ("amount_off_kurus" > 0),
	CONSTRAINT "coupons_duration_months_chk" CHECK ("duration_months" > 0),
	CONSTRAINT "coupons_max_redemptions_chk" CHECK ("max_redemptions" > 0),
	CONSTRAINT "coupons_type_chk" CHECK (("discount_type" = 'percent') = ("percent_off" IS NOT NULL) AND ("discount_type" = 'amount') = ("amount_off_kurus" IS NOT NULL)),
	CONSTRAINT "coupons_limit_chk" CHECK ("max_redemptions" IS NULL OR "redeemed_count" <= "max_redemptions")
);
--> statement-breakpoint
CREATE TABLE "app"."credit_ledger" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"op_code" text,
	"reservation_id" uuid,
	"user_id" uuid,
	"subscription_id" uuid,
	"payment_id" uuid,
	"coupon_redemption_id" uuid,
	"expires_at" timestamp with time zone,
	"note_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "credit_ledger_entry_type_chk" CHECK ("entry_type" IN ('trial_grant', 'monthly_grant', 'purchase', 'consume', 'refund', 'adjustment', 'expire')),
	CONSTRAINT "credit_ledger_amount_chk" CHECK ("amount" <> 0),
	CONSTRAINT "credit_ledger_op_code_chk" CHECK ("op_code" IN ('chat_fast', 'chat_deep', 'document_draft', 'edit_round', 'file_card', 'ocr_20_pages', 'decision_search', 'legislation_search', 'kunye_check', 'citation_verify', 'deadline_calc', 'search_overview', 'title', 'summarize')),
	CONSTRAINT "credit_ledger_note_code_chk" CHECK ("note_code" IN ('goodwill', 'service_incident', 'refund_reversal', 'beta_grant', 'migration', 'correction')),
	CONSTRAINT "credit_ledger_sign_chk" CHECK (("entry_type" IN ('trial_grant', 'monthly_grant', 'purchase', 'refund') AND "amount" > 0) OR ("entry_type" IN ('consume', 'expire') AND "amount" < 0) OR "entry_type" = 'adjustment'),
	CONSTRAINT "credit_ledger_consume_chk" CHECK ("entry_type" <> 'consume' OR "op_code" IS NOT NULL)
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "app"."credit_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"op_code" text NOT NULL,
	"credits" integer NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"document_id" uuid,
	"file_id" uuid,
	"settled_at" timestamp with time zone,
	"settled_ledger_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_reservations_op_code_chk" CHECK ("op_code" IN ('chat_fast', 'chat_deep', 'document_draft', 'edit_round', 'file_card', 'ocr_20_pages', 'decision_search', 'legislation_search', 'kunye_check', 'citation_verify', 'deadline_calc', 'search_overview', 'title', 'summarize')),
	CONSTRAINT "credit_reservations_credits_chk" CHECK ("credits" >= 0),
	CONSTRAINT "credit_reservations_status_chk" CHECK ("status" IN ('held', 'settled', 'released', 'expired'))
) WITH (fillfactor = 90);
--> statement-breakpoint
CREATE TABLE "app"."deletion_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"org_id" uuid,
	"reason" text DEFAULT 'user_request' NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	CONSTRAINT "deletion_log_row_uq" UNIQUE("table_name","row_id"),
	CONSTRAINT "deletion_log_reason_chk" CHECK ("reason" IN ('user_request', 'retention', 'kvkk_erasure', 'org_closure'))
);
--> statement-breakpoint
CREATE TABLE "app"."email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"invitation_id" uuid,
	"kind" text NOT NULL,
	"template_code" text NOT NULL,
	"template_version" text NOT NULL,
	"class" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sealed_params" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_dedupe_key_uq" UNIQUE("dedupe_key"),
	CONSTRAINT "email_deliveries_class_chk" CHECK ("class" IN ('security', 'deadline', 'action', 'service')),
	CONSTRAINT "email_deliveries_status_chk" CHECK ("status" IN ('queued', 'sending', 'sent', 'failed', 'suppressed', 'expired', 'cancelled')),
	CONSTRAINT "email_deliveries_recipient_chk" CHECK ("user_id" IS NOT NULL OR "invitation_id" IS NOT NULL OR "sealed_params" IS NOT NULL OR "status" IN ('sent', 'failed', 'suppressed', 'expired', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"suite" text NOT NULL,
	"gate" text,
	"target" jsonb NOT NULL,
	"git_sha" text NOT NULL,
	"dataset_sha256" "bytea",
	"metrics" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_runs_git_sha_chk" CHECK ("git_sha" ~ '^[0-9a-f]{7,40}$')
);
--> statement-breakpoint
CREATE TABLE "app"."feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_chk" CHECK ("key" ~ '^[a-z0-9_.]{2,64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"subscription_id" uuid,
	"invoice_no" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"subtotal_kurus" bigint NOT NULL,
	"vat_kurus" bigint NOT NULL,
	"total_kurus" bigint NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"billing_snapshot" jsonb NOT NULL,
	"buyer_tax_id_enc" "bytea",
	"provider_invoice_ref" text,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_no_uq" UNIQUE("invoice_no"),
	CONSTRAINT "invoices_status_chk" CHECK ("status" IN ('draft', 'issued', 'paid', 'void')),
	CONSTRAINT "invoices_currency_chk" CHECK ("currency" = 'TRY'),
	CONSTRAINT "invoices_total_chk" CHECK ("total_kurus" = "subtotal_kurus" + "vat_kurus")
);
--> statement-breakpoint
CREATE TABLE "app"."kvkk_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"requester_user_id" uuid,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"description" text,
	"due_at" timestamp with time zone NOT NULL,
	"export_id" uuid,
	"rejection_reason" text,
	"scope" text DEFAULT 'org_data' NOT NULL,
	"subject_ref_hmac" "bytea",
	"identity_verified_at" timestamp with time zone,
	"decision" jsonb,
	"handled_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kvkk_requests_request_type_chk" CHECK ("request_type" IN ('access', 'rectification', 'erasure', 'objection', 'export')),
	CONSTRAINT "kvkk_requests_status_chk" CHECK ("status" IN ('received', 'in_progress', 'completed', 'rejected')),
	CONSTRAINT "kvkk_requests_rejection_reason_chk" CHECK ("rejection_reason" IN ('identity_unverified', 'not_found', 'retention_obligation', 'legal_hold', 'third_party_rights', 'manifestly_unfounded', 'out_of_scope')),
	CONSTRAINT "kvkk_requests_scope_chk" CHECK ("scope" IN ('org_data', 'own_account')),
	CONSTRAINT "kvkk_requests_subject_ref_hmac_chk" CHECK ("subject_ref_hmac" IS NULL OR octet_length("subject_ref_hmac") = 32)
);
--> statement-breakpoint
CREATE TABLE "app"."org_closures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"phase" text DEFAULT 'return' NOT NULL,
	"mode" text DEFAULT 'standard' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"return_until" timestamp with time zone NOT NULL,
	"frozen_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"deleting_started_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"export_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"export_verified_at" timestamp with time zone,
	"return_confirmed_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_closures_phase_chk" CHECK ("phase" IN ('return', 'frozen', 'deleting', 'deleted', 'cancelled')),
	CONSTRAINT "org_closures_mode_chk" CHECK ("mode" IN ('standard', 'account_erasure')),
	CONSTRAINT "org_closures_blocked_reason_chk" CHECK ("blocked_reason" IN ('legal_hold', 'export_incomplete'))
);
--> statement-breakpoint
CREATE TABLE "app"."partner_commissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"base_amount_kurus" bigint NOT NULL,
	"rate_bp" integer NOT NULL,
	"commission_kurus" bigint NOT NULL,
	"status" text DEFAULT 'calculated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_commissions_uq" UNIQUE("partner_id","org_id","period_month"),
	CONSTRAINT "partner_commissions_period_month_chk" CHECK (extract(day FROM "period_month") = 1),
	CONSTRAINT "partner_commissions_status_chk" CHECK ("status" IN ('calculated', 'approved', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "app"."partner_rollup_monthly" (
	"month" date NOT NULL,
	"partner_code" text NOT NULL,
	"org_id" uuid NOT NULL,
	"credits_used" bigint NOT NULL,
	"paid_amount_kurus" bigint NOT NULL,
	CONSTRAINT "partner_rollup_monthly_pkey" PRIMARY KEY("month","partner_code","org_id"),
	CONSTRAINT "partner_rollup_monthly_month_chk" CHECK (extract(day FROM "month") = 1)
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_id" uuid,
	"subscription_id" uuid,
	"provider" text NOT NULL,
	"provider_payment_ref" text NOT NULL,
	"status" text NOT NULL,
	"amount_kurus" bigint NOT NULL,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"failure_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_ref_uq" UNIQUE("provider","provider_payment_ref"),
	CONSTRAINT "payments_provider_chk" CHECK ("provider" IN ('iyzico', 'manual')),
	CONSTRAINT "payments_status_chk" CHECK ("status" IN ('pending', 'succeeded', 'failed', 'refunded')),
	CONSTRAINT "payments_amount_kurus_chk" CHECK ("amount_kurus" > 0),
	CONSTRAINT "payments_currency_chk" CHECK ("currency" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "app"."plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"per_seat" boolean DEFAULT false NOT NULL,
	"seat_min" integer DEFAULT 1 NOT NULL,
	"seat_max" integer,
	"monthly_credits" integer NOT NULL,
	"monthly_ocr_pages" integer NOT NULL,
	"storage_quota_bytes" bigint NOT NULL,
	"price_monthly_kurus" bigint,
	"price_yearly_kurus" bigint,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"iyzico_plan_ref_monthly" text,
	"iyzico_plan_ref_yearly" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_chk" CHECK ("code" IN ('trial', 'trainee', 'lawyer', 'lawyer_pro', 'firm', 'enterprise')),
	CONSTRAINT "plans_seat_min_chk" CHECK ("seat_min" >= 1),
	CONSTRAINT "plans_seat_max_chk" CHECK ("seat_max" IS NULL OR "seat_max" >= "seat_min"),
	CONSTRAINT "plans_monthly_credits_chk" CHECK ("monthly_credits" >= 0),
	CONSTRAINT "plans_monthly_ocr_pages_chk" CHECK ("monthly_ocr_pages" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."product_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"event_name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_events_event_name_chk" CHECK ("event_name" IN ('answer_with_verified_citation', 'document_exported', 'deadline_approved', 'kunye_check_completed', 'trial_converted', 'weekly_active', 'file_uploaded', 'conversation_started'))
);
--> statement-breakpoint
CREATE TABLE "app"."prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"prompt_key" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"sha256" "bytea" NOT NULL,
	"locked_sha256" "bytea",
	"token_count" integer NOT NULL,
	"variables" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"activated_by" uuid,
	"retired_at" timestamp with time zone,
	"eval_run_id" uuid,
	"legal_review_by" text,
	"legal_review_at" date,
	"change_note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_uq" UNIQUE("prompt_key","version"),
	CONSTRAINT "prompt_versions_sha_uq" UNIQUE("prompt_key","sha256"),
	CONSTRAINT "prompt_versions_prompt_key_chk" CHECK ("prompt_key" ~ '^[a-z0-9_.]{3,64}$'),
	CONSTRAINT "prompt_versions_version_chk" CHECK ("version" >= 1),
	CONSTRAINT "prompt_versions_sha256_chk" CHECK (octet_length("sha256") = 32),
	CONSTRAINT "prompt_versions_locked_sha256_chk" CHECK ("locked_sha256" IS NULL OR octet_length("locked_sha256") = 32),
	CONSTRAINT "prompt_versions_state_chk" CHECK (NOT ("is_active" AND "retired_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."provider_plan_refs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text DEFAULT 'iyzico' NOT NULL,
	"plan_code" text NOT NULL,
	"billing_period" text NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"price_kurus" bigint NOT NULL,
	"provider_plan_ref" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_plan_refs_ref_uq" UNIQUE("provider_plan_ref"),
	CONSTRAINT "provider_plan_refs_uq" UNIQUE("provider","plan_code","billing_period","seats","price_kurus"),
	CONSTRAINT "provider_plan_refs_provider_chk" CHECK ("provider" = 'iyzico'),
	CONSTRAINT "provider_plan_refs_billing_period_chk" CHECK ("billing_period" IN ('monthly', 'yearly')),
	CONSTRAINT "provider_plan_refs_seats_chk" CHECK ("seats" >= 1),
	CONSTRAINT "provider_plan_refs_price_kurus_chk" CHECK ("price_kurus" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."subscription_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_plan_code" text,
	"target_billing_period" text,
	"target_seats" integer,
	"target_price_kurus" bigint,
	"provider_plan_ref" text,
	"effective_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"failure_code" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_changes_kind_chk" CHECK ("kind" IN ('user', 'price', 'coupon_end')),
	CONSTRAINT "subscription_changes_target_billing_period_chk" CHECK ("target_billing_period" IN ('monthly', 'yearly')),
	CONSTRAINT "subscription_changes_target_seats_chk" CHECK ("target_seats" >= 1),
	CONSTRAINT "subscription_changes_status_chk" CHECK ("status" IN ('scheduled', 'applied', 'canceled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"status" text NOT NULL,
	"billing_period" text,
	"seats" integer DEFAULT 1 NOT NULL,
	"price_kurus" bigint,
	"provider" text DEFAULT 'iyzico' NOT NULL,
	"provider_subscription_ref" text,
	"provider_customer_ref" text,
	"coupon_id" uuid,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"past_due_since" timestamp with time zone,
	"provider_plan_ref" text,
	"coupon_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "subscriptions_provider_ref_uq" UNIQUE("provider","provider_subscription_ref"),
	CONSTRAINT "subscriptions_status_chk" CHECK ("status" IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
	CONSTRAINT "subscriptions_billing_period_chk" CHECK ("billing_period" IN ('monthly', 'yearly')),
	CONSTRAINT "subscriptions_seats_chk" CHECK ("seats" >= 1),
	CONSTRAINT "subscriptions_provider_chk" CHECK ("provider" IN ('iyzico', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "app"."support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"granted_by" uuid,
	"grantee_user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_access_grants_scope_chk" CHECK ("scope" IN ('case', 'conversation')),
	CONSTRAINT "support_access_grants_window_chk" CHECK ("expires_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"category" text DEFAULT 'other' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"feedback_share_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_category_chk" CHECK ("category" IN ('technical', 'billing', 'account', 'kvkk', 'other')),
	CONSTRAINT "support_tickets_priority_chk" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "support_tickets_status_chk" CHECK ("status" IN ('open', 'in_progress', 'waiting', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "app"."system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_settings_key_chk" CHECK ("key" ~ '^[a-z]+\.[a-zA-Z0-9.]+$')
);
--> statement-breakpoint
CREATE TABLE "app"."tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"tool_name" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"result_tokens" integer,
	"live" boolean DEFAULT false NOT NULL,
	"source" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_tool_name_chk" CHECK ("tool_name" IN ('search_decisions', 'get_decision', 'search_legislation', 'get_legislation_article', 'search_case_files', 'calculate_deadline', 'create_document', 'edit_document', 'submit_outline', 'submit_result')),
	CONSTRAINT "tool_calls_status_chk" CHECK ("status" IN ('success', 'error', 'not_enabled', 'timeout'))
);
--> statement-breakpoint
ALTER TABLE "app"."ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "app"."ai_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_policy_acceptances" ADD CONSTRAINT "ai_policy_acceptances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_policy_acceptances" ADD CONSTRAINT "ai_policy_acceptances_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "app"."ai_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_policy_acceptances" ADD CONSTRAINT "ai_policy_acceptances_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_policy_acceptances" ADD CONSTRAINT "ai_policy_acceptances_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_task_routes" ADD CONSTRAINT "ai_task_routes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_checkouts" ADD CONSTRAINT "billing_checkouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_checkouts" ADD CONSTRAINT "billing_checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_checkouts" ADD CONSTRAINT "billing_checkouts_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "app"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_checkouts" ADD CONSTRAINT "billing_checkouts_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "app"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."billing_profiles" ADD CONSTRAINT "billing_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "app"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_subscription_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "app"."subscriptions"("org_id","id") ON DELETE SET NULL ("subscription_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupons" ADD CONSTRAINT "coupons_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "app"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."credit_reservations" ADD CONSTRAINT "credit_reservations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."credit_reservations" ADD CONSTRAINT "credit_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_deliveries" ADD CONSTRAINT "email_deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kvkk_requests" ADD CONSTRAINT "kvkk_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kvkk_requests" ADD CONSTRAINT "kvkk_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kvkk_requests" ADD CONSTRAINT "kvkk_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kvkk_requests" ADD CONSTRAINT "kvkk_requests_export_fk" FOREIGN KEY ("org_id","export_id") REFERENCES "app"."document_exports"("org_id","id") ON DELETE SET NULL ("export_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_closures" ADD CONSTRAINT "org_closures_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_closures" ADD CONSTRAINT "org_closures_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_commissions" ADD CONSTRAINT "partner_commissions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "app"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "app"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prompt_versions" ADD CONSTRAINT "prompt_versions_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prompt_versions" ADD CONSTRAINT "prompt_versions_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "app"."eval_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_plan_refs" ADD CONSTRAINT "provider_plan_refs_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "app"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_changes" ADD CONSTRAINT "subscription_changes_target_plan_code_plans_code_fk" FOREIGN KEY ("target_plan_code") REFERENCES "app"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_changes" ADD CONSTRAINT "subscription_changes_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscription_changes" ADD CONSTRAINT "subscription_changes_subscription_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "app"."subscriptions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "app"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscriptions" ADD CONSTRAINT "subscriptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "app"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_access_grants" ADD CONSTRAINT "support_access_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_feedback_share_id_feedback_shares_id_fk" FOREIGN KEY ("feedback_share_id") REFERENCES "app"."feedback_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_models_resolve_idx" ON "app"."ai_models" USING btree ("alias","priority") WHERE "enabled";--> statement-breakpoint
CREATE INDEX "ai_policy_acceptances_idx" ON "app"."ai_policy_acceptances" USING btree ("org_id","kind","accepted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_policy_acceptances_accepted_by_idx" ON "app"."ai_policy_acceptances" USING btree ("accepted_by") WHERE "accepted_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_policy_acceptances_revoked_by_idx" ON "app"."ai_policy_acceptances" USING btree ("revoked_by") WHERE "revoked_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_task_routes_updated_by_idx" ON "app"."ai_task_routes" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_usage_reservation_idx" ON "app"."ai_usage" USING btree ("reservation_id") WHERE "reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_usage_org_idx" ON "app"."ai_usage" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_conv_idx" ON "app"."ai_usage" USING btree ("org_id","conversation_id") WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_usage_brin" ON "app"."ai_usage" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "announcements_active_idx" ON "app"."announcements" USING gist ("active_during");--> statement-breakpoint
CREATE INDEX "announcements_created_by_idx" ON "app"."announcements" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "app"."audit_log" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "app"."audit_log" USING btree ("org_id","action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_brin" ON "app"."audit_log" USING brin ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_one_open_uq" ON "app"."billing_checkouts" USING btree ("org_id") WHERE "status" IN ('created', 'awaiting_payment');--> statement-breakpoint
CREATE INDEX "billing_checkouts_org_idx" ON "app"."billing_checkouts" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "billing_checkouts_user_idx" ON "app"."billing_checkouts" USING btree ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "app"."billing_events" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coupon_redemptions_org_idx" ON "app"."coupon_redemptions" USING btree ("org_id","subscription_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_redeemed_by_idx" ON "app"."coupon_redemptions" USING btree ("redeemed_by") WHERE "redeemed_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "coupons_partner_idx" ON "app"."coupons" USING btree ("partner_id") WHERE "partner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "coupons_created_by_idx" ON "app"."coupons" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_ledger_org_idx" ON "app"."credit_ledger" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_ledger_res_idx" ON "app"."credit_ledger" USING btree ("org_id","reservation_id") WHERE "reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_ledger_brin" ON "app"."credit_ledger" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "credit_reservations_expiry_idx" ON "app"."credit_reservations" USING btree ("expires_at") WHERE "status" IN ('held');--> statement-breakpoint
CREATE INDEX "credit_reservations_held_idx" ON "app"."credit_reservations" USING btree ("org_id","user_id","op_code") WHERE "status" IN ('held');--> statement-breakpoint
CREATE INDEX "credit_reservations_user_idx" ON "app"."credit_reservations" USING btree ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deletion_log_unexported_idx" ON "app"."deletion_log" USING btree ("deleted_at") WHERE "exported_at" IS NULL;--> statement-breakpoint
CREATE INDEX "deletion_log_deleted_at_idx" ON "app"."deletion_log" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_pending_idx" ON "app"."email_deliveries" USING btree ("created_at") WHERE "status" IN ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "email_deliveries_user_idx" ON "app"."email_deliveries" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_deliveries_org_idx" ON "app"."email_deliveries" USING btree ("org_id","created_at" DESC NULLS LAST) WHERE "org_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "eval_runs_suite_idx" ON "app"."eval_runs" USING btree ("suite","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feature_flags_updated_by_idx" ON "app"."feature_flags" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "app"."invoices" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "kvkk_requests_org_idx" ON "app"."kvkk_requests" USING btree ("org_id","status","due_at");--> statement-breakpoint
CREATE INDEX "kvkk_requests_export_idx" ON "app"."kvkk_requests" USING btree ("org_id","export_id") WHERE "export_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kvkk_requests_requester_idx" ON "app"."kvkk_requests" USING btree ("requester_user_id") WHERE "requester_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kvkk_requests_handled_by_idx" ON "app"."kvkk_requests" USING btree ("handled_by") WHERE "handled_by" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "org_closures_one_active_uq" ON "app"."org_closures" USING btree ("org_id") WHERE "phase" IN ('return', 'frozen', 'deleting');--> statement-breakpoint
CREATE INDEX "org_closures_org_idx" ON "app"."org_closures" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "org_closures_requested_by_idx" ON "app"."org_closures" USING btree ("requested_by") WHERE "requested_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_org_idx" ON "app"."payments" USING btree ("org_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "app"."payments" USING btree ("invoice_id") WHERE "invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_events_org_idx" ON "app"."product_events" USING btree ("org_id","event_name","created_at");--> statement-breakpoint
CREATE INDEX "product_events_brin" ON "app"."product_events" USING brin ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_active_uq" ON "app"."prompt_versions" USING btree ("prompt_key") WHERE "is_active";--> statement-breakpoint
CREATE INDEX "prompt_versions_activated_by_idx" ON "app"."prompt_versions" USING btree ("activated_by") WHERE "activated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prompt_versions_created_by_idx" ON "app"."prompt_versions" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_changes_one_scheduled_uq" ON "app"."subscription_changes" USING btree ("subscription_id") WHERE "status" IN ('scheduled');--> statement-breakpoint
CREATE INDEX "subscription_changes_due_idx" ON "app"."subscription_changes" USING btree ("effective_at") WHERE "status" IN ('scheduled');--> statement-breakpoint
CREATE INDEX "subscription_changes_subscription_idx" ON "app"."subscription_changes" USING btree ("org_id","subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_changes_requested_by_idx" ON "app"."subscription_changes" USING btree ("requested_by") WHERE "requested_by" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_uq" ON "app"."subscriptions" USING btree ("org_id") WHERE "status" IN ('trialing', 'active', 'past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_renewal_idx" ON "app"."subscriptions" USING btree ("current_period_end") WHERE "status" IN ('active', 'past_due');--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_trial_uq" ON "app"."subscriptions" USING btree ("org_id") WHERE "plan_code" = 'trial';--> statement-breakpoint
CREATE INDEX "support_access_grants_idx" ON "app"."support_access_grants" USING btree ("org_id","grantee_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "support_access_grants_grantee_idx" ON "app"."support_access_grants" USING btree ("grantee_user_id");--> statement-breakpoint
CREATE INDEX "support_access_grants_granted_by_idx" ON "app"."support_access_grants" USING btree ("granted_by") WHERE "granted_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_tickets_org_idx" ON "app"."support_tickets" USING btree ("org_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "app"."support_tickets" USING btree ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_tickets_feedback_share_idx" ON "app"."support_tickets" USING btree ("feedback_share_id") WHERE "feedback_share_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "system_settings_updated_by_idx" ON "app"."system_settings" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tool_calls_org_idx" ON "app"."tool_calls" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_calls_brin" ON "app"."tool_calls" USING brin ("created_at");