// Auto-generated.
import { pgSchema, text, integer, uuid } from "drizzle-orm/pg-core";

export const projectsSchema = pgSchema("projects");

export const statusValues = ["Draft", "Done"] as const;

export const tasks = projectsSchema.table("tasks", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", { enum: statusValues }).notNull(),
  version: integer("version").notNull(),
});
