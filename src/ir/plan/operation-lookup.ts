// Operation resolution: the operation an `op-call` names, found by aggregate
// name and operation name in the bounded context that owns the call.

import type { BoundedContextIR, OperationIR } from "../types/loom-ir.js";

/** The operation `aggName.opName` declared in `ctx`, or `undefined` when the
 *  context has no such aggregate or the aggregate no such operation. */
export function lookupOp(
  ctx: Pick<BoundedContextIR, "aggregates">,
  aggName: string,
  opName: string,
): OperationIR | undefined {
  return ctx.aggregates.find((a) => a.name === aggName)?.operations.find((o) => o.name === opName);
}
