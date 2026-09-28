// Auto-generated.
import { pgSchema, text, integer, numeric, timestamp, pgEnum, uuid, index, jsonb } from "drizzle-orm/pg-core";

export const fieldSchema = pgSchema("field");

export const workOrderStatusEnum = pgEnum("work_order_status", ["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]);
export const priorityEnum = pgEnum("priority", ["Low", "Normal", "High", "Urgent"]);
export const skillEnum = pgEnum("skill", ["Electrical", "Plumbing", "HVAC", "Refrigeration"]);

export const organizations = fieldSchema.table("organizations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
});

export const customers = fieldSchema.table("customers", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  contactEmail: text("contact_email").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull(),
});

export const sites = fieldSchema.table("sites", {
  id: uuid("id").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  label: text("label").notNull(),
  addressLine: text("address_line").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const assets = fieldSchema.table("assets", {
  id: uuid("id").primaryKey(),
  siteId: uuid("site_id").notNull(),
  serialNumber: text("serial_number").notNull(),
  model: text("model").notNull(),
  warrantyExpiry: timestamp("warranty_expiry", { withTimezone: true }),
  requiredSkill: skillEnum("required_skill").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const technicians = fieldSchema.table("technicians", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  fullName: text("full_name").notNull(),
  skills: skillEnum("skills").array().notNull(),
  costRate: numeric("cost_rate", { precision: 19, scale: 4 }).notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const parts = fieldSchema.table("parts", {
  id: uuid("id").primaryKey(),
  sku: text("sku").notNull(),
  binCode: text("bin_code").notNull(),
  onHand: integer("on_hand").notNull(),
  unitPrice: numeric("unit_price", { precision: 19, scale: 4 }).notNull(),
  currency: text("currency").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  version: integer("version").notNull(),
});

export const workOrders = fieldSchema.table("work_orders", {
  id: uuid("id").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  siteId: uuid("site_id").notNull(),
  assetId: uuid("asset_id"),
  technicianId: uuid("technician_id"),
  technicianUserId: uuid("technician_user_id"),
  status: workOrderStatusEnum("status").notNull(),
  priority: priorityEnum("priority").notNull(),
  currency: text("currency").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  photo: jsonb("photo"),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull(),
});

export const workOrderLines = fieldSchema.table("work_order_lines", {
  id: uuid("id").primaryKey(),
  parentId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 19, scale: 4 }).notNull(),
  currency: text("currency").notNull(),
}, (table) => ({
    workOrderLineWork_orderIdIdx: index("work_order_lines_work_order_id_idx").on(table.parentId),
}));

export const invoices = fieldSchema.table("invoices", {
  id: uuid("id").primaryKey(),
  workOrderId: uuid("work_order_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  currency: text("currency").notNull(),
  tenantId: text("tenant_id").notNull(),
  dataKey: text("data_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull(),
});

export const openByStatuses = fieldSchema.table("open_by_statuses", {
  status: workOrderStatusEnum("status"),
  howMany: integer("how_many"),
});

export const revenueThisMonths = fieldSchema.table("revenue_this_months", {
  revenue: numeric("revenue", { precision: 19, scale: 4 }),
});
