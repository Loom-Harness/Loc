CREATE SCHEMA IF NOT EXISTS "projects";
CREATE TABLE "projects"."tasks" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  CONSTRAINT "tasks_status_enum" CHECK ("status" IN ('Draft', 'Done'))
);
