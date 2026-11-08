// The `behavior` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `behavior` message family owns (`../messages/behavior.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.callable-modifier-not-allowed-here":
    "06-behavior-and-statements.md#the-callable-modifier-surface",

  // --- src/language/validators/_shared.ts (M-T9.56 drain) -----------------
  "loom.bare-aggregate-in-type": "04-type-system.md#x-id--cross-aggregate-references",

  // --- src/language/validators/match.ts (M-T9.56 drain) --------------------
  "loom.match-empty": "05-expressions.md#ternary--match",
  "loom.match-no-else": "05-expressions.md#ternary--match",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.when-not-bool":
    "06-behavior-and-statements.md#guards--requires-403-vs-when-409-vs-precondition-422",
  "loom.loop-gate-not-implied":
    "06-behavior-and-statements.md#a-loop-over-a-read-that-the-gate-does-not-cover",
  "loom.when-private-operation":
    "06-behavior-and-statements.md#guards--requires-403-vs-when-409-vs-precondition-422",
  "loom.operation-self-call": "06-behavior-and-statements.md#operation--a-mutating-method",
  "loom.bare-statement-invalid": "06-behavior-and-statements.md#assignment-----",
  "loom.handler-return-not-last":
    "06-behavior-and-statements.md#return--the-exception-less-outcome",
  "loom.unhandled-result": "06-behavior-and-statements.md#return--the-exception-less-outcome",
  "loom.function-return-type-mismatch":
    "07-invariants-derived-functions.md#function--a-pure-helper",
  "loom.function-block-impure": "07-invariants-derived-functions.md#function--a-pure-helper",
  "loom.when-references-op-param":
    "06-behavior-and-statements.md#when-also-auto-exposes-get-idcan_op",
  "loom.for-placement": "06-behavior-and-statements.md#for--if-let--workflow-bodies-only",
  "loom.if-let-placement": "06-behavior-and-statements.md#for--if-let--workflow-bodies-only",
  "loom.unmapped-error-status":
    "09-payloads-and-unions.md#error--httpstatus--exception-less-problemdetails",
  "loom.ignoring-clause-placement":
    "10-repositories-and-queries.md#ignoring--capability-filter-bypass",
  "loom.handler-unknown-name":
    "06-behavior-and-statements.md#handler-bodies--commandhandler--queryhandler",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.throw-kind-outside-tothrow": "18-testing.md#tothrow--the-throw-assertion",
  "loom.throw-kind-integration-unsupported": "18-testing.md#tothrow--the-throw-assertion",
  "loom.extern-component-has-body": "21-externs.md#extern-component",
  "loom.extern-function-shadows-stdlib": "21-externs.md#extern-function",
  "loom.domain-service-no-emit":
    "23-domain-services-and-seeds.md#the-no-infra-contract-phase-⑦-ir-validator",
  "loom.domain-service-no-mutation":
    "23-domain-services-and-seeds.md#the-no-infra-contract-phase-⑦-ir-validator",
  "loom.domain-service-no-workflow-start":
    "23-domain-services-and-seeds.md#the-no-infra-contract-phase-⑦-ir-validator",
  "loom.domain-service-single-aggregate":
    "23-domain-services-and-seeds.md#the-no-infra-contract-phase-⑦-ir-validator",
};
