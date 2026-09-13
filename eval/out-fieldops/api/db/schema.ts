// Auto-generated.
import { pgSchema, text, integer, numeric, boolean, timestamp, pgEnum, uuid, index, jsonb } from "drizzle-orm/pg-core";

export const tenancySchema = pgSchema("tenancy");
export const directorySchema = pgSchema("directory");
export const dispatchSchema = pgSchema("dispatch");
export const billingSchema = pgSchema("billing");

export const workOrderStatusEnum = pgEnum("work_order_status", ["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]);
export const priorityEnum = pgEnum("priority", ["Low", "Normal", "High", "Urgent"]);
export const lineKindEnum = pgEnum("line_kind", ["Labour", "Parts"]);

export const organizations = tenancySchema.table("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
});

export const customers = directorySchema.table("customers", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const sites = directorySchema.table("sites", {
  id: uuid("id").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  label: text("label").notNull(),
  addressLine: text("address_line").notNull(),
  city: text("city").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const assets = directorySchema.table("assets", {
  id: uuid("id").primaryKey(),
  siteId: uuid("site_id").notNull(),
  requiredSkill: text("required_skill").notNull(),
  serialNumber: text("serial_number").notNull(),
  model: text("model").notNull(),
  warrantyExpiry: timestamp("warranty_expiry", { withTimezone: true }).notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const technicians = dispatchSchema.table("technicians", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  skills: text("skills").array().notNull(),
  costRatePerHour: numeric("cost_rate_per_hour").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const parts = dispatchSchema.table("parts", {
  id: uuid("id").primaryKey(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  stockLevel: integer("stock_level").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const workOrders = dispatchSchema.table("work_orders", {
  id: uuid("id").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  siteId: uuid("site_id").notNull(),
  assetId: uuid("asset_id"),
  technicianId: uuid("technician_id"),
  technicianUserId: text("technician_user_id"),
  status: workOrderStatusEnum("status").notNull(),
  priority: priorityEnum("priority").notNull(),
  currency: text("currency").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
}, (table) => ({
    workOrderTechnicianUserIdIdx: index("work_orders_technician_user_id_idx").on(table.technicianUserId),
}));

export const photos = dispatchSchema.table("photos", {
  id: uuid("id").primaryKey(),
  parentId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  file: jsonb("file").notNull(),
  caption: text("caption").notNull(),
}, (table) => ({
    photoWork_orderIdIdx: index("photos_work_order_id_idx").on(table.parentId),
}));

export const workOrderLines = dispatchSchema.table("work_order_lines", {
  id: uuid("id").primaryKey(),
  parentId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  kind: lineKindEnum("kind").notNull(),
  description: text("description").notNull(),
  partId: uuid("part_id"),
  quantity: integer("quantity").notNull(),
  unitPrice_amount: numeric("unit_price_amount").notNull(),
  unitPrice_currency: text("unit_price_currency").notNull(),
}, (table) => ({
    workOrderLineWork_orderIdIdx: index("work_order_lines_work_order_id_idx").on(table.parentId),
}));

export const invoices = billingSchema.table("invoices", {
  id: uuid("id").primaryKey(),
  workOrderId: uuid("work_order_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  currency: text("currency").notNull(),
  amount: numeric("amount").notNull(),
  issued: boolean("issued").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull(),
});
