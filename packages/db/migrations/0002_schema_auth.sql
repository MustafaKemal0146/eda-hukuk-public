-- eda:kind schema
-- eda:patched CREATE SCHEMA satırları çıkarıldı (şemalar initdb 050 ve 0000'da); ad kolonlarına tr-TR-x-icu harmanlaması (030 §14)
-- L2 (032 §2.1): auth şeması (Better Auth, 030 §3) ve app.partners (030 §4); drizzle-kit generate çıktısı.
CREATE TABLE "auth"."account_recovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"approval_path" text NOT NULL,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"new_email" text,
	"approved_by" uuid,
	"staff_approver_1" uuid,
	"staff_approver_2" uuid,
	"evidence_code" text,
	"complete_token_hash" "bytea",
	"cancel_token_hash" "bytea",
	"ip_trunc" "inet",
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"executable_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "account_recovery_requests_kind_chk" CHECK ("kind" IN ('mfa_reset', 'email_change')),
	CONSTRAINT "account_recovery_requests_approval_path_chk" CHECK ("approval_path" IN ('org_owner', 'staff')),
	CONSTRAINT "account_recovery_requests_status_chk" CHECK ("status" IN ('awaiting_approval', 'waiting', 'ready', 'completed', 'canceled', 'rejected', 'expired')),
	CONSTRAINT "account_recovery_requests_evidence_code_chk" CHECK ("evidence_code" IN ('kep_verified', 'document_verified')),
	CONSTRAINT "account_recovery_requests_new_email_chk" CHECK ("new_email" IS NULL OR "new_email" = lower("new_email")),
	CONSTRAINT "account_recovery_requests_complete_token_hash_chk" CHECK (octet_length("complete_token_hash") = 32),
	CONSTRAINT "account_recovery_requests_cancel_token_hash_chk" CHECK (octet_length("cancel_token_hash") = 32),
	CONSTRAINT "recovery_staff_distinct_chk" CHECK ("staff_approver_1" IS NULL OR "staff_approver_2" IS NULL OR "staff_approver_1" <> "staff_approver_2"),
	CONSTRAINT "recovery_owner_not_self_chk" CHECK ("approved_by" IS NULL OR "approved_by" <> "user_id"),
	CONSTRAINT "recovery_email_chk" CHECK (("kind" = 'email_change') = ("new_email" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "auth"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_uq" UNIQUE("provider_id","account_id"),
	CONSTRAINT "accounts_password_chk" CHECK ("password" IS NULL OR "password" LIKE '$argon2id$%')
);
--> statement-breakpoint
CREATE TABLE "auth"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_email_chk" CHECK ("email" = lower("email")),
	CONSTRAINT "invitations_role_chk" CHECK ("role" IN ('admin', 'senior_lawyer', 'lawyer', 'trainee', 'assistant')),
	CONSTRAINT "invitations_status_chk" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "auth"."members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_org_user_uq" UNIQUE("organization_id","user_id"),
	CONSTRAINT "members_role_chk" CHECK ("role" IN ('owner', 'admin', 'senior_lawyer', 'lawyer', 'trainee', 'assistant')),
	CONSTRAINT "members_status_chk" CHECK ("status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "auth"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text COLLATE "tr-TR-x-icu" NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"kind" text DEFAULT 'individual' NOT NULL,
	"partner_code" text,
	"suspended_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_uq" UNIQUE("slug"),
	CONSTRAINT "organizations_kind_chk" CHECK ("kind" IN ('individual', 'firm'))
);
--> statement-breakpoint
CREATE TABLE "app"."partners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text COLLATE "tr-TR-x-icu" NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"commission_rate_bp" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_code_uq" UNIQUE("code"),
	CONSTRAINT "partners_code_chk" CHECK ("code" ~ '^[A-Z0-9-]{4,32}$'),
	CONSTRAINT "partners_contact_email_chk" CHECK ("contact_email" = lower("contact_email")),
	CONSTRAINT "partners_commission_rate_bp_chk" CHECK ("commission_rate_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "auth"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_uq" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"impersonated_by" uuid,
	"mfa_level" text DEFAULT 'none' NOT NULL,
	"step_up_at" timestamp with time zone,
	"surface" text DEFAULT 'app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_uq" UNIQUE("token"),
	CONSTRAINT "sessions_impersonated_by_chk" CHECK ("impersonated_by" IS NULL),
	CONSTRAINT "sessions_mfa_level_chk" CHECK ("mfa_level" IN ('none', 'totp', 'passkey')),
	CONSTRAINT "sessions_surface_chk" CHECK ("surface" IN ('app', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "auth"."two_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "two_factors_user_id_uq" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text COLLATE "tr-TR-x-icu" NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"platform_role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires_at" timestamp with time zone,
	"verification_status" text DEFAULT 'pending_verification' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_uq" UNIQUE("email"),
	CONSTRAINT "users_platform_role_chk" CHECK ("platform_role" IN ('user', 'support', 'super_admin')),
	CONSTRAINT "users_verification_status_chk" CHECK ("verification_status" IN ('pending_verification', 'verified', 'rejected', 'suspended')),
	CONSTRAINT "users_email_chk" CHECK (email = lower(email) AND email !~ '[^\x21-\x7E]')
);
--> statement-breakpoint
CREATE TABLE "auth"."verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_staff_approver_1_users_id_fk" FOREIGN KEY ("staff_approver_1") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_staff_approver_2_users_id_fk" FOREIGN KEY ("staff_approver_2") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."organizations" ADD CONSTRAINT "organizations_partner_code_partners_code_fk" FOREIGN KEY ("partner_code") REFERENCES "app"."partners"("code") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "auth"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "auth"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_open_uq" ON "auth"."account_recovery_requests" USING btree ("user_id","kind") WHERE "status" IN ('awaiting_approval', 'waiting', 'ready');--> statement-breakpoint
CREATE INDEX "recovery_expiry_idx" ON "auth"."account_recovery_requests" USING btree ("expires_at") WHERE "status" IN ('awaiting_approval', 'waiting', 'ready');--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "auth"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_uq" ON "auth"."invitations" USING btree ("organization_id","email") WHERE "status" IN ('pending');--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "auth"."invitations" USING btree ("email") WHERE "status" IN ('pending');--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "auth"."members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizations_partner_code_idx" ON "auth"."organizations" USING btree ("partner_code") WHERE "partner_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "auth"."passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "auth"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "auth"."verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verifications_expires_at_idx" ON "auth"."verifications" USING btree ("expires_at");
