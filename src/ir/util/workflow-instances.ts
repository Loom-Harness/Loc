import type { IdValueType, WireField, WorkflowIR } from "../types/loom-ir.js";

/** True when the workflow exposes the two read-only instance routes
 *  (`GET /workflows/<slug>/instances` and `.../instances/{id}`).
 *
 *  Gated on `correlationField`, NOT on `instanceWireShape`: the wire shape is
 *  attached by ENRICHMENT (`enrichWorkflowInstanceShape`) from exactly this
 *  field, and the phase-④/⑦ checks that consult this predicate run against
 *  un-enriched IR — reading the enriched field there would answer "no routes"
 *  for every workflow and refuse a call the backends serve.  A stateless
 *  workflow has no correlation, so there is no instance to read; both routes
 *  are driven off the same condition on all five backends, independently of
 *  whether the workflow also has a command route. */
export function emitsInstanceRoutes(wf: WorkflowIR): boolean {
  return !!wf.correlationField;
}

/** The correlation field's wire row (`source: "id"`) on an observable
 *  workflow's `instanceWireShape` — its id targetName + value type drive the
 *  `/instances/{id}` path-param type on every backend. */
export function workflowCorrWireField(wf: WorkflowIR): WireField {
  const corr = (wf.instanceWireShape ?? []).find((f) => f.source === "id");
  if (!corr) {
    throw new Error(`workflow-instances: '${wf.name}' has no id-shaped instance field`);
  }
  return corr;
}

/** The correlation id's value type (guid/int/long/string).  The
 *  `/instances/{id}` param schema derives from this on every backend —
 *  guid → uuid-format string, int/long → integer, string → plain string —
 *  so the parity gate's path-param dimension agrees by construction
 *  (docs/old/plans/non-guid-id-http-params.md). */
export function workflowCorrIdValueType(wf: WorkflowIR): IdValueType {
  const t = workflowCorrWireField(wf).type;
  const inner = t.kind === "optional" ? t.inner : t;
  return inner.kind === "id" ? inner.valueType : "guid";
}
