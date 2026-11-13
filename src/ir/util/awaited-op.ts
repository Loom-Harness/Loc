import type { ExprIR } from "../types/loom-ir.js";

/** Extract `{aggregate, operation, args}` from an awaited variant-match subject.
 *  Handles both the api-param-prefixed form (`<api>.<Agg>.<op>(args)`, Pattern
 *  B/A) and the bare-aggregate form (`<Agg>.<op>(args)`, Pattern E/D) — for the
 *  awaited match the aggregate name is all we need (the api handle only selected
 *  the bounded context, which `contextModuleByAggName` already resolves). */
export function detectAwaitedOp(
  subject: ExprIR,
): { aggName: string; opName: string; args: ExprIR[] } | null {
  if (subject.kind === "method-call") {
    const aggName = qualifierName(subject.receiver);
    if (aggName) return { aggName, opName: subject.member, args: subject.args };
  }
  if (subject.kind === "member") {
    const aggName = qualifierName(subject.receiver);
    if (aggName) return { aggName, opName: subject.member, args: [] };
  }
  return null;
}

/** The aggregate name a `match await` subject is qualified by: the LAST segment
 *  of the receiver chain, whatever its depth.  `Order` in each of `Order.op()`,
 *  `Api.Order.op()` and any deeper `a.b.Order.op()` qualification — only the
 *  aggregate matters here, since `contextModuleByAggName` already resolves the
 *  bounded context the api handle would have selected. */
function qualifierName(recv: ExprIR): string | null {
  if (recv.kind === "member") return recv.member;
  if (recv.kind === "ref") return recv.name;
  return null;
}
