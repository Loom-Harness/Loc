CREATE SCHEMA IF NOT EXISTS "orgs";
CREATE TABLE "orgs"."organizations" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "parent" UUID NULL,
  "data_key" TEXT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("parent") REFERENCES "orgs"."organizations" ON DELETE RESTRICT
);
CREATE INDEX "organizations_parent_idx" ON "orgs"."organizations" ("parent");
