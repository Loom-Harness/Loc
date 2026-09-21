UPDATE "clinics"."clinics" SET "timezone" = 'Europe/Tallinn' WHERE "timezone" IS NULL;
--> statement-breakpoint
ALTER TABLE "clinics"."clinics" ALTER COLUMN "timezone" SET NOT NULL;
