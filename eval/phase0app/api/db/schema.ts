// Auto-generated.
import { pgSchema, text, integer, boolean, uuid, index } from "drizzle-orm/pg-core";

export const projectsSchema = pgSchema("projects");


export const projects = projectsSchema.table("projects", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
});

export const tasks = projectsSchema.table("tasks", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull(),
  project: uuid("project").notNull(),
  version: integer("version").notNull(),
}, (table) => ({
    taskProjectIdx: index("tasks_project_idx").on(table.project),
}));
