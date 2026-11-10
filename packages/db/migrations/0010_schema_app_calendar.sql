-- eda:kind schema
-- eda:patched reminders fillfactor = 90 (030 §1.5); ON DELETE SET NULL (kolon) (030 §1.4)
-- L2 (032 §2.1): app takvim, süre ve bildirim tabloları (030 §9) + notification_preferences (045 §13.1);
-- drizzle-kit generate çıktısı. RLS + GRANT aynı commit'teki rls_app_calendar'dadır.
CREATE TABLE "app"."calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"case_id" uuid,
	"deadline_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"court_code" text,
	"esas_no" text,
	"notes" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "calendar_events_type_chk" CHECK ("type" IN ('hearing', 'deadline', 'discovery', 'expert', 'meeting', 'mediation', 'task')),
	CONSTRAINT "calendar_events_esas_no_chk" CHECK (char_length("esas_no") <= 32),
	CONSTRAINT "calendar_events_range_chk" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."deadlines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid,
	"source_file_id" uuid,
	"rule_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"start_event" text NOT NULL,
	"event_date" date NOT NULL,
	"service_method" text,
	"due_date" date NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"safe_due_at" timestamp with time zone,
	"contested_due_date" date,
	"calculation" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"evidence_quote" text,
	"status" text DEFAULT 'open' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filed_declared_by" uuid,
	"filed_declared_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadlines_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "deadlines_start_event_chk" CHECK ("start_event" IN ('service', 'pronouncement', 'learning')),
	CONSTRAINT "deadlines_service_method_chk" CHECK ("service_method" IN ('postal', 'e_tebligat')),
	CONSTRAINT "deadlines_status_chk" CHECK ("status" IN ('open', 'filed_declared', 'cancelled')),
	CONSTRAINT "deadlines_filed_chk" CHECK (("status" = 'filed_declared') = ("filed_declared_at" IS NOT NULL)),
	CONSTRAINT "deadlines_e_tebligat_chk" CHECK ("start_event" = 'service' OR "service_method" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."notification_preferences" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("user_id","kind","channel"),
	CONSTRAINT "notification_preferences_kind_chk" CHECK ("kind" IN ('reminder', 'deadline_due', 'file_ready', 'file_failed', 'export_ready', 'kunye_check_ready', 'invitation', 'verification_approved', 'verification_rejected', 'credit_low', 'provider_change_notice', 'announcement', 'retention_due')),
	CONSTRAINT "notification_preferences_channel_chk" CHECK ("channel" IN ('in_app', 'email', 'push'))
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_chk" CHECK ("type" IN ('reminder', 'deadline_due', 'file_ready', 'file_failed', 'export_ready', 'kunye_check_ready', 'invitation', 'verification_approved', 'verification_rejected', 'credit_low', 'provider_change_notice', 'announcement', 'retention_due'))
);
--> statement-breakpoint
CREATE TABLE "app"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"endpoint_host" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_secret" text NOT NULL,
	"device_label" text,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_uq" UNIQUE("org_id","user_id","endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_chk" CHECK ("endpoint" LIKE 'https://%')
);
--> statement-breakpoint
CREATE TABLE "app"."reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_event_id" uuid,
	"deadline_id" uuid,
	"remind_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_uq" UNIQUE NULLS NOT DISTINCT("org_id","user_id","calendar_event_id","deadline_id","channel","remind_at"),
	CONSTRAINT "reminders_channel_chk" CHECK ("channel" IN ('in_app', 'email', 'push')),
	CONSTRAINT "reminders_status_chk" CHECK ("status" IN ('scheduled', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "reminders_target_chk" CHECK (num_nonnulls("calendar_event_id", "deadline_id") = 1)
) WITH (fillfactor = 90);
--> statement-breakpoint
ALTER TABLE "app"."calendar_events" ADD CONSTRAINT "calendar_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_events" ADD CONSTRAINT "calendar_events_court_code_courts_code_fk" FOREIGN KEY ("court_code") REFERENCES "app"."courts"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_events" ADD CONSTRAINT "calendar_events_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."calendar_events" ADD CONSTRAINT "calendar_events_deadline_fk" FOREIGN KEY ("org_id","deadline_id") REFERENCES "app"."deadlines"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deadlines" ADD CONSTRAINT "deadlines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deadlines" ADD CONSTRAINT "deadlines_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deadlines" ADD CONSTRAINT "deadlines_filed_declared_by_users_id_fk" FOREIGN KEY ("filed_declared_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deadlines" ADD CONSTRAINT "deadlines_case_fk" FOREIGN KEY ("org_id","case_id") REFERENCES "app"."cases"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deadlines" ADD CONSTRAINT "deadlines_source_file_fk" FOREIGN KEY ("org_id","source_file_id") REFERENCES "app"."files"("org_id","id") ON DELETE SET NULL ("source_file_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deadlines" ADD CONSTRAINT "deadlines_rule_fk" FOREIGN KEY ("rule_id","rule_version") REFERENCES "app"."deadline_rules"("id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reminders" ADD CONSTRAINT "reminders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "auth"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reminders" ADD CONSTRAINT "reminders_calendar_event_fk" FOREIGN KEY ("org_id","calendar_event_id") REFERENCES "app"."calendar_events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reminders" ADD CONSTRAINT "reminders_deadline_fk" FOREIGN KEY ("org_id","deadline_id") REFERENCES "app"."deadlines"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_org_time_idx" ON "app"."calendar_events" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_user_time_idx" ON "app"."calendar_events" USING btree ("org_id","user_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_case_idx" ON "app"."calendar_events" USING btree ("org_id","case_id","starts_at") WHERE "case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_events_deadline_idx" ON "app"."calendar_events" USING btree ("org_id","deadline_id") WHERE "deadline_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "calendar_events_user_idx" ON "app"."calendar_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_events_created_by_idx" ON "app"."calendar_events" USING btree ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deadlines_open_idx" ON "app"."deadlines" USING btree ("org_id","due_date") WHERE "status" IN ('open');--> statement-breakpoint
CREATE INDEX "deadlines_case_idx" ON "app"."deadlines" USING btree ("org_id","case_id","due_date") WHERE "case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deadlines_file_idx" ON "app"."deadlines" USING btree ("org_id","source_file_id") WHERE "source_file_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deadlines_rule_idx" ON "app"."deadlines" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "deadlines_approved_by_idx" ON "app"."deadlines" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deadlines_filed_declared_by_idx" ON "app"."deadlines" USING btree ("filed_declared_by") WHERE "filed_declared_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "app"."notifications" USING btree ("org_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "app"."notifications" USING btree ("org_id","user_id") WHERE "read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_retention_due_idx" ON "app"."notifications" USING btree (("payload" ->> 'caseId')) WHERE "type" IN ('retention_due');--> statement-breakpoint
CREATE INDEX "notifications_owner_idx" ON "app"."notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "app"."push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "app"."reminders" USING btree ("remind_at") WHERE "status" IN ('scheduled');--> statement-breakpoint
CREATE INDEX "reminders_event_idx" ON "app"."reminders" USING btree ("org_id","calendar_event_id") WHERE "calendar_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reminders_dl_idx" ON "app"."reminders" USING btree ("org_id","deadline_id") WHERE "deadline_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "app"."reminders" USING btree ("user_id");