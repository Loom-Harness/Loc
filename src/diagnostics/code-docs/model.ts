// The `model` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `model` message family owns (`../messages/model.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.unconstructible-server-field":
    "03-domain-modeling.md#a-server-owned-field-must-have-a-value",
  "loom.containment-cycle": "03-domain-modeling.md#entity-parts--contains",

  // --- src/language/validators/structural.ts (M-T9.56 drain) --------------
  "loom.member-name-collision": "03-domain-modeling.md#aggregate",
  "loom.valueobject-contains-entity": "03-domain-modeling.md#valueobject",
  "loom.containment-optional-collection": "03-domain-modeling.md#entity-parts--contains",
  "loom.containment-foreign-part": "04-type-system.md#x-id--cross-aggregate-references",

  // --- src/language/validators/_shared.ts (M-T9.56 drain) -----------------
  "loom.aggregate-not-constructible": "03-domain-modeling.md#aggregate",
  "loom.entity-field-modifier": "03-domain-modeling.md#entity-parts--contains",
  "loom.provenanced-part-field": "20-observability-provenance.md#provenanced-fields",
  "loom.entity-part-param-unsupported": "03-domain-modeling.md#entity-parts--contains",
  "loom.update-gate-suggestion": "03-domain-modeling.md#access-modifiers",
  "loom.crudish-hard-delete":
    "../scaffold-macros.md#crudish-delete-under-softdeletable--loomcrudish-hard-delete",
  "loom.entity-field-optional-collection": "04-type-system.md#collections--t",
  "loom.id-target-not-identity": "04-type-system.md#x-id--cross-aggregate-references",

  // --- src/language/validators/types.ts (M-T9.56 drain) --------------------
  "loom.property-check-not-bool":
    "07-invariants-derived-functions.md#invariant--a-checked-predicate",
  "loom.derived-type-mismatch":
    "07-invariants-derived-functions.md#derived--a-computed-read-only-field",
  "loom.property-default-type-mismatch": "03-domain-modeling.md#fields-property",
  "loom.dunder-field-name": "03-domain-modeling.md#field-names-a-generated-runtime-reserves",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.member-not-callable": "05-expressions.md#member-access--calls",
  "loom.create-call-not-constructible":
    "06-behavior-and-statements.md#create--destroy--lifecycle-actions",
  "loom.create-call-missing-field":
    "06-behavior-and-statements.md#create--destroy--lifecycle-actions",
  "loom.reserved-derived-on-vo": "07-invariants-derived-functions.md#reserved-display-and-inspect",
  "loom.abstract-aggregate-behavior":
    "08-inheritance-and-polymorphism.md#abstract-aggregate--the-base",
  "loom.abstract-repository": "08-inheritance-and-polymorphism.md#abstract-aggregate--the-base",
  "loom.polymorphic-read-unrouted":
    "08-inheritance-and-polymorphism.md#find-all-base--the-polymorphic-reader",
  "loom.polymorphic-id-ref-unsupported":
    "08-inheritance-and-polymorphism.md#base-id-references--tph-only",
  "loom.extends-non-abstract": "08-inheritance-and-polymorphism.md#extends--a-concrete-subtype",
  "loom.extends-self": "08-inheritance-and-polymorphism.md#extends--a-concrete-subtype",
  "loom.es-tph-forced-own-table":
    "08-inheritance-and-polymorphism.md#inheritanceusing---the-storage-strategy",
  "loom.inheritance-modifier-misplaced":
    "08-inheritance-and-polymorphism.md#inheritanceusing---the-storage-strategy",
  "loom.self-outside-capability":
    "11-capabilities-filters-stamps.md#self-id--self-reference-inside-a-capability",
  "loom.stamp-reads-aggregate-unsupported":
    "11-capabilities-filters-stamps.md#validator-gated-stamp-cases",
  "loom.create-field-id-target": "04-type-system.md#x-id--cross-aggregate-references",
  "loom.create-name-conflict-workflow": "13-workflows.md#create--starters",
  "loom.create-args": "06-behavior-and-statements.md#create--destroy--lifecycle-actions",
  "loom.create-record-form": "06-behavior-and-statements.md#create--destroy--lifecycle-actions",
  "loom.reserved-not-emitted": "14-apis-storage-resources-channels.md#connection-sources",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  "loom.valueobject-in-text-slot":
    "16-ui-walker-primitives.md#a-text-slot-renders-a-scalar-not-a-value-object",
  "loom.create-param-not-a-field":
    "06-behavior-and-statements.md#create--destroy--lifecycle-actions",
  "loom.create-param-required-omitted":
    "06-behavior-and-statements.md#create--destroy--lifecycle-actions",
  "loom.aggregate-test-context": "18-testing.md#test---an-in-process-unit-test",
  "loom.member-unresolved": "05-expressions.md#member-access--calls",
};
