-- eda:kind schema
-- eda:patched CREATE SCHEMA satırı çıkarıldı (initdb 050 ve 0000); corpus.laws.title tr-TR-x-icu (030 §14); law_article_versions EXCLUDE USING gist (030 §13)
-- L2 (032 §2.1): corpus şeması (030 §13): kiracısız, RLS YOK. Yetkiler 0000'daki DEFAULT PRIVILEGES
-- ile gelir (eda_app SELECT, eda_worker DML). HNSW ve BM25 indeksleri ayrı index migrasyonundadır.
CREATE TABLE "corpus"."decision_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"decision_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"chunk_no" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"context_prefix" text NOT NULL,
	"token_count" integer NOT NULL,
	"court_type" text NOT NULL,
	"chamber_code" text,
	"decision_date" date,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"emb" halfvec(1024),
	"embed_model_revision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_chunks_uq" UNIQUE("decision_id","chunk_no"),
	CONSTRAINT "decision_chunks_chunk_no_chk" CHECK ("chunk_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "corpus"."decision_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"decision_id" uuid NOT NULL,
	"section_no" integer NOT NULL,
	"role" text NOT NULL,
	"heading" text,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"court_type" text NOT NULL,
	"chamber_code" text,
	"decision_date" date,
	"text_fold" text GENERATED ALWAYS AS (translate("text_norm", 'çğıöşü', 'cgiosu')) STORED,
	"fold_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, translate("text_norm", 'çğıöşü', 'cgiosu'))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_sections_uq" UNIQUE("decision_id","section_no"),
	CONSTRAINT "decision_sections_section_no_chk" CHECK ("section_no" >= 1),
	CONSTRAINT "decision_sections_role_chk" CHECK ("role" IN ('kunye', 'istem', 'taraf_iddiasi', 'gerekce', 'hukum', 'karsi_oy', 'tetkik_hakimi', 'diger')),
	CONSTRAINT "decision_sections_text_chk" CHECK (char_length("text") <= 6000)
);
--> statement-breakpoint
CREATE TABLE "corpus"."decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source" text NOT NULL,
	"document_id" text NOT NULL,
	"origin" text NOT NULL,
	"court_name" text NOT NULL,
	"court_type" text NOT NULL,
	"court_code" text,
	"chamber_raw" text,
	"chamber_code" text,
	"esas_no" text,
	"karar_no" text,
	"decision_date" date,
	"title" text,
	"kunye_norm" text NOT NULL,
	"kunye_fold" text NOT NULL,
	"text_status" text DEFAULT 'full' NOT NULL,
	"section_count" integer DEFAULT 0 NOT NULL,
	"cited_articles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"content_sha256" "bytea",
	"summary" text,
	"summary_model" text,
	"summary_at" timestamp with time zone,
	"kunye_hash" "bytea",
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"sectioning_version" integer DEFAULT 1 NOT NULL,
	"chunking_version" integer DEFAULT 1 NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"ingestion_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_source_doc_uq" UNIQUE("source","document_id"),
	CONSTRAINT "decisions_source_chk" CHECK ("source" IN ('bedesten', 'anayasa', 'uyusmazlik', 'mevzuat', 'kik', 'rekabet', 'gib', 'yargitay', 'danistay', 'emsal', 'sayistay', 'kvkk', 'bddk', 'sigorta_tahkim')),
	CONSTRAINT "decisions_origin_chk" CHECK ("origin" IN ('corpus', 'live')),
	CONSTRAINT "decisions_court_type_chk" CHECK ("court_type" IN ('yargitay', 'danistay', 'istinaf_hukuk', 'ilk_derece_hukuk', 'kyb', 'aym_bireysel', 'aym_norm', 'uyusmazlik', 'kik', 'rekabet', 'gib')),
	CONSTRAINT "decisions_text_status_chk" CHECK ("text_status" IN ('full', 'unavailable')),
	CONSTRAINT "decisions_content_sha256_chk" CHECK ("content_sha256" IS NULL OR octet_length("content_sha256") = 32),
	CONSTRAINT "decisions_kunye_hash_chk" CHECK ("kunye_hash" IS NULL OR octet_length("kunye_hash") = 32),
	CONSTRAINT "decisions_withdrawn_reason_chk" CHECK ("withdrawn_reason" IN ('kvkk_request', 'court_order', 'source_removed', 'legal_review', 'quality'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."embed_staging" (
	"chunk_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"emb" halfvec(1024) NOT NULL,
	"embed_model_revision" text NOT NULL,
	CONSTRAINT "embed_staging_kind_chk" CHECK ("kind" IN ('decision', 'law_article'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"status" text DEFAULT 'running' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embed_model_revision" text,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_inserted" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_failed" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ingestion_runs_kind_chk" CHECK ("kind" IN ('live_hit', 'bulk', 'legislation_snapshot', 'reembed', 'decision_summary')),
	CONSTRAINT "ingestion_runs_status_chk" CHECK ("status" IN ('running', 'succeeded', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."law_article_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"article_id" uuid NOT NULL,
	"version_id" uuid,
	"chunk_no" integer NOT NULL,
	"text" text NOT NULL,
	"context_prefix" text NOT NULL,
	"token_count" integer NOT NULL,
	"emb" halfvec(1024),
	"embed_model_revision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "law_article_chunks_uq" UNIQUE NULLS NOT DISTINCT("article_id","version_id","chunk_no"),
	CONSTRAINT "law_article_chunks_chunk_no_chk" CHECK ("chunk_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "corpus"."law_article_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"article_id" uuid NOT NULL,
	"valid_during" daterange NOT NULL,
	"text" text NOT NULL,
	"amended_by" text,
	"source_sha256" "bytea",
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	CONSTRAINT "law_article_versions_no_overlap" EXCLUDE USING gist ("article_id" WITH =, "valid_during" WITH &&)
);
--> statement-breakpoint
CREATE TABLE "corpus"."law_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"law_id" uuid NOT NULL,
	"article_no" text NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"text_norm" text NOT NULL,
	"text_fold" text GENERATED ALWAYS AS (translate("text_norm", 'çğıöşü', 'cgiosu')) STORED,
	"fold_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, translate("text_norm", 'çğıöşü', 'cgiosu'))) STORED,
	"status" text DEFAULT 'in_force' NOT NULL,
	"amended_note" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "law_articles_uq" UNIQUE("law_id","article_no"),
	CONSTRAINT "law_articles_article_no_chk" CHECK ("article_no" ~ '^(G|E|M)?[0-9]+(/[A-Za-z])?$'),
	CONSTRAINT "law_articles_status_chk" CHECK ("status" IN ('in_force', 'repealed'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."laws" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"law_type" text DEFAULT 'law' NOT NULL,
	"law_no" text NOT NULL,
	"title" text COLLATE "tr-TR-x-icu" NOT NULL,
	"title_fold" text NOT NULL,
	"short_name" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"official_gazette_date" date,
	"official_gazette_no" text,
	"accepted_date" date,
	"last_amended_date" date,
	"status" text DEFAULT 'in_force' NOT NULL,
	"source_url" text,
	"content_sha256" "bytea",
	"last_snapshot_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laws_type_no_uq" UNIQUE("law_type","law_no"),
	CONSTRAINT "laws_law_type_chk" CHECK ("law_type" IN ('constitution', 'law', 'decree_law', 'presidential_decree', 'regulation')),
	CONSTRAINT "laws_status_chk" CHECK ("status" IN ('in_force', 'repealed'))
);
--> statement-breakpoint
CREATE TABLE "corpus"."source_status" (
	"source" text PRIMARY KEY NOT NULL,
	"live_enabled" boolean DEFAULT false NOT NULL,
	"breaker_state" text DEFAULT 'closed' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"p95_ms" integer,
	"state" text,
	"breaker_open_until" timestamp with time zone,
	"bucket_fill_pct" integer,
	"waiting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters_1h" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_canary_at" timestamp with time zone,
	"last_canary_ok" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_status_source_chk" CHECK ("source" IN ('bedesten', 'anayasa', 'uyusmazlik', 'mevzuat', 'kik', 'rekabet', 'gib', 'yargitay', 'danistay', 'emsal', 'sayistay', 'kvkk', 'bddk', 'sigorta_tahkim')),
	CONSTRAINT "source_status_breaker_state_chk" CHECK ("breaker_state" IN ('closed', 'open', 'half_open')),
	CONSTRAINT "source_status_state_chk" CHECK ("state" IN ('up', 'degraded', 'down', 'disabled')),
	CONSTRAINT "source_status_bucket_fill_pct_chk" CHECK ("bucket_fill_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "corpus"."decision_chunks" ADD CONSTRAINT "decision_chunks_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "corpus"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."decision_chunks" ADD CONSTRAINT "decision_chunks_section_id_decision_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "corpus"."decision_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."decision_sections" ADD CONSTRAINT "decision_sections_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "corpus"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."decisions" ADD CONSTRAINT "decisions_ingestion_run_id_ingestion_runs_id_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "corpus"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."law_article_chunks" ADD CONSTRAINT "law_article_chunks_article_id_law_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "corpus"."law_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."law_article_chunks" ADD CONSTRAINT "law_article_chunks_version_id_law_article_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "corpus"."law_article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."law_article_versions" ADD CONSTRAINT "law_article_versions_article_id_law_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "corpus"."law_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus"."law_articles" ADD CONSTRAINT "law_articles_law_id_laws_id_fk" FOREIGN KEY ("law_id") REFERENCES "corpus"."laws"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_chunks_section_idx" ON "corpus"."decision_chunks" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "decision_chunks_filter_idx" ON "corpus"."decision_chunks" USING btree ("court_type","decision_date");--> statement-breakpoint
CREATE INDEX "decision_chunks_decision_idx" ON "corpus"."decision_chunks" USING btree ("decision_id","section_id","chunk_no");--> statement-breakpoint
CREATE INDEX "decision_chunks_pending_idx" ON "corpus"."decision_chunks" USING btree ("id") WHERE "emb" IS NULL;--> statement-breakpoint
CREATE INDEX "decision_sections_fold_tsv_idx" ON "corpus"."decision_sections" USING gin ("fold_tsv");--> statement-breakpoint
CREATE INDEX "decisions_chamber_esas_idx" ON "corpus"."decisions" USING btree ("chamber_code","esas_no") WHERE "esas_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "decisions_chamber_karar_idx" ON "corpus"."decisions" USING btree ("chamber_code","karar_no") WHERE "karar_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "decisions_court_date_idx" ON "corpus"."decisions" USING btree ("court_code","decision_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decisions_date_idx" ON "corpus"."decisions" USING btree ("decision_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decisions_kunye_trgm_idx" ON "corpus"."decisions" USING gin ("kunye_fold" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "decisions_cited_idx" ON "corpus"."decisions" USING gin ("cited_articles" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "decisions_run_idx" ON "corpus"."decisions" USING btree ("ingestion_run_id") WHERE "ingestion_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "decisions_kunye_hash_idx" ON "corpus"."decisions" USING btree ("kunye_hash") WHERE "kunye_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "decisions_court_type_date_idx" ON "corpus"."decisions" USING btree ("court_type","decision_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ingestion_runs_kind_idx" ON "corpus"."ingestion_runs" USING btree ("kind","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "law_article_chunks_version_idx" ON "corpus"."law_article_chunks" USING btree ("version_id") WHERE "version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "law_articles_order_idx" ON "corpus"."law_articles" USING btree ("law_id","sort_order");--> statement-breakpoint
CREATE INDEX "law_articles_fold_tsv_idx" ON "corpus"."law_articles" USING gin ("fold_tsv");--> statement-breakpoint
CREATE INDEX "laws_title_trgm_idx" ON "corpus"."laws" USING gin ("title_fold" gin_trgm_ops);