// The built-in endpoints a route may name (`route GET "/…" -> Ctx.Decl.<endpoint>`).
//
// A route reaches behaviour one of two ways.  Where the statement language can
// state the behaviour (create, get-by-id, the list read, destroy, an operation,
// a workflow start), the route targets a HANDLER — written by hand or emitted
// by `scaffoldHandlers` — so the behaviour is `.ddd` source.  The kinds below
// have no handler form, so the route names the declaration's built-in endpoint
// instead: an audited aggregate's history, a gated operation's `can<Op>` probe,
// a workflow's instance reads, a projection's reads, a routed abstract base's
// polymorphic reads.  One answer to "which endpoints does this declaration
// have", read by the validator and every backend; the derived route lists it
// is built from stay the single source of each endpoint's shape.

import { upperFirst } from "../../util/naming.js";
import type { BoundedContextIR } from "../types/loom-ir.js";
import { isMaterializedProjection, isSingletonProjection } from "../types/projection.js";
import type { ApiOperationIR } from "../util/api-surface.js";
import { aggServesHistory } from "../util/audit-history.js";
import { contextOperations, polymorphicReadOperations } from "./repo-polymorphic.js";
import { observableWorkflows } from "./workflow-sets.js";

/** One built-in endpoint: its name in a route target, its HTTP method, and the
 *  path parameters a route to it must bind (by name). */
export interface DeclEndpoint {
  readonly name: string;
  readonly method: "GET";
  readonly pathParams: readonly string[];
}

/** What a route target `<Context>.<decl>.<endpoint>` can reach on `decl`:
 *  `endpoints` it may name, and `handlerForm` — the names a route must reach
 *  through a handler instead (one way to say each thing).  `undefined` when
 *  the context declares nothing called `decl`. */
export interface DeclEndpoints {
  readonly kind: "aggregate" | "abstract base" | "workflow" | "projection";
  readonly endpoints: readonly DeclEndpoint[];
  readonly handlerForm: readonly string[];
}

const get = (name: string, pathParams: readonly string[] = []): DeclEndpoint => ({
  name,
  method: "GET",
  pathParams,
});

export function declEndpoints(ctx: BoundedContextIR, decl: string): DeclEndpoints | undefined {
  const agg = ctx.aggregates.find((a) => a.name === decl);
  if (agg?.isAbstract) {
    // A routed base's polymorphic reads; an unrouted base has none.
    const endpoints = polymorphicReadOperations(agg, ctx).map((op) =>
      op.kind === "getById" ? get("getById", ["id"]) : get("all"),
    );
    return { kind: "abstract base", endpoints, handlerForm: [] };
  }
  if (agg) {
    const ops = contextOperations(ctx).filter((op) => op.aggregate === agg.name);
    const endpoints: DeclEndpoint[] = [];
    if (aggServesHistory(ctx.payloads, agg)) endpoints.push(get("history", ["id"]));
    for (const op of ops) {
      if (op.kind === "gateProbe" && op.operation)
        endpoints.push(get(`can${upperFirst(op.operation.name)}`, ["id"]));
    }
    const handlerForm = ops.map(handlerFormName).filter((n): n is string => n !== undefined);
    return { kind: "aggregate", endpoints, handlerForm };
  }
  const wf = ctx.workflows.find((w) => w.name === decl);
  if (wf) {
    const observable = observableWorkflows([wf]).length > 0;
    return {
      kind: "workflow",
      endpoints: observable ? [get("instances"), get("instance", ["id"])] : [],
      handlerForm: ["start"],
    };
  }
  const proj = ctx.projections.find((p) => p.name === decl);
  if (proj) {
    const keyed = isMaterializedProjection(proj) && !isSingletonProjection(proj);
    return {
      kind: "projection",
      endpoints: keyed ? [get("read"), get("byKey", ["key"])] : [get("read")],
      handlerForm: [],
    };
  }
  return undefined;
}

/** The route-target name of an aggregate endpoint a handler serves, or
 *  undefined for one with no handler form (the gate probe) or a named find
 *  (reached through its own query handler). */
function handlerFormName(op: ApiOperationIR): string | undefined {
  switch (op.kind) {
    case "create":
    case "getById":
    case "destroy":
      return op.kind;
    case "operation":
      return op.operation?.name;
    case "find":
      return op.find?.name === "all" ? "all" : undefined;
    case "gateProbe":
      return undefined;
  }
}
