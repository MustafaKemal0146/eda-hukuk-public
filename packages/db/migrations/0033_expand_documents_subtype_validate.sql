-- eda:kind expand
-- P17b: 0032'de NOT VALID eklenen alt tür CHECK kısıtları doğrulanır (M-07: VALIDATE ayrı dosyada).
ALTER TABLE "app"."documents" VALIDATE CONSTRAINT "documents_subtype_chk";--> statement-breakpoint
ALTER TABLE "app"."templates" VALIDATE CONSTRAINT "templates_subtype_chk";
