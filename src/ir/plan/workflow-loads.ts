// The loads a body dereferences: the names a workflow binds from a by-id read
// that a later statement then reads through — an op-call on it, a member or
// method read on it, or passing it to a domain-service call (which operates on
// the aggregates it is given).  A by-id load that is dereferenced must answer
// not-found when the row is missing rather than hand back a null the next
// statement trips over; one that is only passed along or compared need not.

import type { ExprIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkExprDeep, walkWorkflowStmtChildren, walkWorkflowStmtsDeep } from "../util/walk.js";

/** Every name `stmts` dereferences, at any depth. */
export function dereferencedLoads(stmts: readonly WorkflowStmtIR[]): Set<string> {
  const names = new Set<string>();
  const visitExpr = (e: ExprIR): void => {
    if ((e.kind === "member" || e.kind === "method-call") && e.receiver.kind === "ref") {
      names.add(e.receiver.name);
    }
  };
  for (const top of stmts) {
    walkWorkflowStmtsDeep(top, (st) => {
      if (st.kind === "op-call") names.add(st.target);
      else if (st.kind === "domain-service-call") {
        const args = st.call.kind === "call" ? st.call.args : [];
        for (const a of args) {
          if (a.kind === "ref") names.add(a.name);
        }
      }
      walkWorkflowStmtChildren(st, { expr: (e) => walkExprDeep(e, visitExpr) });
    });
  }
  return names;
}
