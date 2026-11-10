-- eda:kind expand
-- #54 BYOK (büro/baro ve kullanıcı Claude API anahtarı): yalnız ekleme. Kolonlar NULL olabilir (anahtar yok = NULL);
-- `user_preferences.ai_key_source` sabit DEFAULT 'org' ile NOT NULL. CHECK'ler NOT VALID eklenir, VALIDATE 0036'da.
-- Geri alma: kolonları ve kayıtları düşürmek.
ALTER TABLE "app"."org_settings" ADD COLUMN "ai_api_key_enc" "bytea";--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD COLUMN "ai_api_key_last4" text;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD COLUMN "ai_api_key_version" integer;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD COLUMN "ai_api_key_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD COLUMN "ai_key_source" text DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD COLUMN "ai_api_key_enc" "bytea";--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD COLUMN "ai_api_key_last4" text;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD COLUMN "ai_api_key_version" integer;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD COLUMN "ai_api_key_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."org_settings" ADD CONSTRAINT "org_settings_ai_api_key_chk" CHECK (("ai_api_key_enc" IS NULL) = ("ai_api_key_last4" IS NULL) AND ("ai_api_key_enc" IS NULL) = ("ai_api_key_version" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD CONSTRAINT "user_preferences_ai_key_source_chk" CHECK ("ai_key_source" IN ('org', 'own')) NOT VALID;--> statement-breakpoint
ALTER TABLE "app"."user_preferences" ADD CONSTRAINT "user_preferences_ai_api_key_chk" CHECK (("ai_api_key_enc" IS NULL) = ("ai_api_key_last4" IS NULL) AND ("ai_api_key_enc" IS NULL) = ("ai_api_key_version" IS NULL)) NOT VALID;