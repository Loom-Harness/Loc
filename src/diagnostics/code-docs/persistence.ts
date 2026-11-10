// The `persistence` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `persistence` message family owns (`../messages/persistence.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.repo-verb-renamed": "10-repositories-and-queries.md#the-repository-verbs",
  "loom.repo-get-criterion": "10-repositories-and-queries.md#the-repository-verbs",
  "loom.repo-find-retrieval": "10-repositories-and-queries.md#the-repository-verbs",
  "loom.repo-all-arg": "10-repositories-and-queries.md#the-repository-verbs",
  "loom.repo-sort-placement": "10-repositories-and-queries.md#sorting-an-all-over-a-criterion",
  "loom.repo-unknown-read": "10-repositories-and-queries.md#repository--the-read-contract",
  "loom.repo-key-not-unique": "10-repositories-and-queries.md#natural-key-reads--getby--findby",
  "loom.repo-key-incomplete": "10-repositories-and-queries.md#natural-key-reads--getby--findby",
  "loom.repository-access-outside-workflow":
    "06-behavior-and-statements.md#operation--a-mutating-method",
  "loom.criterion-impure": "10-repositories-and-queries.md#criterion",
  "loom.criterion-retrieval-name-clash": "10-repositories-and-queries.md#retrieval",
  "loom.persisted-table-collision": "13-workflows.md#13-workflows",
  "loom.find-where-column-column": "10-repositories-and-queries.md#the-queryable-subset",
  "loom.exists-outside-query":
    "10-repositories-and-queries.md#exists--quantifying-over-another-aggregate",
  "loom.exists-cross-context":
    "10-repositories-and-queries.md#exists--quantifying-over-another-aggregate",
  "loom.exists-unsupported":
    "10-repositories-and-queries.md#exists--quantifying-over-another-aggregate",
  "loom.find-where-not-queryable": "10-repositories-and-queries.md#the-queryable-subset",
  "loom.find-where-unknown-field": "10-repositories-and-queries.md#the-queryable-subset",
  "loom.retrieval-where-not-queryable": "10-repositories-and-queries.md#the-queryable-subset",

  // --- docs-root-relative (no language-reference chapter covers migrations) ---
  "loom.unique-tpc-not-hierarchy-wide":
    "../inheritance.md#unique-keys-on-a-tpc-base--loomunique-tpc-not-hierarchy-wide",
  "loom.repository-unknown": "10-repositories-and-queries.md#the-repository-verbs",
};
