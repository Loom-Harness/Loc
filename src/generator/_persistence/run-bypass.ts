// The `ignoring` stance a retrieval runner must bake in.
//
// `Repo.all(<Criterion>) ignoring <Cap>` / `Repo.run(<Retrieval>(…)) ignoring *`
// lower to a `repo-run` statement naming a retrieval, and every call site of
// that retrieval shares ONE generated `run<Retrieval>` repository method.  A
// runner that filters in the application (a document blob, which has no
// queryable columns) cannot take the stance per call, so it bakes in the UNION
// over every call site: `bypassAll` when any site bypasses everything, else
// every capability any site names.  Deny and bare (capability-less)
// restrictions are never bypassed — the read-scope fact drops only what an
// `ignoring` clause names.

import type { ReadBypass } from "../../ir/enrich/read-scope.js";
import type { BoundedContextIR, WorkflowStmtIR } from "../../ir/types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../ir/util/walk.js";

/** The union bypass per retrieval name over every `repo-run` of `aggName` in
 *  `ctx` — workflow starters and subscriptions, command handlers and query
 *  handlers, nested statements included.  Empty when no such read carries an
 *  `ignoring` clause. */
export function runBypassesByRetrieval(
  ctx: BoundedContextIR,
  aggName: string,
): Map<string, ReadBypass> {
  const acc = new Map<string, { bypassAll: boolean; caps: Set<string> }>();
  const visit = (s: WorkflowStmtIR): void => {
    if (s.kind !== "repo-run" || s.aggName !== aggName) return;
    if (!s.bypassAll && (s.bypassCaps?.length ?? 0) === 0) return;
    const cur = acc.get(s.retrievalName) ?? { bypassAll: false, caps: new Set<string>() };
    if (s.bypassAll) cur.bypassAll = true;
    for (const c of s.bypassCaps ?? []) cur.caps.add(c);
    acc.set(s.retrievalName, cur);
  };
  const bodies: (readonly WorkflowStmtIR[])[] = [
    ...ctx.workflows.flatMap((wf) => [
      ...wf.creates.map((c) => c.statements),
      ...(wf.subscriptions ?? []).map((on) => on.statements),
    ]),
    ...(ctx.commandHandlers ?? []).map((h) => h.statements),
    ...(ctx.queryHandlers ?? []).map((h) => h.statements),
  ];
  for (const body of bodies) for (const s of body) walkWorkflowStmtsDeep(s, visit);
  const out = new Map<string, ReadBypass>();
  for (const [name, v] of acc) {
    out.set(name, v.bypassAll ? { bypassAll: true } : { bypassCaps: [...v.caps] });
  }
  return out;
}
