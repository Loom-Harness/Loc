// The `migration` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `migration` message family owns (`../messages/migration.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.seed-duplicate-field": "23-domain-services-and-seeds.md#seed--declarative-first-boot-data",
  "loom.seed-foreign-aggregate":
    "23-domain-services-and-seeds.md#seed--declarative-first-boot-data",
  "loom.seed-abstract-aggregate": "23-domain-services-and-seeds.md#what-a-seed-row-may-not-be",
  "loom.seed-dataset-name-collision": "23-domain-services-and-seeds.md#what-a-seed-row-may-not-be",
  "loom.seed-eventsourced-no-create": "23-domain-services-and-seeds.md#what-a-seed-row-may-not-be",
  "loom.seed-raw-eventsourced": "23-domain-services-and-seeds.md#what-a-seed-row-may-not-be",
  "loom.seed-raw-document-shape": "23-domain-services-and-seeds.md#what-a-seed-row-may-not-be",
  "loom.seed-tenant-owned-needs-raw": "23-domain-services-and-seeds.md#what-a-seed-row-may-not-be",

  // --- docs-root-relative (no language-reference chapter covers migrations) ---
  "loom.migration-destructive":
    "../migrations.md#destructive-changes--the---allow-destructive-gate",
  "loom.migration-rename-inferred":
    "../migrations.md#the-inferred-rename-announces-itself--loommigration-rename-inferred",
  "loom.migration-block-applied":
    "../migrations.md#a-spent-block-says-so--loommigration-block-applied",
  "loom.migration-sql-placement": "../migrations.md#data-migrations-m-t23",
  "loom.migration-expr-invalid": "../migrations.md#data-migrations-m-t23",
  "loom.migration-step-unknown-context":
    "../migrations.md#table-steps--renames-and-cross-context-moves",
  "loom.migration-step-target-missing":
    "../migrations.md#table-steps--renames-and-cross-context-moves",
  "loom.migration-step-ambiguous": "../migrations.md#table-steps--renames-and-cross-context-moves",
  "loom.migration-move-across-databases":
    "../migrations.md#table-steps--renames-and-cross-context-moves",
  "loom.migration-chain-invalid":
    "../migrations.md#the-migration-chain--migrations-beside-the-source",
  "loom.diff-baseline-invalid": "../mcp.md#the-loom_-tool-catalog",
  "loom.migration-name-invalid": "../mcp.md#the-loom_-tool-catalog",
  "loom.migration-unique-on-existing-table":
    "../migrations.md#a-unique-index-on-a-populated-table--loommigration-unique-on-existing-table",
  "loom.migration-enum-narrowed":
    "../migrations.md#an-enum-that-loses-a-member--loommigration-enum-narrowed",
  "loom.migration-enum-value-form": "../migrations.md#enum-value-renames--enumold---new",
  "loom.migration-enum-value-unknown": "../migrations.md#enum-value-renames--enumold---new",
  "loom.migration-enum-value-unmigrated": "../migrations.md#enum-value-renames--enumold---new",
};
