// The `names` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `names` message family owns (`../messages/names.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.reserved-type-name": "01-lexical-structure.md#names-the-generated-code-binds",
  "loom.reserved-derived-on-vo": "07-invariants-derived-functions.md#reserved-display-and-inspect",
  "loom.reserved-not-emitted": "14-apis-storage-resources-channels.md#connection-sources",
};
