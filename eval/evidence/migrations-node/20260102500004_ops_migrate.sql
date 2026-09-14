UPDATE "field"."sites" SET "address_line" = 'unknown' WHERE "address_line" IS NULL;
--> statement-breakpoint
ALTER TABLE "field"."sites" ALTER COLUMN "address_line" SET NOT NULL;
