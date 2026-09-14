ALTER TABLE "field"."parts" ADD COLUMN "bin_location" TEXT NULL;
--> statement-breakpoint
UPDATE "field"."parts" SET "bin_location" = 'UNASSIGNED' WHERE "bin_location" IS NULL;
--> statement-breakpoint
ALTER TABLE "field"."parts" ALTER COLUMN "bin_location" SET NOT NULL;
