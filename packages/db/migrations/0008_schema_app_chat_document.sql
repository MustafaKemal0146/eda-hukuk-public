-- eda:kind schema
-- eda:patched tr-TR-x-icu harmanlaması (030 §14); messages ve documents fillfactor = 90 (030 §1.5); document_versions.content COMPRESSION lz4 (030 §8); ON DELETE SET NULL (kolon) (030 §1.4)
-- L2 (032 §2.1): app sohbet, atıf, arama ve belge tabloları (030 §7–§8); drizzle-kit generate çıktısı.
-- Döngüsel bağlar (kunye_checks.report_export_id -> document_exports, message_citations.document_id ->
-- documents) aynı dosyada ALTER TABLE ile kurulur. RLS + GRANT aynı commit'teki rls_app_chat_document'tadır.
CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"title" text COLLATE "tr-TR-x-icu",
	"title_fold" text,
	"data_class" text DEFAULT 'client' NOT NULL,
	"shared_with_case" boolean DEFAULT false NOT NULL,
	"public_mode_declared_at" timestamp with time zone,
	"next_source_label" integer DEFAULT 1 NOT NULL,
	"masker_version" text,
	"last_model_alias" text,
	"summary" text,
	"summary_through_message_id" uuid,
	"summary_updated_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "conversations_data_class_chk" CHECK ("data_class" IN ('public', 'client', 'case')),
	CONSTRAINT "conversations_next_source_label_chk" CHECK ("next_source_label" >= 1),
	CONSTRAINT "conversations_last_model_alias_chk" CHECK ("last_model_alias" IN ('edai-flash', 'edai-pro')),
	CONSTRAINT "conversations_public_chk" CHECK ("data_class" <> 'public' OR "public_mode_declared_at" IS NOT NULL),
	CONSTRAINT "conversations_case_chk" CHECK ("case_id" IS NULL OR "data_class" = 'case'),
	CONSTRAINT "conversations_share_chk" CHECK (NOT "shared_with_case" OR "case_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."decision_searches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"live_requested_at" timestamp with time zone,
	"overview" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."document_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"data_scope" text,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"document_id" uuid,
	"version_id" uuid,
	"case_id" uuid,
	"conversation_id" uuid,
	"kunye_check_id" uuid,
	"requested_by" uuid,
	"object_key" text,
	"key_version" integer,
	"wrap_dek_version" integer,
	"wrapped_key" "bytea",
	"size_bytes" bigint,
	"sha256" "bytea",
	"citation_override" boolean DEFAULT false NOT NULL,
	"checklist" jsonb,
	"error_code" text,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_exports_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "document_exports_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "document_exports_subject_type_chk" CHECK ("subject_type" IN ('document', 'case_ai_log', 'conversation', 'data', 'kunye_check', 'case_files')),
	CONSTRAINT "document_exports_data_scope_chk" CHECK ("data_scope" IN ('account', 'org', 'data_subject', 'org_closure')),
	CONSTRAINT "document_exports_format_chk" CHECK ("format" IN ('udf', 'docx', 'pdf', 'zip')),
	CONSTRAINT "document_exports_status_chk" CHECK ("status" IN ('queued', 'processing', 'ready', 'failed', 'expired')),
	CONSTRAINT "document_exports_sha256_chk" CHECK ("sha256" IS NULL OR octet_length("sha256") = 32),
	CONSTRAINT "document_exports_ready_chk" CHECK ("status" <> 'ready' OR ("object_key" IS NOT NULL AND "key_version" IS NOT NULL AND "wrap_dek_version" IS NOT NULL AND "wrapped_key" IS NOT NULL)),
	CONSTRAINT "document_exports_subject_chk" CHECK (("subject_type" = 'document' AND "document_id" IS NOT NULL) OR ("subject_type" = 'case_ai_log' AND "case_id" IS NOT NULL) OR ("subject_type" = 'conversation' AND "conversation_id" IS NOT NULL) OR ("subject_type" = 'kunye_check' AND "kunye_check_id" IS NOT NULL) OR ("subject_type" = 'data' AND "data_scope" IS NOT NULL) OR ("subject_type" = 'case_files' AND "case_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."document_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"base_rev" bigint NOT NULL,
	"ops" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resulting_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_suggestions_ops_chk" CHECK (jsonb_typeof("ops") = 'array' AND jsonb_array_length("ops") > 0),
	CONSTRAINT "document_suggestions_status_chk" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'stale'))
);
--> statement-breakpoint
CREATE TABLE "app"."document_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"source" text NOT NULL,
	"trigger" text NOT NULL,
	"name" text,
	"content" jsonb COMPRESSION lz4 NOT NULL,
	"base_draft_rev" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "document_versions_no_uq" UNIQUE("org_id","document_id","version_no"),
	CONSTRAINT "document_versions_version_no_chk" CHECK ("version_no" >= 1),
	CONSTRAINT "document_versions_source_chk" CHECK ("source" IN ('user', 'ai', 'import')),
	CONSTRAINT "document_versions_trigger_chk" CHECK ("trigger" IN ('manual', 'suggestion_accepted', 'pre_export', 'session_end', 'restore', 'import', 'generated'))
);
--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"case_id" uuid,
	"source_conversation_id" uuid,
	"responds_to_file_id" uuid,
	"template_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text COLLATE "tr-TR-x-icu" NOT NULL,
	"title_fold" text NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_rev" bigint DEFAULT 0 NOT NULL,
	"draft_saved_at" timestamp with time zone,
	"outline" jsonb,
	"generation_status" text DEFAULT 'idle' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"filed_declared_by" uuid,
	"filed_declared_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"last_exported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "documents_kind_chk" CHECK ("kind" IN ('petition', 'notice', 'memo', 'free')),
	CONSTRAINT "documents_status_chk" CHECK ("status" IN ('draft', 'review_pending', 'approved', 'exported', 'filed_declared', 'archived')),
	CONSTRAINT "documents_generation_status_chk" CHECK ("generation_status" IN ('idle', 'queued', 'generating', 'failed')),
	CONSTRAINT "documents_filed_chk" CHECK (("status" = 'filed_declared') <= ("filed_declared_at" IS NOT NULL))
) WITH (fillfactor = 90);
--> statement-breakpoint
CREATE TABLE "app"."feedback_shares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid,
	"user_id" uuid,
	"masked_content" jsonb NOT NULL,
	"model_alias" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version_id" uuid,
	"masker_version" text NOT NULL,
	"source_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"support_ticket_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."kunye_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report_export_id" uuid,
	"error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kunye_checks_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "kunye_checks_status_chk" CHECK ("status" IN ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "app"."message_citations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"document_id" uuid,
	"block_id" text,
	"message_source_id" uuid,
	"ref_no" integer,
	"raw" text NOT NULL,
	"parsed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quote" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"blocking" text GENERATED ALWAYS AS (CASE "status" WHEN 'not_found' THEN 'hard' WHEN 'source_unavailable' THEN 'soft' ELSE 'none' END) STORED,
	"source_id" uuid,
	"user_source_file_id" uuid,
	"attested_by" uuid,
	"attested_at" timestamp with time zone,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_citations_status_chk" CHECK ("status" IN ('pending', 'verified', 'verified_user_source', 'out_of_context', 'out_of_coverage', 'source_unavailable', 'not_found', 'attested')),
	CONSTRAINT "message_citations_reason_chk" CHECK ("reason" IN ('not_in_conversation', 'section_mismatch', 'quote_mismatch', 'anachronism', 'not_in_coverage', 'source_error')),
	CONSTRAINT "message_citations_owner_chk" CHECK (num_nonnulls("message_id", "document_id") = 1),
	CONSTRAINT "message_citations_attest_chk" CHECK ("status" <> 'attested' OR "attested_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."message_feedback" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_uq" UNIQUE("org_id","message_id","user_id"),
	CONSTRAINT "message_feedback_rating_chk" CHECK ("rating" IN (-1, 1)),
	CONSTRAINT "message_feedback_category_chk" CHECK ("category" IN ('incorrect', 'unverified_citation', 'incomplete', 'outdated', 'formatting', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."message_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"ref_no" integer NOT NULL,
	"source_kind" text NOT NULL,
	"origin" text NOT NULL,
	"source_key" text NOT NULL,
	"source_id" uuid,
	"kunye_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_sources_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "message_sources_ref_uq" UNIQUE("org_id","conversation_id","ref_no"),
	CONSTRAINT "message_sources_key_uq" UNIQUE("org_id","conversation_id","source_key"),
	CONSTRAINT "message_sources_ref_no_chk" CHECK ("ref_no" >= 1),
	CONSTRAINT "message_sources_source_kind_chk" CHECK ("source_kind" IN ('decision', 'legislation', 'case_file', 'user_source')),
	CONSTRAINT "message_sources_origin_chk" CHECK ("origin" IN ('corpus', 'live', 'user'))
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"user_id" uuid,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_parts" json,
	"llm_context" text,
	"reasoning" json,
	"model_alias" text,
	"provider_id" text,
	"model_id" text,
	"region" text,
	"data_class" text,
	"thinking" text,
	"corrections" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"in_transcript" boolean DEFAULT true NOT NULL,
	"reply_to_message_id" uuid,
	"document_id" uuid,
	"error_code" text,
	"finish_reason" text,
	"request_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "messages_role_chk" CHECK ("role" IN ('user', 'assistant', 'system')),
	CONSTRAINT "messages_status_chk" CHECK ("status" IN ('streaming', 'complete', 'stopped', 'error', 'interrupted')),
	CONSTRAINT "messages_model_alias_chk" CHECK ("model_alias" IN ('edai-flash', 'edai-pro')),
	CONSTRAINT "messages_region_chk" CHECK ("region" IN ('TR', 'EU', 'US', 'CN', 'NONE')),
	CONSTRAINT "messages_data_class_chk" CHECK ("data_class" IN ('public', 'client', 'case')),
	CONSTRAINT "messages_thinking_chk" CHECK ("thinking" IN ('off', 'low', 'medium', 'high')),
	CONSTRAINT "messages_status_role_chk" CHECK ("role" = 'assistant' OR "status" = 'complete'),
	CONSTRAINT "messages_reasoning_chk" CHECK ("role" = 'assistant' OR "reasoning" IS NULL),
	CONSTRAINT "messages_context_chk" CHECK ("role" = 'user' OR "llm_context" IS NULL)
) WITH (fillfactor = 90);
--> statement-breakpoint
CREATE TABLE "app"."prompt_library" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"owner_user_id" uuid,
	"title" text COLLATE "tr-TR-x-icu" NOT NULL,
	"title_fold" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_library_scope_chk" CHECK ("scope" IN ('user', 'org')),
	CONSTRAINT "prompt_library_scope_owner_chk" CHECK (("scope" = 'user') = ("owner_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid,
	"kind" text NOT NULL,
	"title" text COLLATE "tr-TR-x-icu" NOT NULL,
	"description" text,
	"case_type_code" text,
	"content" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_kind_chk" CHECK ("kind" IN ('petition', 'notice', 'memo', 'free'))
);
--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."conversations" ADD CONSTRAINT "conversations_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."decision_searches" ADD CONSTRAINT "decision_searches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."decision_searches" ADD CONSTRAINT "decision_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "app"."documents"("org_id","id") ON DELETE SET NULL ("document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_version_fk" FOREIGN KEY ("org_id","version_id") REFERENCES "app"."document_versions"("org_id","id") ON DELETE SET NULL ("version_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE SET NULL ("case_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "app"."conversations"("org_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_kunye_check_fk" FOREIGN KEY ("org_id","kunye_check_id") REFERENCES "app"."kunye_checks"("org_id","id") ON DELETE SET NULL ("kunye_check_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_exports" ADD CONSTRAINT "document_exports_wrap_dek_fk" FOREIGN KEY ("org_id","wrap_dek_version") REFERENCES "app"."org_keys"("org_id","key_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "app"."documents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "app"."conversations"("org_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "app"."messages"("org_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_suggestions" ADD CONSTRAINT "document_suggestions_version_fk" FOREIGN KEY ("org_id","resulting_version_id") REFERENCES "app"."document_versions"("org_id","id") ON DELETE SET NULL ("resulting_version_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "app"."documents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_filed_declared_by_users_id_fk" FOREIGN KEY ("filed_declared_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_source_conversation_fk" FOREIGN KEY ("org_id","source_conversation_id") REFERENCES "app"."conversations"("org_id","id") ON DELETE SET NULL ("source_conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_responds_to_file_fk" FOREIGN KEY ("org_id","responds_to_file_id") REFERENCES "app"."files"("org_id","id") ON DELETE SET NULL ("responds_to_file_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."feedback_shares" ADD CONSTRAINT "feedback_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."feedback_shares" ADD CONSTRAINT "feedback_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."feedback_shares" ADD CONSTRAINT "feedback_shares_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "app"."messages"("org_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kunye_checks" ADD CONSTRAINT "kunye_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kunye_checks" ADD CONSTRAINT "kunye_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kunye_checks" ADD CONSTRAINT "kunye_checks_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "app"."files"("org_id","id") ON DELETE SET NULL ("file_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."kunye_checks" ADD CONSTRAINT "kunye_checks_report_export_fk" FOREIGN KEY ("org_id","report_export_id") REFERENCES "app"."document_exports"("org_id","id") ON DELETE SET NULL ("report_export_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_attested_by_users_id_fk" FOREIGN KEY ("attested_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "app"."conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "app"."messages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "app"."documents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_source_fk" FOREIGN KEY ("org_id","message_source_id") REFERENCES "app"."message_sources"("org_id","id") ON DELETE SET NULL ("message_source_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_citations" ADD CONSTRAINT "message_citations_user_source_fk" FOREIGN KEY ("org_id","user_source_file_id") REFERENCES "app"."files"("org_id","id") ON DELETE SET NULL ("user_source_file_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_feedback" ADD CONSTRAINT "message_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_feedback" ADD CONSTRAINT "message_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_feedback" ADD CONSTRAINT "message_feedback_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "app"."messages"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_sources" ADD CONSTRAINT "message_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_sources" ADD CONSTRAINT "message_sources_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "app"."conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_sources" ADD CONSTRAINT "message_sources_message_fk" FOREIGN KEY ("org_id","message_id") REFERENCES "app"."messages"("org_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("org_id","conversation_id") REFERENCES "app"."conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prompt_library" ADD CONSTRAINT "prompt_library_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prompt_library" ADD CONSTRAINT "prompt_library_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD CONSTRAINT "templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD CONSTRAINT "templates_case_type_code_case_types_code_fk" FOREIGN KEY ("case_type_code") REFERENCES "app"."case_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "app"."conversations" USING btree ("org_id","user_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_case_idx" ON "app"."conversations" USING btree ("org_id","case_id","last_message_at" DESC NULLS LAST) WHERE "case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_inactive_idx" ON "app"."conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_owner_idx" ON "app"."conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "decision_searches_user_idx" ON "app"."decision_searches" USING btree ("org_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decision_searches_purge_idx" ON "app"."decision_searches" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "decision_searches_owner_idx" ON "app"."decision_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_exports_doc_idx" ON "app"."document_exports" USING btree ("org_id","document_id","created_at" DESC NULLS LAST) WHERE "document_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_exports_case_idx" ON "app"."document_exports" USING btree ("org_id","case_id") WHERE "case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_exports_conv_idx" ON "app"."document_exports" USING btree ("org_id","conversation_id") WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_exports_check_idx" ON "app"."document_exports" USING btree ("org_id","kunye_check_id") WHERE "kunye_check_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_exports_expiry_idx" ON "app"."document_exports" USING btree ("expires_at") WHERE "status" IN ('ready');--> statement-breakpoint
CREATE INDEX "document_exports_version_idx" ON "app"."document_exports" USING btree ("org_id","version_id") WHERE "version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_exports_wrap_dek_idx" ON "app"."document_exports" USING btree ("org_id","wrap_dek_version") WHERE "wrap_dek_version" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_exports_requested_by_idx" ON "app"."document_exports" USING btree ("requested_by") WHERE "requested_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_suggestions_doc_idx" ON "app"."document_suggestions" USING btree ("org_id","document_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "document_suggestions_pending_idx" ON "app"."document_suggestions" USING btree ("org_id","document_id") WHERE "status" IN ('pending');--> statement-breakpoint
CREATE INDEX "document_suggestions_conv_idx" ON "app"."document_suggestions" USING btree ("org_id","conversation_id") WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_suggestions_msg_idx" ON "app"."document_suggestions" USING btree ("org_id","message_id") WHERE "message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_suggestions_version_idx" ON "app"."document_suggestions" USING btree ("org_id","resulting_version_id") WHERE "resulting_version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_suggestions_requested_by_idx" ON "app"."document_suggestions" USING btree ("requested_by") WHERE "requested_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_suggestions_resolved_by_idx" ON "app"."document_suggestions" USING btree ("resolved_by") WHERE "resolved_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_versions_created_by_idx" ON "app"."document_versions" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "app"."documents" USING btree ("org_id","owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "app"."documents" USING btree ("org_id","case_id") WHERE "case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_conv_idx" ON "app"."documents" USING btree ("org_id","source_conversation_id") WHERE "source_conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_responds_idx" ON "app"."documents" USING btree ("org_id","responds_to_file_id") WHERE "responds_to_file_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_template_idx" ON "app"."documents" USING btree ("template_id") WHERE "template_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_owner_user_idx" ON "app"."documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_approved_by_idx" ON "app"."documents" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_filed_declared_by_idx" ON "app"."documents" USING btree ("filed_declared_by") WHERE "filed_declared_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_shares_org_idx" ON "app"."feedback_shares" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_shares_msg_idx" ON "app"."feedback_shares" USING btree ("org_id","message_id") WHERE "message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_shares_purge_idx" ON "app"."feedback_shares" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "feedback_shares_user_idx" ON "app"."feedback_shares" USING btree ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kunye_checks_user_idx" ON "app"."kunye_checks" USING btree ("org_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "kunye_checks_file_idx" ON "app"."kunye_checks" USING btree ("org_id","file_id") WHERE "file_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kunye_checks_purge_idx" ON "app"."kunye_checks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "kunye_checks_owner_idx" ON "app"."kunye_checks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kunye_checks_report_idx" ON "app"."kunye_checks" USING btree ("org_id","report_export_id") WHERE "report_export_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_citations_message_idx" ON "app"."message_citations" USING btree ("org_id","message_id") WHERE "message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_citations_document_idx" ON "app"."message_citations" USING btree ("org_id","document_id","status") WHERE "document_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_citations_conv_idx" ON "app"."message_citations" USING btree ("org_id","conversation_id") WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_citations_verify_idx" ON "app"."message_citations" USING btree ("last_checked_at") WHERE "status" IN ('pending', 'source_unavailable');--> statement-breakpoint
CREATE INDEX "message_citations_source_idx" ON "app"."message_citations" USING btree ("org_id","message_source_id") WHERE "message_source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_citations_user_source_idx" ON "app"."message_citations" USING btree ("org_id","user_source_file_id") WHERE "user_source_file_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_citations_attested_by_idx" ON "app"."message_citations" USING btree ("attested_by") WHERE "attested_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_feedback_user_idx" ON "app"."message_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_sources_message_idx" ON "app"."message_sources" USING btree ("org_id","message_id") WHERE "message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_conversation_order_idx" ON "app"."messages" USING btree ("org_id","conversation_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_streaming_turn_idx" ON "app"."messages" USING btree ("conversation_id") WHERE "status" IN ('streaming') AND "in_transcript";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_streaming_docjob_idx" ON "app"."messages" USING btree ("document_id") WHERE "status" IN ('streaming') AND "document_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_streaming_idx" ON "app"."messages" USING btree ("created_at") WHERE "status" IN ('streaming');--> statement-breakpoint
CREATE INDEX "messages_reasoning_idx" ON "app"."messages" USING btree ("conversation_id") WHERE "reasoning" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_user_idx" ON "app"."messages" USING btree ("user_id") WHERE "user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prompt_library_org_idx" ON "app"."prompt_library" USING btree ("org_id","scope","owner_user_id");--> statement-breakpoint
CREATE INDEX "prompt_library_owner_idx" ON "app"."prompt_library" USING btree ("owner_user_id") WHERE "owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "templates_org_idx" ON "app"."templates" USING btree ("org_id","kind") WHERE "org_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "templates_platform_idx" ON "app"."templates" USING btree ("kind") WHERE "org_id" IS NULL;--> statement-breakpoint
CREATE INDEX "templates_created_by_idx" ON "app"."templates" USING btree ("created_by") WHERE "created_by" IS NOT NULL;