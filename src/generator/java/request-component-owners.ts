// Java's request-component owner set — ONE derivation, two consumers.
//
// Both `buildJavaOpenApiContract` (which builds the `RequiredSet` patch table,
// keyed by published schema name) and `emitProjectFromContexts` (which emits the
// records those names describe) need the same collision resolution. They each
// already hold the deployable's `contexts`, so each could derive it — and that is
// exactly the two-halves-of-one-contract shape F-026 is about
// (`experience_gathered.md` §89). So the derivation lives here once and both
// import it; a single function cannot disagree with itself.
//
// Scope is the whole DEPLOYABLE, not one context: springdoc names a schema after
// the short class name, so the namespace the collision lives in is the published
// document, which spans every hosted context.
//
// The create gate is this backend's own: java emits `Create<Agg>Request` only
// when `emitsRestCreate(agg)` holds (`emit/dto.ts`), so listing it otherwise
// would invent a collision and qualify a workflow that never clashed. Phoenix
// emits its create schema unconditionally and therefore lists it unconditionally
// — the same contract ("the owners this backend publishes"), a different answer.

import { emitsRestCreate } from "../../ir/enrich/wire-projection.js";
import type { EnrichedBoundedContextIR } from "../../ir/types/loom-ir.js";
import { emitsCommandRoute } from "../../ir/util/workflow-command-route.js";
import type { RequestComponentOwner } from "../_openapi/request-component-names.js";

/** Every request component the java backend publishes for one deployable. */
export function javaRequestComponentOwners(
  contexts: readonly EnrichedBoundedContextIR[],
): RequestComponentOwner[] {
  const owners: RequestComponentOwner[] = [];
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      if (emitsRestCreate(agg)) owners.push({ kind: "create", aggregate: agg.name });
      for (const op of agg.operations) {
        if (op.visibility !== "public") continue;
        owners.push({ kind: "operation", aggregate: agg.name, operation: op.name });
      }
    }
    for (const wf of ctx.workflows) {
      if (!emitsCommandRoute(wf)) continue;
      owners.push({ kind: "workflow", workflow: wf.name });
    }
  }
  return owners;
}
