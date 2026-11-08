// The `eventing` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `eventing` message family owns (`../messages/eventing.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/match.ts (M-T9.56 drain) --------------------
  "loom.integration-repository-call": "18-testing.md#context-integration-tests",

  // --- src/ir/validate/checks/backend-syntax-checks.ts --------------------
  "loom.emit-unknown-field": "06-behavior-and-statements.md#let--emit",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.emit-field-type": "06-behavior-and-statements.md#let--emit",
  "loom.emit-field-missing": "06-behavior-and-statements.md#let--emit",
  "loom.applier-stmt-invalid":
    "06-behavior-and-statements.md#applye-event--the-event-sourcing-fold",
  "loom.applier-on-non-event-sourced":
    "06-behavior-and-statements.md#applye-event--the-event-sourcing-fold",
  "loom.correlation-type-mismatch": "13-workflows.md#one-event--the-event-reactor",
  "loom.correlation-uninferrable": "13-workflows.md#one-event--the-event-reactor",
  "loom.correlation-field-ambiguous": "13-workflows.md#workflow--state",
  "loom.channel-key-missing-field": "14-apis-storage-resources-channels.md#channel--channelsource",
  "loom.channelsource-incompatible":
    "14-apis-storage-resources-channels.md#transport-compatibility",
  "loom.relay-target-not-subscribed":
    "14-apis-storage-resources-channels.md#transport-compatibility",
};
