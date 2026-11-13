// The `projection` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `projection` message family owns (`../messages/projection.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/_shared.ts (M-T9.56 drain) -----------------
  "loom.paged-envelope-unknown-member": "04-type-system.md#paged",
  "loom.envelope-removed": "04-type-system.md#envelope-removed",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.paged-param-reserved": "10-repositories-and-queries.md#return-shapes",
  "loom.paged-query-handler-shape":
    "10-repositories-and-queries.md#repoall--the-paged-queryhandler",
  "loom.projection-key-assign": "10-repositories-and-queries.md#folded--keyed-by--one-event",
  "loom.projection-accumulate-optional":
    "10-repositories-and-queries.md#folded--keyed-by--one-event",
  "loom.projection-select-duration": "04-type-system.md#duration--expression-only",
  "loom.projection-aggregate-arg-not-columnar": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-aggregate-arity":
    "10-repositories-and-queries.md#whole-table-aggregation--the-singleton",
  "loom.projection-aggregate-type-mismatch": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-join-invalid": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-key-not-columnar": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-keyed-invalid": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-missing": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-no-aggregate": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-select-not-grouped": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-groupby-source-invalid": "10-repositories-and-queries.md#grouped--group-by",
  "loom.projection-fields-without-select":
    "10-repositories-and-queries.md#shorthand--the-select-less-form",
  "loom.projection-shorthand-nonaggregate":
    "10-repositories-and-queries.md#shorthand--the-select-less-form",
  "loom.projection-columnless-source":
    "10-repositories-and-queries.md#the-source-has-to-have-columns",
  "loom.projection-document-source-capability-filtered":
    "10-repositories-and-queries.md#the-source-has-to-have-columns",
  "loom.projection-cross-context-source-unsupported":
    "10-repositories-and-queries.md#a-source-in-another-context",
};
