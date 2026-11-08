// The `workflow` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `workflow` message family owns (`../messages/workflow.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.workflow-load-array-unsupported": "13-workflows.md#body-vocabulary",
  "loom.workflow-cross-context-repository": "13-workflows.md#body-vocabulary",
  "loom.workflow-private-operation": "13-workflows.md#body-vocabulary",
  "loom.workflow-unrecognised-statement": "13-workflows.md#body-vocabulary",
  "loom.workflow-inline-repository-call": "13-workflows.md#body-vocabulary",
  "loom.workflow-return-no-caller": "13-workflows.md#returning-a-result",
  "loom.workflow-return-not-last": "13-workflows.md#returning-a-result",
  "loom.workflow-return-untyped": "13-workflows.md#returning-a-result",
  "loom.workflow-return-missing": "13-workflows.md#returning-a-result",
  "loom.workflow-return-type-mismatch": "13-workflows.md#returning-a-result",
  "loom.workflow-return-type-unsupported": "13-workflows.md#returning-a-result",
  "loom.workflow-return-event-sourced": "13-workflows.md#returning-a-result",
  "loom.workflow-return-this-uncorrelated": "13-workflows.md#returning-a-result",
  "loom.canonical-create-duplicate-workflow": "13-workflows.md#create--starters",
  "loom.workflow-param-unused": "13-workflows.md#create--starters",
  "loom.workflow-applier-on-non-event-sourced": "13-workflows.md#create--starters",
  // M-T5.34.  The missing-starter ruling documents against the reactor section
  // (that is the member whose behaviour is inert without a starter); the
  // command-side correlation ruling belongs to the
  // starters section that declares that member.
  "loom.reactor-without-starter": "13-workflows.md#one-event--the-event-reactor",
  "loom.isolation-requires-transactional": "13-workflows.md#transactional--isolation",
  "loom.transactional-no-effect": "13-workflows.md#transactional--isolation",
  "loom.workflow-correlation-required": "13-workflows.md#workflow--state",
  "loom.workflow-create-correlation-unsupplied": "13-workflows.md#workflow--state",
  "loom.workflow-uncorrelated-state-write": "13-workflows.md#workflow--state",
  "loom.workflow-explicit-save": "13-workflows.md#body-vocabulary",
  "loom.workflow-uncorrelated-state-read": "13-workflows.md#workflow--state",
  "loom.workflow-mutation-unsaved": "13-workflows.md#body-vocabulary",
  "loom.workflow-mutation-result-unmatched": "13-workflows.md#matching-a-mutating-calls-result",
  "loom.effect-in-lambda": "15-ui-pages-structure.md#state--derived--action",

  // --- src/language/validators/traceability.ts (M-T9.56 drain) ------------
  // Ruling D1 — reactors run as the system principal.
  "loom.reactor-gate-unsatisfiable":
    "17-auth.md#reactors--the-system-principal-currentuserissystem",
  "loom.timer-tenant-read": "17-auth.md#reactors--the-system-principal-currentuserissystem",
  // The target-agnostic `match await` subject gate (audit F66) — the reference
  // section that spells the one supported shape.
  "loom.async-effect-subject-unsupported":
    "15-ui-pages-structure.md#effect-markers-and-match-await",
};
