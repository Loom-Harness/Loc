CREATE SCHEMA IF NOT EXISTS "notifications";
--> statement-breakpoint
CREATE TABLE "notifications"."notifications" (
  "id" UUID NOT NULL,
  "recipient" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "via" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  CONSTRAINT "notifications_via_enum" CHECK ("via" IN ('Email', 'Push'))
);
--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications"."notifications" ("recipient");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "notifications";
--> statement-breakpoint
CREATE TABLE "notifications"."notify_transfers" (
  "transfer_ref" UUID NOT NULL,
  PRIMARY KEY ("transfer_ref")
);
