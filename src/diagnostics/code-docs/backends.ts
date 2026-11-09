// The `backends` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `backends` message family owns (`../messages/backends.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/types.ts (M-T9.56 drain) --------------------
  "loom.elixir-part-timestamp-field":
    "03-domain-modeling.md#field-names-a-generated-runtime-reserves",

  // --- src/ir/validate/checks/backend-syntax-checks.ts --------------------
  "loom.elixir-invariant-unenforced":
    "07-invariants-derived-functions.md#elixir-enforced-or-reported",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.elixir-match-stmt-unsupported": "06-behavior-and-statements.md#match--the-statement-form",
  "loom.vanilla-op-call-actor": "06-behavior-and-statements.md#operation--a-mutating-method",
  "loom.elixir-bound-mutating-call-unsupported": "13-workflows.md#matching-a-mutating-calls-result",
  "loom.elixir-entry-result-unsupported": "13-workflows.md#expected-failures",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.target-unsupported": "16-ui-walker-primitives.md#per-target-honest-gates",

  // --- src/ir/validate/checks/orm-adapter-checks.ts -----------------------
  "loom.mikroorm-shared-database": "02-systems-and-topology.md#the-composed-stack",
  "loom.dapper-shared-database": "02-systems-and-topology.md#the-composed-stack",
};
