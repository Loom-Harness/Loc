// The system principal (ruling D1, `docs/decisions.md`
// D-REACTOR-SYSTEM-PRINCIPAL) — IR-side predicates every layer below the
// validator shares.
//
// An event reactor (a workflow's event-triggered `create(e)` starter or `on(e)`
// subscription) has no request principal, so it runs as the SYSTEM principal:
// `currentUser.isSystem` is true, every claim is empty, the tenant is the
// triggering event's, and `causedBy` names the originating user for audit.

import { PRINCIPAL_IS_SYSTEM } from "../../util/principal.js";
import type { ExprIR, OperationIR, WorkflowIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { workflowNeedsCurrentUser } from "./op-gates.js";
import { walkExprDeep } from "./walk.js";

/** Is this expression node `currentUser.isSystem`? */
export function isPrincipalIsSystem(e: ExprIR): boolean {
  return (
    e.kind === "member" &&
    e.member === PRINCIPAL_IS_SYSTEM &&
    e.receiver.kind === "ref" &&
    e.receiver.refKind === "current-user"
  );
}

/** True when `currentUser.isSystem` appears anywhere in the expression. */
export function exprMentionsIsSystem(e: ExprIR): boolean {
  let found = false;
  walkExprDeep(e, (n) => {
    if (isPrincipalIsSystem(n)) found = true;
  });
  return found;
}

/** Does a reactor body need the system principal bound?  The body names
 *  `currentUser` itself, or calls an operation whose hoisted gate / remaining
 *  body does — the same question a command workflow asks of its request
 *  principal, over the reactor's statements. */
export function reactorNeedsPrincipal(
  statements: readonly WorkflowStmtIR[],
  ctx: { aggregates: readonly { name: string; operations?: readonly OperationIR[] }[] },
): boolean {
  return workflowNeedsCurrentUser({ statements }, ctx);
}

/** Every event-reactor body a workflow declares — its event-triggered
 *  starters and its `on(e)` subscriptions.  Command-triggered creates and
 *  `handle` commands run under a request principal and are not reactors. */
export function reactorBodies(
  wf: WorkflowIR,
): { label: string; event: string; statements: readonly WorkflowStmtIR[] }[] {
  const out: { label: string; event: string; statements: readonly WorkflowStmtIR[] }[] = [];
  for (const c of wf.creates) {
    if (c.triggerKind !== "event" || !c.eventRef) continue;
    out.push({
      label: `${wf.name}.create(${c.eventBinding ?? "e"}: ${c.eventRef})`,
      event: c.eventRef,
      statements: c.statements,
    });
  }
  for (const on of wf.subscriptions ?? []) {
    out.push({
      label: `${wf.name}.on(${on.param}: ${on.event})`,
      event: on.event,
      statements: on.statements,
    });
  }
  return out;
}
