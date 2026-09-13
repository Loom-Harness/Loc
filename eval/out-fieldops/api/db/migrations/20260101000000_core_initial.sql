CREATE SCHEMA IF NOT EXISTS "directory";
CREATE TABLE "directory"."customers" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "customers_tenant_id_idx" ON "directory"."customers" ("tenant_id");
CREATE INDEX "customers_data_key_idx" ON "directory"."customers" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "billing";
CREATE TABLE "billing"."invoices" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "issued" BOOLEAN NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "invoices_work_order_id_idx" ON "billing"."invoices" ("work_order_id");
CREATE INDEX "invoices_customer_id_idx" ON "billing"."invoices" ("customer_id");
CREATE INDEX "invoices_tenant_id_idx" ON "billing"."invoices" ("tenant_id");
CREATE INDEX "invoices_data_key_idx" ON "billing"."invoices" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "notifications";
CREATE TABLE "notifications"."notification_logs" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "notification_logs_work_order_id_idx" ON "notifications"."notification_logs" ("work_order_id");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "tenancy";
CREATE TABLE "tenancy"."organizations" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "dispatch";
CREATE TABLE "dispatch"."parts" (
  "id" UUID NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stock_level" INTEGER NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "parts_tenant_id_idx" ON "dispatch"."parts" ("tenant_id");
CREATE INDEX "parts_data_key_idx" ON "dispatch"."parts" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "notifications";
CREATE TABLE "notifications"."record_completions" (
  "work_order_id" UUID NOT NULL,
  PRIMARY KEY ("work_order_id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "directory";
CREATE TABLE "directory"."sites" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "address_line" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("customer_id") REFERENCES "directory"."customers" ON DELETE RESTRICT
);
CREATE INDEX "sites_customer_id_idx" ON "directory"."sites" ("customer_id");
CREATE INDEX "sites_tenant_id_idx" ON "directory"."sites" ("tenant_id");
CREATE INDEX "sites_data_key_idx" ON "directory"."sites" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "directory";
CREATE TABLE "directory"."assets" (
  "id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "required_skill" TEXT NOT NULL,
  "serial_number" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "warranty_expiry" TIMESTAMP WITH TIME ZONE NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("site_id") REFERENCES "directory"."sites" ON DELETE RESTRICT
);
CREATE INDEX "assets_site_id_idx" ON "directory"."assets" ("site_id");
CREATE INDEX "assets_tenant_id_idx" ON "directory"."assets" ("tenant_id");
CREATE INDEX "assets_data_key_idx" ON "directory"."assets" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "dispatch";
CREATE TABLE "dispatch"."technicians" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "skills" TEXT[] NOT NULL,
  "cost_rate_per_hour" DECIMAL NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "technicians_tenant_id_idx" ON "dispatch"."technicians" ("tenant_id");
CREATE INDEX "technicians_data_key_idx" ON "dispatch"."technicians" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "dispatch";
CREATE TABLE "dispatch"."work_orders" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "asset_id" UUID NULL,
  "technician_id" UUID NULL,
  "technician_user_id" TEXT NULL,
  "status" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "scheduled_at" TIMESTAMP WITH TIME ZONE NULL,
  "started_at" TIMESTAMP WITH TIME ZONE NULL,
  "completed_at" TIMESTAMP WITH TIME ZONE NULL,
  "resolution_note" TEXT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("technician_id") REFERENCES "dispatch"."technicians" ON DELETE RESTRICT
);
CREATE INDEX "work_orders_customer_id_idx" ON "dispatch"."work_orders" ("customer_id");
CREATE INDEX "work_orders_site_id_idx" ON "dispatch"."work_orders" ("site_id");
CREATE INDEX "work_orders_asset_id_idx" ON "dispatch"."work_orders" ("asset_id");
CREATE INDEX "work_orders_technician_id_idx" ON "dispatch"."work_orders" ("technician_id");
CREATE INDEX "work_orders_tenant_id_idx" ON "dispatch"."work_orders" ("tenant_id");
CREATE INDEX "work_orders_data_key_idx" ON "dispatch"."work_orders" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "dispatch";
CREATE TABLE "dispatch"."photos" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "file" JSONB NOT NULL,
  "caption" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("work_order_id") REFERENCES "dispatch"."work_orders" ON DELETE CASCADE
);
CREATE INDEX "photos_work_order_id_idx" ON "dispatch"."photos" ("work_order_id");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "dispatch";
CREATE TABLE "dispatch"."work_order_lines" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "part_id" UUID NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price_amount" DECIMAL NOT NULL,
  "unit_price_currency" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("work_order_id") REFERENCES "dispatch"."work_orders" ON DELETE CASCADE,
  FOREIGN KEY ("part_id") REFERENCES "dispatch"."parts" ON DELETE RESTRICT
);
CREATE INDEX "work_order_lines_work_order_id_idx" ON "dispatch"."work_order_lines" ("work_order_id");
CREATE INDEX "work_order_lines_part_id_idx" ON "dispatch"."work_order_lines" ("part_id");
