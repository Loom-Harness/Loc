// The `types` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `types` message family owns (`../messages/types.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.param-default-unsupported": "06-behavior-and-statements.md#parameter-defaults",
  "loom.i18n-source-invalid": "02-systems-and-topology.md#i18n",
  "loom.i18n-duplicate": "02-systems-and-topology.md#i18n",
  "loom.collection-field-unpersisted":
    "04-type-system.md#where-a-collection-of-references-or-value-objects-can-live",

  // --- src/language/validators/_shared.ts (M-T9.56 drain) -----------------
  "loom.generic-arg-not-carrier": "04-type-system.md#generic-carriers--paged-option",
  "loom.generic-position": "04-type-system.md#generic-carriers--paged-option",
  "loom.transport-type-position": "04-type-system.md#where-a-type-form-may-appear",
  "loom.option-deprecated": "04-type-system.md#option",
  "loom.token-nullable": "04-type-system.md#options--t",
  "loom.nullable-receiver": "04-type-system.md#options--t",
  "loom.money-literal-malformed": "05-expressions.md#money-literals-vs-moneyx-conversion",
  "loom.interp-format-dropped-in-domain": "05-expressions.md#string-interpolation",
  "loom.interp-format-invalid": "05-expressions.md#string-interpolation",

  // --- src/language/validators/match.ts (M-T9.56 drain) --------------------
  "loom.matches-arity": "05-expressions.md#scalar-intrinsics",
  "loom.matches-named-arg": "05-expressions.md#scalar-intrinsics",
  "loom.matches-not-literal": "05-expressions.md#scalar-intrinsics",
  "loom.matches-invalid-regex": "05-expressions.md#scalar-intrinsics",

  // --- src/language/validators/types.ts (M-T9.56 drain) --------------------
  "loom.operator-non-bool-operands": "05-expressions.md#comparison-logical--unary",
  "loom.operator-operand-mismatch": "05-expressions.md#arithmetic--widening",
  "loom.convert-aggregate-no-display": "05-expressions.md#conversions",
  "loom.convert-non-primitive": "05-expressions.md#conversions",
  "loom.convert-pair-invalid": "05-expressions.md#conversions",
  "loom.invariant-not-bool": "07-invariants-derived-functions.md#invariant--a-checked-predicate",
  "loom.rule-name-duplicate": "07-invariants-derived-functions.md#loomrule-name-duplicate",
  "loom.rule-message-removed": "07-invariants-derived-functions.md#loomrule-message-removed",
  "loom.invariant-guard-not-bool":
    "07-invariants-derived-functions.md#when--a-conditional-invariant",
  "loom.parameter-default-type-mismatch":
    "06-behavior-and-statements.md#operation--a-mutating-method",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.precondition-not-bool":
    "06-behavior-and-statements.md#guards--requires-403-vs-when-409-vs-precondition-422",
  "loom.assign-to-derived": "06-behavior-and-statements.md#assignment-----",
  "loom.assign-type-mismatch": "06-behavior-and-statements.md#assignment-----",
  "loom.collection-mutation-non-collection": "06-behavior-and-statements.md#assignment-----",
  "loom.collection-mutation-element-type": "06-behavior-and-statements.md#assignment-----",
  "loom.let-type-mismatch": "06-behavior-and-statements.md#let--emit",
  "loom.return-type-mismatch": "06-behavior-and-statements.md#return--the-exception-less-outcome",
  "loom.return-missing": "06-behavior-and-statements.md#return--the-exception-less-outcome",
  "loom.rule-expr-impure": "07-invariants-derived-functions.md#function--a-pure-helper",
  "loom.variant-match-placement": "06-behavior-and-statements.md#match--the-statement-form",
  "loom.union-duplicate-variant": "09-payloads-and-unions.md#anonymous-union--a-or-b",
  "loom.union-read-undiscriminated":
    "09-payloads-and-unions.md#reading-a-union-in-a-body--match-first",
  "loom.union-position": "09-payloads-and-unions.md#anonymous-union--a-or-b",
  "loom.union-variant-not-carrier": "09-payloads-and-unions.md#anonymous-union--a-or-b",
  "loom.integer-literal-imprecise": "04-type-system.md#numeric-representation-rules",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.money-in-text-slot":
    "16-ui-walker-primitives.md#formatters--money-datedisplay-enumbadge-idlink-filelink-provenanceinfo-timeline",
  "loom.lambda-param-type-unknown": "15-ui-pages-structure.md#page--route-title-body",
  "loom.contain-receiver-invalid": "18-testing.md#tocontain--membership-or-substring",
  "loom.absent-receiver-invalid": "18-testing.md#absence--tobenull--tobeabsent",
};
