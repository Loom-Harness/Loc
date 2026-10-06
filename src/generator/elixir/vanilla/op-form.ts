// What a LiveView operation form may assume about the context façade — one
// predicate per seam, shared by the façade emitter (`context-emit.ts`) and the
// LiveView emitters (`heex-primitives.ts` / `liveview-emit.ts`) so a page can
// never call a function the façade did not emit.

import type { AggregateIR, OperationIR } from "../../../ir/types/loom-ir.js";
import { CRUD_RESERVED_NAMES } from "./context-emit.js";
import { isEventSourced } from "./eventsourced-emit.js";
import { isReturningOperation } from "./operation-returns-emit.js";

/** Whether the façade carries `can_<op>_<agg>(record)` — the side-effect-free
 *  `when` probe behind `GET /<aggs>/{id}/can_<op>`.  A LiveView detail page
 *  assigns it to disable the op's trigger while the gate refuses. */
export function servesCanProbe(agg: AggregateIR, op: OperationIR): boolean {
  return !isEventSourced(agg) && op.visibility === "public" && op.when !== undefined;
}

/** Whether a LiveView op form submits through the operation itself
 *  (`<op>_<agg>(record, %{})`) rather than the CRUD `update_<agg>`.  Only a
 *  parameterless, non-returning, non-CRUD operation qualifies: its form carries
 *  no inputs, so there is no string-typed form value for the op's wire-format
 *  guards to refuse.  (A parameterised op still submits through `update_<agg>`
 *  — a separate gap.) */
export function liveViewCallsOp(agg: AggregateIR, op: OperationIR): boolean {
  return (
    !isEventSourced(agg) &&
    !CRUD_RESERVED_NAMES.has(op.name) &&
    !isReturningOperation(op) &&
    op.params.length === 0
  );
}
