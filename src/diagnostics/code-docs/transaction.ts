// The `transaction` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `transaction` message family owns (`../messages/transaction.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.isolation-requires-transactional": "13-workflows.md#transactional--isolation",
  "loom.transactional-no-effect": "13-workflows.md#transactional--isolation",
  "loom.effect-in-query": "../resources.md#resource-calls-inside-a-transaction",
  "loom.effect-in-transaction": "../resources.md#resource-calls-inside-a-transaction",
  "loom.effect-in-lambda": "15-ui-pages-structure.md#state--derived--action",
};
