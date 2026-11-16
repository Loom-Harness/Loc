// Two advisories that make a transaction boundary visible where the author
// cannot see it from the source.  Both are informational: the model is legal,
// and they print under the `Suggestions:` channel (`ADVISORY_CODES`).
//
//   loom.handler-effect-in-transaction — a `commandHandler` body runs in one
//     transaction, and a resource call that causes an outside effect (a
//     stored object, a sent message, a POST) runs inside it.  The effect is
//     not undone if the transaction rolls back.  The author decides; the
//     alternative is to emit an event and make the call in a reactor, which
//     runs after the change commits.
//
//   loom.workflow-partial-commit — a non-transactional workflow that can
//     commit part of its work and then fail (a writing loop, or a writing
//     branch followed by more work).  The points come from the plan
//     (`workflowPartialCommits`).

import { diagMessage } from "../../../diagnostics/messages.js";
import { workflowPartialCommits } from "../../plan/index.js";
import { findVerb } from "../../resource-verbs.js";
import type { BoundedContextIR, ExprIR } from "../../types/loom-ir.js";
import { walkWorkflowStmtExprsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The call's spelling when it causes an outside effect, else `undefined`. */
function effectCall(e: ExprIR): string | undefined {
  if (e.kind !== "call") return undefined;
  if (e.callKind === "resource-op" && e.resourceOp) {
    const op = e.resourceOp;
    return findVerb(op.resourceKind, op.verb)?.effect
      ? `${op.resourceName}.${op.verb}(…)`
      : undefined;
  }
  if (e.callKind === "remote-api-op" && e.remoteApiOp) {
    const op = e.remoteApiOp;
    return op.method.toUpperCase() === "GET"
      ? undefined
      : `${op.resourceName} ${op.method.toUpperCase()} ${op.path}`;
  }
  return undefined;
}

export function validateTransactionHints(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const h of ctx.commandHandlers) {
    const seen = new Set<string>();
    for (const st of h.statements) {
      walkWorkflowStmtExprsDeep(st, (e) => {
        const call = effectCall(e);
        if (!call || seen.has(call)) return;
        seen.add(call);
        diags.push({
          severity: "warning",
          code: "loom.handler-effect-in-transaction",
          message: diagMessage("loom.handler-effect-in-transaction", { name: h.name, call }),
          source: `${ctx.name}/${h.name}`,
        });
      });
    }
  }
  for (const wf of ctx.workflows) {
    const points = workflowPartialCommits(wf);
    if (points.length === 0) continue;
    diags.push({
      severity: "warning",
      code: "loom.workflow-partial-commit",
      message: diagMessage("loom.workflow-partial-commit", {
        name: wf.name,
        points: points
          .map(
            (p) => `a ${p.kind === "loop" ? "loop" : "branch"} saving ${p.aggregates.join(", ")}`,
          )
          .join("; "),
      }),
      source: `${ctx.name}/${wf.name}`,
      origin: wf.origin,
    });
  }
}
