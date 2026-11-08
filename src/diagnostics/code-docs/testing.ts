// The `testing` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `testing` message family owns (`../messages/testing.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/match.ts (M-T9.56 drain) --------------------
  "loom.matcher-arity": "18-testing.md#matchers--the-expectactualmatcher-vocabulary",
  "loom.expect-requires-matcher": "18-testing.md#matchers--the-expectactualmatcher-vocabulary",
  "loom.matcher-e2e-only": "18-testing.md#matchers--the-expectactualmatcher-vocabulary",
  "loom.tothrow-arity": "18-testing.md#tothrow--the-throw-assertion",
  "loom.not-throw-invalid": "18-testing.md#tothrow--the-throw-assertion",
  "loom.tothrow-status-not-int": "18-testing.md#tothrow--the-throw-assertion",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.not-found-placement": "06-behavior-and-statements.md#notfound--the-not-found-answer",
  "loom.not-found-unreachable": "06-behavior-and-statements.md#notfound--the-not-found-answer",
  "loom.context-filter-no-principal":
    "11-capabilities-filters-stamps.md#filter-expr--a-predicate-and-ed-into-every-read",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.requirement-property-unknown": "19-requirements-traceability.md#requirement",
  "loom.requirement-property-duplicate": "19-requirements-traceability.md#requirement",
  "loom.requirement-property-missing": "19-requirements-traceability.md#requirement",
  "loom.requirement-type-invalid": "19-requirements-traceability.md#requirement",
  "loom.requirement-status-invalid": "19-requirements-traceability.md#requirement",
  "loom.requirement-title-not-string": "19-requirements-traceability.md#requirement",
  "loom.requirement-priority-not-int": "19-requirements-traceability.md#requirement",
  "loom.requirement-parent-cycle": "19-requirements-traceability.md#relations-summary",
  "loom.test-statement-invalid": "18-testing.md#test---an-in-process-unit-test",
  "loom.test-redundant-for": "18-testing.md#test---an-in-process-unit-test",
  "loom.e2e-unsupported-statement":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-unrouted-verb": "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-call-options": "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-routed-handler-arity":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-unknown-body-key": "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-unknown-query-key":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-projection-read-arity":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-missing-required-field":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-body-type-mismatch":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-unknown-response-field":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.locator-matcher-receiver":
    "18-testing.md#test-e2e--against-deployable--a-live-end-to-end-test",
  "loom.e2e-ui-throw-invalid": "18-testing.md#tothrow--the-throw-assertion",
  "loom.e2e-throw-kind-invalid": "18-testing.md#tothrow--the-throw-assertion",
  "loom.unit-absent-invalid": "18-testing.md#absence--tobenull--tobeabsent",
  "loom.e2e-ui-absence-invalid": "18-testing.md#absence--tobenull--tobeabsent",
};
