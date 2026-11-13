// What a LiveView operation form may assume about the context façade — one
// predicate per seam, shared by the façade emitter (`context-emit.ts`) and the
// LiveView emitters (`heex-form.ts` / `liveview-emit.ts`) so a page can
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
 *  (`<op>_<agg>(record, params[, current_user])`) rather than the CRUD
 *  `update_<agg>`.  Every named operation does: the REST action and the SPA
 *  frontends dispatch to it, so its `requires` / `when` gate, preconditions and
 *  `emit`s run.  A field update would skip all four, and on an event-sourced
 *  aggregate there is no `update_<agg>` to call at all.  Only the CRUD names
 *  (`update` itself) submit through the changeset path. */
export function liveViewCallsOp(_agg: AggregateIR, op: OperationIR): boolean {
  return !CRUD_RESERVED_NAMES.has(op.name);
}

/** How a LiveView reads back the record after a named op succeeded: a plain or
 *  event-sourced op answers `{:ok, record}` with the updated record, a
 *  returning op answers `{:ok, value}` (its declared result), so the page
 *  reloads the record instead. */
export function liveViewOpReturnsRecord(agg: AggregateIR, op: OperationIR): boolean {
  return isEventSourced(agg) || !isReturningOperation(op);
}
