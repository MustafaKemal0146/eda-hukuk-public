-- eda:kind schema
-- eda:patched tr-TR-x-icu harmanlaması (030 §14); custody_events aylık RANGE bölümleme (030 §1.6); judicial_recesses EXCLUDE; ON DELETE SET NULL (kolon) (030 §1.4)
-- L2 (032 §2.1): app kimlik/büro, katalog ve müvekkil/dava/evrak tabloları (030 §4–§6, 053-08 §3.3);
-- drizzle-kit generate çıktısı. RLS + GRANT bu tablolara yetki verilmeden önce aynı commit'teki
-- rls_app_core migrasyonundadır (031 §7); bu dosya hiçbir rol yetkisi vermez.
CREATE TABLE "app"."case_ai_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid,
	"task" text NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"document_id" uuid,
	"file_id" uuid,
	"model_alias" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"region" text NOT NULL,
	"data_class" text NOT NULL,
	"masked_count" integer DEFAULT 0 NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_ai_logs_task_chk" CHECK ("task" IN ('chat', 'draft_document', 'edit_document', 'title', 'summarize_history', 'search_overview', 'decision_summary', 'file_card', 'pii_risk_check', 'citation_support_check')),
	CONSTRAINT "case_ai_logs_region_chk" CHECK ("region" IN ('TR', 'EU', 'US', 'CN', 'NONE')),
	CONSTRAINT "case_ai_logs_data_class_chk" CHECK ("data_class" IN ('public', 'client', 'case')),
	CONSTRAINT "case_ai_logs_outcome_chk" CHECK ("outcome" IN ('success', 'error', 'timeout', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "app"."case_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_members_uq" UNIQUE("org_id","case_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."case_parties" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"client_id" uuid,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"entity_name" text,
	"display_name" text COLLATE "tr-TR-x-icu" GENERATED ALWAYS AS (CASE WHEN "kind" = 'person' THEN "first_name" || ' ' || "last_name" ELSE "entity_name" END) STORED,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"tckn_enc" "bytea",
	"tckn_hmac" "bytea",
	"vkn_enc" "bytea",
	"vkn_hmac" "bytea",
	"pii_org_key_id" uuid,
	"address" text,
	"counsel_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_parties_role_chk" CHECK ("role" IN ('plaintiff', 'defendant', 'intervener', 'complainant', 'participant', 'accused', 'creditor', 'debtor', 'applicant', 'third_party')),
	CONSTRAINT "case_parties_kind_chk" CHECK ("kind" IN ('person', 'entity')),
	CONSTRAINT "case_parties_kind_shape_chk" CHECK (("kind" = 'person' AND "first_name" IS NOT NULL AND "last_name" IS NOT NULL AND "entity_name" IS NULL) OR ("kind" = 'entity' AND "entity_name" IS NOT NULL AND "first_name" IS NULL AND "last_name" IS NULL AND "tckn_enc" IS NULL)),
	CONSTRAINT "case_parties_enc_pair_chk" CHECK (("tckn_enc" IS NULL) = ("tckn_hmac" IS NULL) AND ("vkn_enc" IS NULL) = ("vkn_hmac" IS NULL)),
	CONSTRAINT "case_parties_enc_key_chk" CHECK (("tckn_enc" IS NULL AND "vkn_enc" IS NULL) OR "pii_org_key_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."case_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text COLLATE "tr-TR-x-icu" NOT NULL,
	"branch" text,
	"legal_basis" text,
	"sensitive_topic" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_types_code_chk" CHECK ("code" ~ '^[a-z0-9._-]{2,64}$'),
	CONSTRAINT "case_types_branch_chk" CHECK ("branch" IN ('hmk', 'cmk', 'iyuk', 'iik', 'mediation')),
	CONSTRAINT "case_types_sensitive_topic_chk" CHECK ("sensitive_topic" IN ('criminal', 'child', 'family', 'health', 'asylum_migration', 'trade_secret', 'capital_markets'))
);
--> statement-breakpoint
CREATE TABLE "app"."cases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text COLLATE "tr-TR-x-icu" NOT NULL,
	"title_fold" text NOT NULL,
	"office_file_code" text,
	"short_name" text,
	"case_type_code" text,
	"court_code" text,
	"chamber_code" text,
	"esas_no" text,
	"karar_no" text,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'org' NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"sensitive_topic" text,
	"client_ai_consent" text DEFAULT 'unknown' NOT NULL,
	"ai_disabled" boolean DEFAULT false NOT NULL,
	"opened_date" date,
	"closed_date" date,
	"mandate_ended_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "cases_esas_no_chk" CHECK (char_length("esas_no") <= 32),
	CONSTRAINT "cases_karar_no_chk" CHECK (char_length("karar_no") <= 32),
	CONSTRAINT "cases_status_chk" CHECK ("status" IN ('active', 'on_hold', 'closed', 'archived')),
	CONSTRAINT "cases_visibility_chk" CHECK ("visibility" IN ('org', 'restricted')),
	CONSTRAINT "cases_sensitivity_chk" CHECK ("sensitivity" IN ('normal', 'sensitive')),
	CONSTRAINT "cases_sensitive_topic_chk" CHECK ("sensitive_topic" IN ('criminal', 'child', 'family', 'health', 'asylum_migration', 'trade_secret', 'capital_markets')),
	CONSTRAINT "cases_client_ai_consent_chk" CHECK ("client_ai_consent" IN ('unknown', 'granted', 'refused')),
	CONSTRAINT "cases_consent_chk" CHECK ("client_ai_consent" <> 'refused' OR "ai_disabled"),
	CONSTRAINT "cases_topic_chk" CHECK ("sensitivity" = 'sensitive' OR "sensitive_topic" IS NULL),
	CONSTRAINT "cases_dates_chk" CHECK ("closed_date" IS NULL OR "opened_date" IS NULL OR "closed_date" >= "opened_date"),
	CONSTRAINT "cases_mandate_chk" CHECK ("status" NOT IN ('closed', 'archived') OR "mandate_ended_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."chambers" (
	"code" text PRIMARY KEY NOT NULL,
	"court_code" text NOT NULL,
	"name" text COLLATE "tr-TR-x-icu" NOT NULL,
	"short_name" text NOT NULL,
	"chamber_kind" text NOT NULL,
	"number" integer,
	"active_during" daterange,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chambers_code_chk" CHECK ("code" ~ '^[a-z0-9._-]{2,64}$'),
	CONSTRAINT "chambers_chamber_kind_chk" CHECK ("chamber_kind" IN ('civil', 'criminal', 'administrative', 'tax', 'general_assembly', 'board'))
);
--> statement-breakpoint
CREATE TABLE "app"."clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"entity_name" text,
	"display_name" text COLLATE "tr-TR-x-icu" GENERATED ALWAYS AS (CASE WHEN "kind" = 'person' THEN "first_name" || ' ' || "last_name" ELSE "entity_name" END) STORED,
	"name_fold" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"tckn_enc" "bytea",
	"tckn_hmac" "bytea",
	"vkn_enc" "bytea",
	"vkn_hmac" "bytea",
	"pii_org_key_id" uuid,
	"tax_office" text,
	"email" text,
	"phone" text,
	"address" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "clients_kind_chk" CHECK ("kind" IN ('person', 'entity')),
	CONSTRAINT "clients_kind_shape_chk" CHECK (("kind" = 'person' AND "first_name" IS NOT NULL AND "last_name" IS NOT NULL AND "entity_name" IS NULL) OR ("kind" = 'entity' AND "entity_name" IS NOT NULL AND "first_name" IS NULL AND "last_name" IS NULL AND "tckn_enc" IS NULL)),
	CONSTRAINT "clients_enc_pair_chk" CHECK (("tckn_enc" IS NULL) = ("tckn_hmac" IS NULL) AND ("vkn_enc" IS NULL) = ("vkn_hmac" IS NULL)),
	CONSTRAINT "clients_enc_key_chk" CHECK (("tckn_enc" IS NULL AND "vkn_enc" IS NULL) OR "pii_org_key_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."courts" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text COLLATE "tr-TR-x-icu" NOT NULL,
	"court_type" text NOT NULL,
	"city" text,
	"district" text,
	"court_number" integer,
	"admin_recess_exempt" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courts_code_chk" CHECK ("code" ~ '^[a-z0-9._-]{2,64}$'),
	CONSTRAINT "courts_court_type_chk" CHECK ("court_type" IN ('constitutional_court', 'court_of_cassation', 'council_of_state', 'jurisdictional_disputes_court', 'regional_court_of_appeal', 'regional_administrative_court', 'civil_first_instance', 'civil_peace', 'commercial', 'labor', 'family', 'consumer', 'land_registry', 'intellectual_property', 'enforcement_court', 'heavy_criminal', 'criminal_first_instance', 'criminal_peace_judgeship', 'juvenile', 'administrative', 'tax', 'enforcement_office', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."custody_events" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"case_id" uuid,
	"event" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"sha256" "bytea",
	"ip_trunc" "inet",
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_events_pkey" PRIMARY KEY("id","created_at"),
	CONSTRAINT "custody_events_event_chk" CHECK ("event" IN ('upload', 'view', 'download', 'export', 'move', 'delete_request', 'delete_cancel', 'delete')),
	CONSTRAINT "custody_events_actor_type_chk" CHECK ("actor_type" IN ('user', 'platform_staff', 'system')),
	CONSTRAINT "custody_events_sha256_chk" CHECK ("sha256" IS NULL OR octet_length("sha256") = 32)
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "app"."deadline_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"version" integer NOT NULL,
	"branch" text NOT NULL,
	"title" text NOT NULL,
	"law_ref" text NOT NULL,
	"law_no" text,
	"article_no" text,
	"duration_value" integer NOT NULL,
	"duration_unit" text NOT NULL,
	"start_events" text[] NOT NULL,
	"recess_applies" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_during" daterange NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_rules_code_version_uq" UNIQUE("code","version"),
	CONSTRAINT "deadline_rules_id_version_uq" UNIQUE("id","version"),
	CONSTRAINT "deadline_rules_code_chk" CHECK ("code" ~ '^[a-z0-9_]{3,64}$'),
	CONSTRAINT "deadline_rules_version_chk" CHECK ("version" >= 1),
	CONSTRAINT "deadline_rules_branch_chk" CHECK ("branch" IN ('hmk', 'cmk', 'iyuk', 'iik', 'mediation')),
	CONSTRAINT "deadline_rules_duration_value_chk" CHECK ("duration_value" > 0),
	CONSTRAINT "deadline_rules_duration_unit_chk" CHECK ("duration_unit" IN ('day', 'week', 'month')),
	CONSTRAINT "deadline_rules_start_events_chk" CHECK ("start_events" <@ ARRAY['service', 'pronouncement', 'learning']::text[]),
	CONSTRAINT "deadline_rules_start_events_nonempty_chk" CHECK (cardinality("start_events") > 0),
	CONSTRAINT "deadline_rules_verified_chk" CHECK (("verified_by" IS NULL) = ("verified_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."file_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"case_id" uuid,
	"chunk_no" integer NOT NULL,
	"page_from" integer,
	"page_to" integer,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('public.tr_hukuk'::regconfig, "text_norm")) STORED,
	"token_count" integer NOT NULL,
	"emb" halfvec(1024),
	"embed_model_revision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_chunks_file_chunk_uq" UNIQUE("org_id","file_id","chunk_no"),
	CONSTRAINT "file_chunks_chunk_no_chk" CHECK ("chunk_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."file_texts" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"text" text NOT NULL,
	"token_count" integer NOT NULL,
	"page_count" integer,
	"page_offsets" integer[],
	"ocr_engine" text,
	"extracted_at" timestamp with time zone,
	"extraction_method" text NOT NULL,
	"language" text,
	"hidden_content_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"has_hidden_content" boolean DEFAULT false NOT NULL,
	"doc_type" text,
	"card" jsonb,
	"card_status" text DEFAULT 'pending' NOT NULL,
	"card_generated_at" timestamp with time zone,
	"card_error_code" text,
	"extractor_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_texts_extraction_method_chk" CHECK ("extraction_method" IN ('text_layer', 'ocr')),
	CONSTRAINT "file_texts_doc_type_chk" CHECK ("doc_type" IN ('petition', 'decision', 'interim_decision', 'service_notice', 'expert_report', 'minutes', 'indictment', 'contract', 'power_of_attorney', 'evidence', 'other')),
	CONSTRAINT "file_texts_card_status_chk" CHECK ("card_status" IN ('pending', 'ready', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "app"."files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid,
	"origin" text NOT NULL,
	"origin_id" uuid,
	"uploaded_by" uuid,
	"original_name" text NOT NULL,
	"name_fold" text NOT NULL,
	"file_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" "bytea" NOT NULL,
	"page_count" integer,
	"has_text_layer" boolean,
	"ocr_pages" integer DEFAULT 0 NOT NULL,
	"ocr_completed_at" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	"embed_pages" integer DEFAULT 0 NOT NULL,
	"embed_completed_at" timestamp with time zone,
	"progress_done" integer,
	"progress_total" integer,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"status_reason" text,
	"object_key" text NOT NULL,
	"has_searchable" boolean DEFAULT false NOT NULL,
	"has_clean" boolean DEFAULT false NOT NULL,
	"key_version" integer NOT NULL,
	"wrap_dek_version" integer NOT NULL,
	"wrapped_file_key" "bytea" NOT NULL,
	"delete_requested_at" timestamp with time zone,
	"delete_requested_by" uuid,
	"inbox_expires_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "files_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "files_origin_chk" CHECK ("origin" IN ('case_upload', 'chat_attachment', 'kunye_check', 'document_import')),
	CONSTRAINT "files_file_type_chk" CHECK ("file_type" IN ('pdf', 'docx', 'udf', 'png', 'jpeg', 'tiff', 'txt')),
	CONSTRAINT "files_size_bytes_chk" CHECK ("size_bytes" > 0),
	CONSTRAINT "files_sha256_chk" CHECK (octet_length("sha256") = 32),
	CONSTRAINT "files_status_chk" CHECK ("status" IN ('uploaded', 'scanning', 'extracting', 'chunking', 'embedding', 'ready', 'failed', 'quarantined', 'ocr_skipped')),
	CONSTRAINT "files_wrapped_file_key_chk" CHECK (octet_length("wrapped_file_key") = 60),
	CONSTRAINT "files_inbox_chk" CHECK (("case_id" IS NULL) = ("inbox_expires_at" IS NOT NULL)),
	CONSTRAINT "files_vault_case_chk" CHECK ("origin" <> 'case_upload' OR "case_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."holidays" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"holiday_date" date NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"starts_at_local" time,
	"legal_basis" text,
	"source" text NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_date_code_uq" UNIQUE("holiday_date","code"),
	CONSTRAINT "holidays_code_chk" CHECK ("code" ~ '^[a-z0-9_]{3,64}$'),
	CONSTRAINT "holidays_kind_chk" CHECK ("kind" IN ('official', 'religious', 'administrative_leave')),
	CONSTRAINT "holidays_half_day_chk" CHECK ("is_half_day" = ("starts_at_local" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."judicial_recesses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"branch" text NOT NULL,
	"year" integer NOT NULL,
	"period" daterange NOT NULL,
	"legal_basis" text NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judicial_recesses_branch_year_uq" UNIQUE("branch","year"),
	CONSTRAINT "judicial_recesses_branch_chk" CHECK ("branch" IN ('hmk', 'cmk', 'iyuk', 'iik', 'mediation')),
	CONSTRAINT "judicial_recesses_year_chk" CHECK ("year" BETWEEN 2000 AND 2100),
	CONSTRAINT "judicial_recesses_no_overlap" EXCLUDE USING gist ("branch" WITH =, "period" WITH &&)
);
--> statement-breakpoint
CREATE TABLE "app"."lawyer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"baro" text NOT NULL,
	"sicil_no" text,
	"trainee_registry_no" text,
	"verification_source" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lawyer_profiles_baro_sicil_uq" UNIQUE("baro","sicil_no"),
	CONSTRAINT "lawyer_profiles_baro_trainee_uq" UNIQUE("baro","trainee_registry_no"),
	CONSTRAINT "lawyer_profiles_sicil_no_chk" CHECK ("sicil_no" ~ '^[0-9A-Za-z/-]{1,20}$'),
	CONSTRAINT "lawyer_profiles_trainee_registry_no_chk" CHECK ("trainee_registry_no" ~ '^[0-9A-Za-z/-]{1,20}$'),
	CONSTRAINT "lawyer_profiles_verification_source_chk" CHECK ("verification_source" IN ('admin_review', 'org_invitation')),
	CONSTRAINT "lawyer_profiles_ai_instructions_chk" CHECK (char_length("ai_instructions") <= 800),
	CONSTRAINT "lawyer_profiles_one_registry_chk" CHECK (("sicil_no" IS NULL) <> ("trainee_registry_no" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."org_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"key_version" integer NOT NULL,
	"wrapped_dek" "bytea",
	"kek_version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"shredded_at" timestamp with time zone,
	CONSTRAINT "org_keys_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "org_keys_version_uq" UNIQUE("org_id","key_version"),
	CONSTRAINT "org_keys_key_version_chk" CHECK ("key_version" >= 1),
	CONSTRAINT "org_keys_status_chk" CHECK ("status" IN ('active', 'retiring', 'retired', 'shredded')),
	CONSTRAINT "org_keys_shred_chk" CHECK (("status" IN ('retired', 'shredded')) = ("wrapped_dek" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"ai_data_residency" text DEFAULT 'eu_or_tr' NOT NULL,
	"sensitive_case_policy" text DEFAULT 'tr_only' NOT NULL,
	"allow_public_mode" boolean DEFAULT false NOT NULL,
	"show_reasoning" boolean DEFAULT false NOT NULL,
	"feedback_sharing_enabled" boolean DEFAULT true NOT NULL,
	"mfa_required_all" boolean DEFAULT false NOT NULL,
	"mask_own_case_number" boolean DEFAULT true NOT NULL,
	"assistant_ai_chat_enabled" boolean DEFAULT false NOT NULL,
	"trainee_supervision" boolean DEFAULT false NOT NULL,
	"trainee_export_requires_approval" boolean DEFAULT false NOT NULL,
	"retention_years_after_mandate" integer DEFAULT 3 NOT NULL,
	"reminder_short_name_enabled" boolean DEFAULT false NOT NULL,
	"ics_enabled" boolean DEFAULT false NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"letterhead" jsonb,
	"ai_instructions" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_ai_data_residency_chk" CHECK ("ai_data_residency" IN ('eu_or_tr', 'tr_only', 'public_only', 'local_only')),
	CONSTRAINT "org_settings_sensitive_case_policy_chk" CHECK ("sensitive_case_policy" IN ('tr_only', 'eu_scc_with_ack', 'ai_off')),
	CONSTRAINT "org_settings_retention_years_after_mandate_chk" CHECK ("retention_years_after_mandate" >= 3),
	CONSTRAINT "org_settings_ai_instructions_chk" CHECK (char_length("ai_instructions") <= 1500)
);
--> statement-breakpoint
CREATE TABLE "app"."partner_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_members_user_id_uq" UNIQUE("user_id"),
	CONSTRAINT "partner_members_role_chk" CHECK ("role" IN ('partner_owner', 'partner_staff')),
	CONSTRAINT "partner_members_status_chk" CHECK ("status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "app"."partner_organizations" (
	"partner_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text DEFAULT 'partner_code' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_organizations_pkey" PRIMARY KEY("partner_id","org_id"),
	CONSTRAINT "partner_organizations_org_id_uq" UNIQUE("org_id"),
	CONSTRAINT "partner_organizations_source_chk" CHECK ("source" IN ('partner_code', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "app"."pending_file_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"queue" text NOT NULL,
	"job_name" text NOT NULL,
	"priority" smallint DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_file_jobs_file_uq" UNIQUE("file_id"),
	CONSTRAINT "pending_file_jobs_queue_chk" CHECK ("queue" IN ('files-interactive', 'files-batch')),
	CONSTRAINT "pending_file_jobs_job_name_chk" CHECK ("job_name" IN ('file.scan', 'file.extract', 'file.ocr', 'file.chunk', 'file.embed', 'file.card'))
);
--> statement-breakpoint
CREATE TABLE "app"."powers_of_attorney" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"notary_name" text NOT NULL,
	"issued_date" date NOT NULL,
	"yevmiye_no" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_note" text,
	"start_date" date,
	"ended_at" timestamp with time zone,
	"authorized_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "powers_of_attorney_scope_kind_chk" CHECK ("scope_kind" IN ('general', 'special'))
);
--> statement-breakpoint
CREATE TABLE "app"."user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"privacy_notice_version" text,
	"privacy_notice_ack_at" timestamp with time zone,
	"signature_block" jsonb,
	"default_alias" text DEFAULT 'edai-flash' NOT NULL,
	"onboarding" jsonb DEFAULT '{"tourCompleted":false,"dismissedAt":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_default_alias_chk" CHECK ("default_alias" IN ('edai-flash', 'edai-pro'))
);
--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "auth"."members"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_parties" ADD CONSTRAINT "case_parties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_parties" ADD CONSTRAINT "case_parties_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_parties" ADD CONSTRAINT "case_parties_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "app"."clients"("org_id","id") ON DELETE SET NULL ("client_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_parties" ADD CONSTRAINT "case_parties_pii_org_key_fk" FOREIGN KEY ("org_id","pii_org_key_id") REFERENCES "app"."org_keys"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_case_type_code_case_types_code_fk" FOREIGN KEY ("case_type_code") REFERENCES "app"."case_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_court_code_courts_code_fk" FOREIGN KEY ("court_code") REFERENCES "app"."courts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_chamber_code_chambers_code_fk" FOREIGN KEY ("chamber_code") REFERENCES "app"."chambers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chambers" ADD CONSTRAINT "chambers_court_code_courts_code_fk" FOREIGN KEY ("court_code") REFERENCES "app"."courts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_pii_org_key_fk" FOREIGN KEY ("org_id","pii_org_key_id") REFERENCES "app"."org_keys"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_chunks" ADD CONSTRAINT "file_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_chunks" ADD CONSTRAINT "file_chunks_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "app"."files"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_chunks" ADD CONSTRAINT "file_chunks_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_texts" ADD CONSTRAINT "file_texts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."file_texts" ADD CONSTRAINT "file_texts_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "app"."files"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."files" ADD CONSTRAINT "files_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."files" ADD CONSTRAINT "files_wrap_dek_fk" FOREIGN KEY ("org_id","wrap_dek_version") REFERENCES "app"."org_keys"("org_id","key_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lawyer_profiles" ADD CONSTRAINT "lawyer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lawyer_profiles" ADD CONSTRAINT "lawyer_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_keys" ADD CONSTRAINT "org_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD CONSTRAINT "org_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_members" ADD CONSTRAINT "partner_members_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "app"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_members" ADD CONSTRAINT "partner_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_organizations" ADD CONSTRAINT "partner_organizations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "app"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."partner_organizations" ADD CONSTRAINT "partner_organizations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pending_file_jobs" ADD CONSTRAINT "pending_file_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pending_file_jobs" ADD CONSTRAINT "pending_file_jobs_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "app"."files"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_client_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "app"."clients"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "app"."files"("org_id","id") ON DELETE SET NULL ("file_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_ai_logs_case_idx" ON "app"."case_ai_logs" USING btree ("org_id","case_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "case_members_user_idx" ON "app"."case_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "case_members_added_by_idx" ON "app"."case_members" USING btree ("added_by") WHERE "added_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "case_parties_case_idx" ON "app"."case_parties" USING btree ("org_id","case_id","sort_order");--> statement-breakpoint
CREATE INDEX "case_parties_client_idx" ON "app"."case_parties" USING btree ("org_id","client_id") WHERE "client_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "case_parties_pii_key_idx" ON "app"."case_parties" USING btree ("org_id","pii_org_key_id") WHERE "pii_org_key_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cases_org_status_idx" ON "app"."cases" USING btree ("org_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cases_org_owner_idx" ON "app"."cases" USING btree ("org_id","owner_id");--> statement-breakpoint
CREATE INDEX "cases_owner_idx" ON "app"."cases" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "cases_org_esas_idx" ON "app"."cases" USING btree ("org_id","esas_no") WHERE "esas_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cases_org_title_idx" ON "app"."cases" USING btree ("org_id","title_fold" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "cases_retention_idx" ON "app"."cases" USING btree ("mandate_ended_at") WHERE "mandate_ended_at" IS NOT NULL AND NOT "legal_hold";--> statement-breakpoint
CREATE INDEX "cases_created_by_idx" ON "app"."cases" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chambers_court_idx" ON "app"."chambers" USING btree ("court_code");--> statement-breakpoint
CREATE INDEX "clients_org_name_idx" ON "app"."clients" USING btree ("org_id","name_fold" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_tckn_uq" ON "app"."clients" USING btree ("org_id","tckn_hmac") WHERE "tckn_hmac" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_vkn_uq" ON "app"."clients" USING btree ("org_id","vkn_hmac") WHERE "vkn_hmac" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clients_pii_key_idx" ON "app"."clients" USING btree ("org_id","pii_org_key_id") WHERE "pii_org_key_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "clients_created_by_idx" ON "app"."clients" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "courts_type_city_idx" ON "app"."courts" USING btree ("court_type","city");--> statement-breakpoint
CREATE INDEX "custody_events_file_idx" ON "app"."custody_events" USING btree ("org_id","file_id","created_at");--> statement-breakpoint
CREATE INDEX "custody_events_case_idx" ON "app"."custody_events" USING btree ("org_id","case_id","created_at") WHERE "case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "custody_events_brin" ON "app"."custody_events" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "deadline_rules_selectable_idx" ON "app"."deadline_rules" USING btree ("branch","code") WHERE "verified_at" IS NOT NULL AND "superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "file_chunks_case_idx" ON "app"."file_chunks" USING btree ("org_id","case_id","file_id");--> statement-breakpoint
CREATE INDEX "file_chunks_tsv_idx" ON "app"."file_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "file_texts_org_file_idx" ON "app"."file_texts" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE INDEX "files_case_idx" ON "app"."files" USING btree ("org_id","case_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "files_case_sha_uq" ON "app"."files" USING btree ("org_id","case_id","sha256") WHERE "case_id" IS NOT NULL AND "delete_requested_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_inbox_purge_idx" ON "app"."files" USING btree ("inbox_expires_at") WHERE "case_id" IS NULL;--> statement-breakpoint
CREATE INDEX "files_processing_idx" ON "app"."files" USING btree ("org_id","status") WHERE "status" IN ('uploaded', 'scanning', 'extracting', 'chunking', 'embedding');--> statement-breakpoint
CREATE INDEX "files_org_key_idx" ON "app"."files" USING btree ("org_id","wrap_dek_version");--> statement-breakpoint
CREATE INDEX "files_uploaded_by_idx" ON "app"."files" USING btree ("uploaded_by") WHERE "uploaded_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "app"."holidays" USING btree ("holiday_date");--> statement-breakpoint
CREATE INDEX "lawyer_profiles_reviewed_by_idx" ON "app"."lawyer_profiles" USING btree ("reviewed_by") WHERE "reviewed_by" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "org_keys_one_active_uq" ON "app"."org_keys" USING btree ("org_id") WHERE "status" IN ('active');--> statement-breakpoint
CREATE INDEX "org_settings_updated_by_idx" ON "app"."org_settings" USING btree ("updated_by") WHERE "updated_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "partner_members_partner_idx" ON "app"."partner_members" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "pending_file_jobs_rr_idx" ON "app"."pending_file_jobs" USING btree ("org_id","priority","created_at");--> statement-breakpoint
CREATE INDEX "powers_of_attorney_client_idx" ON "app"."powers_of_attorney" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "powers_of_attorney_active_idx" ON "app"."powers_of_attorney" USING btree ("org_id") WHERE "ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "powers_of_attorney_file_idx" ON "app"."powers_of_attorney" USING btree ("org_id","file_id") WHERE "file_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "powers_of_attorney_created_by_idx" ON "app"."powers_of_attorney" USING btree ("created_by") WHERE "created_by" IS NOT NULL;