CREATE TABLE "audit_records" (
  "audit_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "actor" JSONB NULL,
  "before" JSONB NULL,
  "after" JSONB NULL,
  "at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "status" TEXT NOT NULL,
  "correlation_id" TEXT NULL,
  "scope_id" TEXT NULL,
  "parent_id" TEXT NULL,
  PRIMARY KEY ("audit_id")
);
CREATE INDEX "audit_records_target_idx" ON "audit_records" ("target_type", "target_id");
CREATE INDEX "audit_records_correlation_idx" ON "audit_records" ("correlation_id");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."customers" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "billing_email" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "customers_tenant_id_idx" ON "field"."customers" ("tenant_id");
CREATE INDEX "customers_data_key_idx" ON "field"."customers" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "billing";
CREATE TABLE "billing"."invoices" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(19, 4) NOT NULL,
  "status" TEXT NOT NULL,
  "issued_at" TIMESTAMP WITH TIME ZONE NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoices_tenant_id_number_uq" ON "billing"."invoices" ("tenant_id", "number");
CREATE INDEX "invoices_work_order_id_idx" ON "billing"."invoices" ("work_order_id");
CREATE INDEX "invoices_customer_id_idx" ON "billing"."invoices" ("customer_id");
CREATE INDEX "invoices_tenant_id_idx" ON "billing"."invoices" ("tenant_id");
CREATE INDEX "invoices_data_key_idx" ON "billing"."invoices" ("data_key" text_pattern_ops);
CREATE INDEX "invoices_number_idx" ON "billing"."invoices" ("number");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."parts" (
  "id" UUID NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stock_on_hand" INTEGER NOT NULL,
  "unit_cost" DECIMAL(19, 4) NOT NULL,
  "currency" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parts_tenant_id_sku_uq" ON "field"."parts" ("tenant_id", "sku");
CREATE INDEX "parts_tenant_id_idx" ON "field"."parts" ("tenant_id");
CREATE INDEX "parts_data_key_idx" ON "field"."parts" ("data_key" text_pattern_ops);
CREATE INDEX "parts_sku_idx" ON "field"."parts" ("sku");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."sites" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "address_line" TEXT NOT NULL,
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
CREATE INDEX "sites_customer_id_idx" ON "field"."sites" ("customer_id");
CREATE INDEX "sites_tenant_id_idx" ON "field"."sites" ("tenant_id");
CREATE INDEX "sites_data_key_idx" ON "field"."sites" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."assets" (
  "id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "serial" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "warranty_expiry" TIMESTAMP WITH TIME ZONE NULL,
  "required_skill" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("site_id") REFERENCES "field"."sites" ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "assets_tenant_id_serial_uq" ON "field"."assets" ("tenant_id", "serial");
CREATE INDEX "assets_site_id_idx" ON "field"."assets" ("site_id");
CREATE INDEX "assets_tenant_id_idx" ON "field"."assets" ("tenant_id");
CREATE INDEX "assets_data_key_idx" ON "field"."assets" ("data_key" text_pattern_ops);
CREATE INDEX "assets_serial_idx" ON "field"."assets" ("serial");
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."technicians" (
  "id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "skills" TEXT[] NOT NULL,
  "cost_rate" DECIMAL(19, 4) NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "technicians_tenant_id_idx" ON "field"."technicians" ("tenant_id");
CREATE INDEX "technicians_data_key_idx" ON "field"."technicians" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."work_orders" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "asset_id" UUID NULL,
  "technician_id" UUID NULL,
  "status" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "scheduled_at" TIMESTAMP WITH TIME ZONE NULL,
  "started_at" TIMESTAMP WITH TIME ZONE NULL,
  "completed_at" TIMESTAMP WITH TIME ZONE NULL,
  "resolution_note" TEXT NULL,
  "photo" JSONB NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("customer_id") REFERENCES "field"."customers" ON DELETE RESTRICT,
  FOREIGN KEY ("site_id") REFERENCES "field"."sites" ON DELETE RESTRICT,
  FOREIGN KEY ("asset_id") REFERENCES "field"."assets" ON DELETE RESTRICT,
  FOREIGN KEY ("technician_id") REFERENCES "field"."technicians" ON DELETE RESTRICT
);
CREATE INDEX "work_orders_customer_id_idx" ON "field"."work_orders" ("customer_id");
CREATE INDEX "work_orders_site_id_idx" ON "field"."work_orders" ("site_id");
CREATE INDEX "work_orders_asset_id_idx" ON "field"."work_orders" ("asset_id");
CREATE INDEX "work_orders_technician_id_idx" ON "field"."work_orders" ("technician_id");
CREATE INDEX "work_orders_tenant_id_idx" ON "field"."work_orders" ("tenant_id");
CREATE INDEX "work_orders_data_key_idx" ON "field"."work_orders" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."part_usages" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "part_sku" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("work_order_id") REFERENCES "field"."work_orders" ON DELETE RESTRICT
);
CREATE INDEX "part_usages_work_order_id_idx" ON "field"."part_usages" ("work_order_id");
CREATE INDEX "part_usages_tenant_id_idx" ON "field"."part_usages" ("tenant_id");
CREATE INDEX "part_usages_data_key_idx" ON "field"."part_usages" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."work_order_lines" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL NOT NULL,
  "unit_price" DECIMAL(19, 4) NOT NULL,
  "currency" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("work_order_id") REFERENCES "field"."work_orders" ON DELETE CASCADE
);
CREATE INDEX "work_order_lines_work_order_id_idx" ON "field"."work_order_lines" ("work_order_id");
