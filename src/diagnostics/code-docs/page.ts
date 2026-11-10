// The `page` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `page` message family owns (`../messages/page.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.store-init-not-constant":
    "15-ui-pages-structure.md#store--shared-client-state-with-a-lifetime",
  "loom.action-out-of-position": "15-ui-pages-structure.md#state--derived--action",

  // --- src/language/validators/ui.ts (M-T9.56 drain) -----------------------
  "loom.theme-property-unknown": "02-systems-and-topology.md#theme",
  "loom.theme-property-duplicate": "02-systems-and-topology.md#theme",
  "loom.theme-color-invalid": "02-systems-and-topology.md#theme",
  "loom.theme-radius-invalid": "02-systems-and-topology.md#theme",
  "loom.theme-color-scheme-invalid": "02-systems-and-topology.md#theme",
  "loom.page-property-duplicate": "15-ui-pages-structure.md#page--route-title-body",
  "loom.page-menu-key-unknown": "15-ui-pages-structure.md#area--menu",
  "loom.page-layout-unknown": "15-ui-pages-structure.md#layout--named-app-frames",

  // --- src/language/validators/deployable.ts (M-T9.56 drain) ---------------
  "loom.design-pack-ignored": "02-systems-and-topology.md#design-packs",
  "loom.design-theme-unknown": "02-systems-and-topology.md#design-packs",
  "loom.design-pack-custom-unchecked": "02-systems-and-topology.md#design-packs",
  "loom.design-pack-invalid": "../design-packs.md#2-the-packjson-manifest",
  "loom.design-pack-retired": "02-systems-and-topology.md#design-packs",
  "loom.design-pack-version-unknown": "02-systems-and-topology.md#design-packs",
  "loom.design-pack-format-mismatch": "02-systems-and-topology.md#design-packs",
  "loom.model-text-unresolved": "02-systems-and-topology.md#model-text-label-and-plural",
  "loom.model-text-implicit-ambiguous": "02-systems-and-topology.md#model-text-label-and-plural",
  "loom.model-text-plural-member": "02-systems-and-topology.md#model-text-label-and-plural",
  "loom.model-text-outside-ui": "02-systems-and-topology.md#model-text-label-and-plural",
  "loom.model-text-in-template": "02-systems-and-topology.md#model-text-label-and-plural",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.chart-accessor-not-field":
    "16-ui-walker-primitives.md#chart--grouped-projection-series-every-frontend",
  "loom.chart-of-not-grouped":
    "16-ui-walker-primitives.md#chart--grouped-projection-series-every-frontend",
  "loom.page-form-locals-unsupported":
    "16-ui-walker-primitives.md#the-form-family--createform-operationform-workflowform-destroyform",
  "loom.destroy-form-of-unresolved":
    "16-ui-walker-primitives.md#the-form-family--createform-operationform-workflowform-destroyform",
  // The body-walker give-up codes (M-T9.55).  The first four are argument /
  // reference / expression refusals — the chapter's own gate section lists the
  // sibling `loom.page-primitive-*` codes — and the fifth is a porting gap, so
  // it anchors on the per-target table instead.
  "loom.page-primitive-arg-missing":
    "16-ui-walker-primitives.md#arity-argument-and-placement-gates",
  "loom.page-primitive-arg-invalid":
    "16-ui-walker-primitives.md#arity-argument-and-placement-gates",
  "loom.page-ref-unreachable": "16-ui-walker-primitives.md#arity-argument-and-placement-gates",
  "loom.page-expr-unrenderable": "16-ui-walker-primitives.md#the-dispatch-model",
  // The VALUE twin of `loom.page-primitive-unknown-arg`, which anchors on the
  // gate section above.  This one gets its own subsection, because the
  // vocabulary it enforces is the part a reader needs.
  "loom.page-primitive-unknown-arg-value":
    "16-ui-walker-primitives.md#closed-vocabulary-argument-values",
  "loom.page-primitive-target-gap": "16-ui-walker-primitives.md#per-target-honest-gates",
  "loom.page-gate-not-client-evaluable": "17-auth.md#requires--the-authorization-gate-http-403",
};
