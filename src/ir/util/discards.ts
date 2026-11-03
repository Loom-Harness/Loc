// The aggregates whose tentative change some body of a context drops.
//
// `let r = a.withdraw(x)` over a result with an `error` variant mutates `a`
// tentatively; the error arms of the `match` over `r` drop that change
// (`discardsInArm` / `discardsInElse` on the `variant-match`).  On a backend
// whose persistence tracks loaded entities the drop is an explicit detach, and
// the repository of each aggregate named here grows the method that performs
// it.  Derived on demand from the bodies, so the method exists exactly when a
// body calls it.

import type { BoundedContextIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "./walk.js";

/** The aggregate names any workflow / handler body of `ctx` discards. */
export function discardedAggregates(
  ctx: Pick<BoundedContextIR, "workflows" | "commandHandlers" | "queryHandlers">,
): Set<string> {
  const out = new Set<string>();
  const bodies: (readonly WorkflowStmtIR[])[] = [
    ...ctx.workflows.flatMap((wf) => [
      ...wf.creates.map((c) => c.statements),
      ...(wf.subscriptions ?? []).map((o) => o.statements),
    ]),
    ...(ctx.commandHandlers ?? []).map((h) => h.statements),
    ...(ctx.queryHandlers ?? []).map((h) => h.statements),
  ];
  for (const body of bodies) {
    for (const root of body) {
      walkWorkflowStmtsDeep(root, (st) => {
        if (st.kind !== "variant-match") return;
        for (const d of [
          ...st.arms.flatMap((a) => a.discardsInArm ?? []),
          ...(st.discardsInElse ?? []),
        ]) {
          out.add(d.aggName);
        }
      });
    }
  }
  return out;
}
