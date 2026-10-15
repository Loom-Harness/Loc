CREATE SCHEMA IF NOT EXISTS "banking";
CREATE TABLE "banking"."ledger_entries" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(19, 4) NOT NULL,
  "balance_after" DECIMAL(19, 4) NOT NULL,
  "at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "memo" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("account_id") REFERENCES "banking"."accounts" ON DELETE CASCADE,
  CONSTRAINT "ledger_entries_kind_enum" CHECK ("kind" IN ('Deposit', 'Withdrawal', 'TransferIn', 'TransferOut'))
);
CREATE INDEX "ledger_entries_account_id_idx" ON "banking"."ledger_entries" ("account_id");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "banking";
CREATE TABLE "banking"."transfers" (
  "id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "source" UUID NOT NULL,
  "target" UUID NOT NULL,
  "amount" DECIMAL(19, 4) NOT NULL,
  "status" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "decided_by" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("source") REFERENCES "banking"."accounts" ON DELETE RESTRICT,
  FOREIGN KEY ("target") REFERENCES "banking"."accounts" ON DELETE RESTRICT,
  CONSTRAINT "transfers_status_enum" CHECK ("status" IN ('Pending', 'Completed', 'Rejected'))
);
CREATE UNIQUE INDEX "transfers_reference_uq" ON "banking"."transfers" ("reference");
CREATE INDEX "transfers_source_idx" ON "banking"."transfers" ("source");
CREATE INDEX "transfers_target_idx" ON "banking"."transfers" ("target");
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ADD COLUMN "daily_limit" DECIMAL(19, 4) NULL;
--> statement-breakpoint
UPDATE "banking"."accounts" SET "daily_limit" = 1000 WHERE "daily_limit" IS NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ALTER COLUMN "daily_limit" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ADD COLUMN "withdrawn_today" DECIMAL(19, 4) NULL;
--> statement-breakpoint
UPDATE "banking"."accounts" SET "withdrawn_today" = 0 WHERE "withdrawn_today" IS NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ALTER COLUMN "withdrawn_today" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ADD COLUMN "limit_day" TIMESTAMP WITH TIME ZONE NULL;
--> statement-breakpoint
UPDATE "banking"."accounts" SET "limit_day" = "opened_at" WHERE "limit_day" IS NULL;
--> statement-breakpoint
ALTER TABLE "banking"."accounts" ALTER COLUMN "limit_day" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_number_uq" ON "banking"."accounts" ("number");
