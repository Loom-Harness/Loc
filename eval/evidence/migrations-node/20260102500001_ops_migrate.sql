CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."service_contracts" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "starts_on" TIMESTAMP WITH TIME ZONE NOT NULL,
  "ends_on" TIMESTAMP WITH TIME ZONE NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("customer_id") REFERENCES "field"."customers" ON DELETE RESTRICT
);
CREATE INDEX "service_contracts_customer_id_idx" ON "field"."service_contracts" ("customer_id");
CREATE INDEX "service_contracts_tenant_id_idx" ON "field"."service_contracts" ("tenant_id");
CREATE INDEX "service_contracts_data_key_idx" ON "field"."service_contracts" ("data_key" text_pattern_ops);
--> statement-breakpoint
ALTER TABLE "field"."work_orders" ADD COLUMN "customer_signature" TEXT NULL;
