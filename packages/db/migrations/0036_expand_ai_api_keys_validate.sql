-- eda:kind expand
-- #54 BYOK: 0035'te NOT VALID eklenen CHECK kısıtları doğrulanır (M-07: VALIDATE ayrı dosyada).
ALTER TABLE "app"."org_settings" VALIDATE CONSTRAINT "org_settings_ai_api_key_chk";--> statement-breakpoint
ALTER TABLE "app"."user_preferences" VALIDATE CONSTRAINT "user_preferences_ai_key_source_chk";--> statement-breakpoint
ALTER TABLE "app"."user_preferences" VALIDATE CONSTRAINT "user_preferences_ai_api_key_chk";
