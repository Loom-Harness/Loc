// What a workflow (or event-reactor) body needs bound before it runs: the
// principal, and the audit writer.  Both are decided by the op-calls anywhere
// in the body — a loop body, an `if let` branch, a `match` arm — because an
// inline op-call renders the operation's hoisted gate and its audit staging at
// the call site.  A backend that answered either question from the top-level
// statements (or `for-each` bodies only) emitted a nested gate that names an
// unbound `currentUser`, or skipped the audit row of a nested audited call.

import {
  type BoundedContextIR,
  type CommandHandlerIR,
  handlerUsesCurrentUser,
  type QueryHandlerIR,
  type WorkflowStmtIR,
} from "../types/loom-ir.js";
import { workflowNeedsCurrentUser } from "../util/op-gates.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { lookupOp } from "./operation-lookup.js";

export { workflowNeedsCurrentUser };

/** The aggregates whose `audited` (non-extern) operations the body calls
 *  inline, in first-call order.  Non-empty means the body stages
 *  audit_records rows and needs the audit writer. */
export function auditedOpCallAggregates(
  ctx: Pick<BoundedContextIR, "aggregates">,
  statements: readonly WorkflowStmtIR[],
): Set<string> {
  const aggs = new Set<string>();
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (s) => {
      if (s.kind !== "op-call") return;
      const op = lookupOp(ctx, s.aggName, s.op);
      if (op?.audited && !op.extern) aggs.add(s.aggName);
    });
  }
  return aggs;
}

/** True when the body calls an `audited` (non-extern) operation inline. */
export function callsAuditedOp(
  ctx: Pick<BoundedContextIR, "aggregates">,
  statements: readonly WorkflowStmtIR[],
): boolean {
  return auditedOpCallAggregates(ctx, statements).size > 0;
}

/** True when a routed `commandHandler` / `queryHandler` must bind the
 *  principal: its body or `return` reads `currentUser`, or it calls an
 *  operation whose hoisted gate or remaining body does (the same reasons a
 *  workflow does — `workflowNeedsCurrentUser`).  An extern handler has no
 *  body. */
export function handlerNeedsCurrentUser(
  h: CommandHandlerIR | QueryHandlerIR,
  ctx: Pick<BoundedContextIR, "aggregates">,
): boolean {
  return !h.extern && (handlerUsesCurrentUser(h) || workflowNeedsCurrentUser(h, ctx));
}
