// Does a lifecycle-stamp value read the aggregate it stamps?
//
// A `stamp onCreate { … }` / `onUpdate { … }` body has `this` in scope: a value
// may read the host aggregate's fields, value-object fields, derived values, id
// or its own `function`s (`dueAt := now() + hours(slaHours())`).  Every backend
// evaluates such a value against the instance being persisted, which a stamp
// site that is NOT a method on that instance (node's persist-time helper,
// Elixir's changeset pipe) has to bind explicitly — so they all ask this one
// question, here, rather than each re-deriving which IR shapes count as a self
// read.

import type { CallKind, ContextStampIR, ExprIR, RefKind } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** Refs resolved against the host aggregate. */
const SELF_REF_KINDS: ReadonlySet<RefKind> = new Set<RefKind>([
  "this-prop",
  "this-vo-prop",
  "this-derived",
  "helper-fn",
]);

/** Calls dispatched on the host aggregate (its own `function`s / operations). */
const SELF_CALL_KINDS: ReadonlySet<CallKind> = new Set<CallKind>(["function", "private-operation"]);

/** True when `value` reads the host aggregate anywhere inside it. */
export function stampValueReadsAggregate(value: ExprIR): boolean {
  let reads = false;
  walkExprDeep(value, (e) => {
    if (e.kind === "this" || e.kind === "id") reads = true;
    else if (e.kind === "ref" && SELF_REF_KINDS.has(e.refKind)) reads = true;
    else if (e.kind === "call" && SELF_CALL_KINDS.has(e.callKind)) reads = true;
  });
  return reads;
}

/** True when any assignment of `stamps` for one of `events` reads the host
 *  aggregate. */
export function stampsReadAggregate(
  stamps: readonly ContextStampIR[] | undefined,
  events: readonly ("create" | "update")[],
): boolean {
  return (stamps ?? []).some(
    (r) => events.includes(r.event) && r.assignments.some((a) => stampValueReadsAggregate(a.value)),
  );
}
