CREATE SCHEMA IF NOT EXISTS "orders";
CREATE TABLE "orders"."orders" (
  "id" UUID NOT NULL,
  "customer_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "placed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  CONSTRAINT "orders_status_enum" CHECK ("status" IN ('Draft', 'Confirmed', 'Shipped', 'Cancelled'))
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "orders";
CREATE TABLE "orders"."order_lines" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("order_id") REFERENCES "orders"."orders" ON DELETE CASCADE
);
CREATE INDEX "order_lines_order_id_idx" ON "orders"."order_lines" ("order_id");
CREATE INDEX "order_lines_product_id_idx" ON "orders"."order_lines" ("product_id");
