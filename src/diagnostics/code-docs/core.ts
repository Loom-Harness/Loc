// The `core` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `core` message family owns (`../messages/core.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.multiple-systems": "02-systems-and-topology.md#system",
  "loom.duplicate-theme-block": "02-systems-and-topology.md#theme",
  "loom.ambiguous-enum-value": "03-domain-modeling.md#bare-values-across-two-enums",

  // --- src/language/ddd-validator.ts (M-T9.56 drain) ----------------------
  "loom.duplicate-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.duplicate-api": "14-apis-storage-resources-channels.md#api",
  "loom.duplicate-storage": "14-apis-storage-resources-channels.md#storage",
  "loom.duplicate-resource": "14-apis-storage-resources-channels.md#resource",

  // --- src/language/validators/structural.ts (M-T9.56 drain) --------------
  "loom.scaffold-aggregate-unserved": "22-macros.md#scaffold-family--application--transport",
  "loom.macro-synthesised": "22-macros.md#errors-inside-synthesised-code",
  "loom.duplicate-entity-part": "03-domain-modeling.md#entity-parts--contains",
  "loom.duplicate-derived": "07-invariants-derived-functions.md#reserved-display-and-inspect",

  // --- src/ir/validate/checks/backend-syntax-checks.ts --------------------
  "loom.unknown-name": "05-expressions.md#member-access--calls",
  "loom.unknown-user-claim": "05-expressions.md#member-access--calls",
  "loom.unknown-primitive-member": "05-expressions.md#member-access--calls",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.unresolved-call": "06-behavior-and-statements.md#operation--a-mutating-method",
  "loom.unresolved-member": "05-expressions.md#member-access--calls",
  "loom.unresolved-lvalue-head": "06-behavior-and-statements.md#assignment-----",
  "loom.unresolved-type": "04-type-system.md#every-value-has-a-type",
  "loom.duplicate-repository": "10-repositories-and-queries.md#repository--the-read-contract",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.duplicate-permission": "17-auth.md#permissions--a-typed-catalogue-with-implies",
  "loom.unknown-permission": "17-auth.md#permissions--a-typed-catalogue-with-implies",
  "loom.duplicate-user-block": "17-auth.md#user--the-principal-claim-shape",
};
