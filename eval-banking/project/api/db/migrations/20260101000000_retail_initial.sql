CREATE SCHEMA IF NOT EXISTS "banking";
CREATE TABLE "banking"."customers" (
  "id" UUID NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "banking";
CREATE TABLE "banking"."accounts" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "owner" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "balance" DECIMAL(19, 4) NOT NULL,
  "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("owner") REFERENCES "banking"."customers" ON DELETE RESTRICT,
  CONSTRAINT "accounts_kind_enum" CHECK ("kind" IN ('Checking', 'Savings')),
  CONSTRAINT "accounts_status_enum" CHECK ("status" IN ('Active', 'Frozen', 'Closed'))
);
CREATE INDEX "accounts_owner_idx" ON "banking"."accounts" ("owner");
