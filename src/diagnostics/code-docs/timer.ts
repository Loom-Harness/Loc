// The `timer` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `timer` message family owns (`../messages/timer.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.timer-tenant-read": "17-auth.md#reactors--the-system-principal-currentuserissystem",
};
