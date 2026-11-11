// The resource calls a body makes: the raw-verb resource ops
// (`files.put(k, v)`) and the typed in-system api calls (`orders.getOrder(id)`).
// Every backend imports a helper per call it renders, so the set must be found
// at any depth — a call nested in an `if let` branch, a `for` body, or inside
// another expression.  A collector that read only the statement forms
// (`files.put(…)` as a statement, or the right side of a `let`) dropped the
// import of a nested call, and the generated project failed to compile.

import type { ExprIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkExprDeep, walkWorkflowStmtExprsDeep } from "../util/walk.js";

type CallOf<K extends string> = Extract<ExprIR, { kind: "call"; callKind: K }>;
export type ResourceOpRef = CallOf<"resource-op">["resourceOp"];
export type RemoteApiOpRef = CallOf<"remote-api-op">["remoteApiOp"];

export interface ResourceCalls {
  /** Every raw-verb resource op, in source order (repeats kept). */
  resourceOps: ResourceOpRef[];
  /** Every typed in-system api call, in source order (repeats kept). */
  remoteApiOps: RemoteApiOpRef[];
}

/** Every resource call in `statements` (and in `extra` expressions, such as a
 *  handler's `return` value), at any depth. */
export function resourceCalls(
  statements: readonly WorkflowStmtIR[],
  extra: readonly (ExprIR | undefined)[] = [],
): ResourceCalls {
  const out: ResourceCalls = { resourceOps: [], remoteApiOps: [] };
  const visit = (e: ExprIR): void => {
    if (e.kind !== "call") return;
    if (e.callKind === "resource-op" && e.resourceOp) out.resourceOps.push(e.resourceOp);
    else if (e.callKind === "remote-api-op" && e.remoteApiOp) out.remoteApiOps.push(e.remoteApiOp);
  };
  for (const st of statements) walkWorkflowStmtExprsDeep(st, visit);
  for (const e of extra) if (e) walkExprDeep(e, visit);
  return out;
}
