-- eda:kind index
-- eda:no-transaction
-- eda:patched CREATE INDEX -> CONCURRENTLY IF NOT EXISTS; yarım kalan deneme için önce DROP INDEX CONCURRENTLY IF EXISTS (032 §8.3)
-- KK-030-17: auth tablolarında FK öncü kolon indeksi eksik beş FK (aktör/onaylayan kolonları ve
-- oturumun etkin bürosu). Tablolar P03a'da kurulduğu için indeksler işlemsiz CONCURRENTLY ile eklenir.
DROP INDEX CONCURRENTLY IF EXISTS auth.recovery_approved_by_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recovery_approved_by_idx" ON "auth"."account_recovery_requests" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS auth.recovery_staff_approver_1_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recovery_staff_approver_1_idx" ON "auth"."account_recovery_requests" USING btree ("staff_approver_1") WHERE "staff_approver_1" IS NOT NULL;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS auth.recovery_staff_approver_2_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recovery_staff_approver_2_idx" ON "auth"."account_recovery_requests" USING btree ("staff_approver_2") WHERE "staff_approver_2" IS NOT NULL;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS auth.invitations_inviter_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "invitations_inviter_idx" ON "auth"."invitations" USING btree ("inviter_id");
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS auth.sessions_active_org_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sessions_active_org_idx" ON "auth"."sessions" USING btree ("active_organization_id") WHERE "active_organization_id" IS NOT NULL;
