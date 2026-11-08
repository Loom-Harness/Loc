// The `frontends` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `frontends` message family owns (`../messages/frontends.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.angular-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.feliz-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.flutter-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.flutter-action-statement-unsupported": "15-ui-pages-structure.md#state--derived--action",
  "loom.flutter-action-body-unsupported": "15-ui-pages-structure.md#state--derived--action",
  "loom.heex-handler-name-collision": "15-ui-pages-structure.md#state--derived--action",
  "loom.heex-stateful-component-reused": "15-ui-pages-structure.md#component--reusable-region-tree",
  "loom.frontend-prop-type-unsupported": "15-ui-pages-structure.md#component--reusable-region-tree",
  "loom.react-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.svelte-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",

  // --- src/language/validators/deployable.ts (M-T9.56 drain) ---------------
  "loom.static-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.frontend-targets-missing": "02-systems-and-topology.md#frontend-platforms--targets",
  "loom.frontend-targets-invalid": "02-systems-and-topology.md#frontend-platforms--targets",
  "loom.frontend-contexts-ignored": "02-systems-and-topology.md#frontend-platforms--targets",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.vue-deployable-missing-ui": "15-ui-pages-structure.md#ui-block--deployable-binding",
};
