ALTER TABLE "banking"."accounts" DROP CONSTRAINT IF EXISTS "accounts_kind_enum";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "banking";
CREATE TABLE "banking"."interest_runs" (
  "id" UUID NOT NULL,
  "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "banking";
CREATE TABLE "banking"."monthly_interests" (
  "run" UUID NOT NULL,
  PRIMARY KEY ("run")
);
--> statement-breakpoint
ALTER TABLE "banking"."accounts" RENAME COLUMN "kind" TO "account_type";
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ADD COLUMN "currency" TEXT NULL;
--> statement-breakpoint
UPDATE "banking"."accounts" SET "currency" = 'EUR' WHERE "currency" IS NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ALTER COLUMN "currency" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ADD COLUMN "interest_rate" DECIMAL NULL;
--> statement-breakpoint
UPDATE "banking"."accounts" SET "interest_rate" = (CASE WHEN ("account_type" = 'Savings') THEN 0.02 ELSE 0.0 END) WHERE "interest_rate" IS NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ALTER COLUMN "interest_rate" SET NOT NULL;
--> statement-breakpoint
-- NOT VALID: already-stored rows are not re-checked. To verify them, run ALTER TABLE "banking"."accounts" VALIDATE CONSTRAINT "accounts_account_type_enum"
ALTER TABLE "banking"."accounts" ADD CONSTRAINT "accounts_account_type_enum" CHECK ("account_type" IN ('Checking', 'Savings')) NOT VALID;
