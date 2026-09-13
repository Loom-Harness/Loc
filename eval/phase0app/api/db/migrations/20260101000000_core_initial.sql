CREATE SCHEMA IF NOT EXISTS "projects";
CREATE TABLE "projects"."projects" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "projects";
CREATE TABLE "projects"."tasks" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL,
  "project" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("project") REFERENCES "projects"."projects" ON DELETE RESTRICT
);
CREATE INDEX "tasks_project_idx" ON "projects"."tasks" ("project");
