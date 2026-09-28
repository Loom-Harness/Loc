CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."customers" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "contact_email" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE INDEX "customers_tenant_id_idx" ON "field"."customers" ("tenant_id");
CREATE INDEX "customers_data_key_idx" ON "field"."customers" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."organizations" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."parts" (
  "id" UUID NOT NULL,
  "sku" TEXT NOT NULL,
  "on_hand" INTEGER NOT NULL,
  "unit_price" DECIMAL(19, 4) NOT NULL,
  "currency" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parts_tenant_id_sku_uq" ON "field"."parts" ("tenant_id", "sku");
CREATE INDEX "parts_tenant_id_idx" ON "field"."parts" ("tenant_id");
CREATE INDEX "parts_data_key_idx" ON "field"."parts" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."sites" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "address_line" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
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
  "serial_number" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "warranty_expiry" TIMESTAMP WITH TIME ZONE NULL,
  "required_skill" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("site_id") REFERENCES "field"."sites" ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "assets_tenant_id_serial_number_uq" ON "field"."assets" ("tenant_id", "serial_number");
CREATE INDEX "assets_site_id_idx" ON "field"."assets" ("site_id");
CREATE INDEX "assets_tenant_id_idx" ON "field"."assets" ("tenant_id");
CREATE INDEX "assets_data_key_idx" ON "field"."assets" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."technicians" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "skills" TEXT[] NOT NULL,
  "cost_rate" DECIMAL(19, 4) NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
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
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
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
CREATE TABLE "field"."invoices" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "issued_at" TIMESTAMP WITH TIME ZONE NULL,
  "amount" DECIMAL(19, 4) NOT NULL,
  "currency" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "data_key" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("work_order_id") REFERENCES "field"."work_orders" ON DELETE RESTRICT
);
CREATE INDEX "invoices_work_order_id_idx" ON "field"."invoices" ("work_order_id");
CREATE INDEX "invoices_tenant_id_idx" ON "field"."invoices" ("tenant_id");
CREATE INDEX "invoices_data_key_idx" ON "field"."invoices" ("data_key" text_pattern_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "field";
CREATE TABLE "field"."work_order_lines" (
  "id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL NOT NULL,
  "unit_price" DECIMAL(19, 4) NOT NULL,
  "currency" TEXT NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("work_order_id") REFERENCES "field"."work_orders" ON DELETE CASCADE
);
CREATE INDEX "work_order_lines_work_order_id_idx" ON "field"."work_order_lines" ("work_order_id");
