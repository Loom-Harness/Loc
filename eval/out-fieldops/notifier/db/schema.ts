// Auto-generated.
import { pgSchema, integer, timestamp, uuid } from "drizzle-orm/pg-core";

export const notificationsSchema = pgSchema("notifications");


export const notificationLogs = notificationsSchema.table("notification_logs", {
  id: uuid("id").primaryKey(),
  workOrderId: uuid("work_order_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  version: integer("version").notNull(),
});

export const recordCompletions = notificationsSchema.table("record_completions", {
  workOrderId: uuid("work_order_id").primaryKey(),
});
