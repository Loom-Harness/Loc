// The `system` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `system` message family owns (`../messages/system.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/ddd-validator.ts (M-T9.56 drain) ----------------------
  "loom.api-unknown-subdomain": "14-apis-storage-resources-channels.md#api",

  // --- src/language/validators/structural.ts (M-T9.56 drain) --------------
  "loom.hosted-type-name-collision": "03-domain-modeling.md#aggregate",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.resource-op-in-transaction": "13-workflows.md#resource-consumption",
  "loom.resource-verb-invalid": "13-workflows.md#resource-consumption",

  // --- src/language/validators/deployable.ts (M-T9.56 drain) ---------------
  "loom.targets-misplaced": "02-systems-and-topology.md#frontend-platforms--targets",
  "loom.platform-unknown": "02-systems-and-topology.md#deployable",
  "loom.platform-version-unknown": "02-systems-and-topology.md#backend-platforms",

  // --- src/language/validators/datasource.ts (M-T9.56 drain) --------------
  "loom.resource-kind-storage-mismatch":
    "14-apis-storage-resources-channels.md#the-kind--storage-matrix",
  "loom.resource-knob-kind-mismatch":
    "14-apis-storage-resources-channels.md#the-knobs-and-their-guards",
  "loom.resource-knob-storage-mismatch":
    "14-apis-storage-resources-channels.md#the-knobs-and-their-guards",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.datasource-context-unlisted": "14-apis-storage-resources-channels.md#resource",
  "loom.datasource-duplicate": "14-apis-storage-resources-channels.md#resource",
  "loom.serves-on-frontend":
    "14-apis-storage-resources-channels.md#serves-and-the-openapi-document",
  "loom.serves-unknown-api":
    "14-apis-storage-resources-channels.md#serves-and-the-openapi-document",
  "loom.serves-duplicate-api":
    "14-apis-storage-resources-channels.md#serves-and-the-openapi-document",
  "loom.api-unserved": "14-apis-storage-resources-channels.md#serves-and-the-openapi-document",
};
