// The `ui` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `ui` message family owns (`../messages/ui.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.component-missing-body": "15-ui-pages-structure.md#component--reusable-region-tree",
  "loom.ui-body-statement-kind": "15-ui-pages-structure.md#state--derived--action",
  "loom.ui-assign-not-state": "15-ui-pages-structure.md#state--derived--action",
  "loom.ui-find-call-arity": "15-ui-pages-structure.md#queryview--page-parameters",
  "loom.ui-body-feature-unsupported": "15-ui-pages-structure.md#state--derived--action",
  "loom.ui-page-route-collision": "15-ui-pages-structure.md#page--route-title-body",
  "loom.ui-framework-unhostable": "15-ui-pages-structure.md#ui-block--deployable-binding",

  // --- src/language/validators/ui.ts (M-T9.56 drain) -----------------------
  "loom.ui-page-duplicate": "15-ui-pages-structure.md#page--route-title-body",
  "loom.ui-menu-duplicate": "15-ui-pages-structure.md#area--menu",
  "loom.menu-link-property-unknown": "15-ui-pages-structure.md#area--menu",
  "loom.ui-api-param-duplicate": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-api-unknown": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-param-duplicate": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-function-duplicate": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-api-aggregate-unknown": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-api-operation-unknown": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.layout-name-reserved": "15-ui-pages-structure.md#layout--named-app-frames",
  "loom.layout-main-slot-missing": "15-ui-pages-structure.md#layout--named-app-frames",
  "loom.layout-slot-duplicate": "15-ui-pages-structure.md#layout--named-app-frames",

  // --- src/language/validators/deployable.ts (M-T9.56 drain) ---------------
  "loom.ui-binding-unknown-param": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-binding-duplicate": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-binding-unknown-source": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-binding-source-not-serving": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-binding-missing": "15-ui-pages-structure.md#ui-block--deployable-binding",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.ui-multi-backend-unsupported": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-aggregate-unserved": "15-ui-pages-structure.md#ui-block--deployable-binding",
  "loom.ui-read-unresolved": "16-ui-walker-primitives.md#queryview--async-data-branching",
  "loom.bindable-input-value-arg":
    "16-ui-walker-primitives.md#the-form-family--createform-operationform-workflowform-destroyform",
  "loom.component-children-unsupported": "16-ui-walker-primitives.md#slot",
  "loom.markup-primitive-in-collection-lambda":
    "16-ui-walker-primitives.md#for--list-comprehension",
  "loom.button-icon-unknown": "16-ui-walker-primitives.md#button-icons",
  "loom.ui-gate-expr-unsupported": "15-ui-pages-structure.md#page--route-title-body",
  "loom.ui-this-unbound": "15-ui-pages-structure.md#page--route-title-body",
  "loom.component-shadows-stdlib": "15-ui-pages-structure.md#component--reusable-region-tree",
};
