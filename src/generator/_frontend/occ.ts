// ---------------------------------------------------------------------------
// The optimistic-concurrency precondition — which generated client call carries
// an `If-Match` header, in ONE place.
//
// The server half of this decision already exists, five times, and the five
// agree: a `versioned` aggregate's `update` operation is guarded on the
// client's expected version (`isVersionedUpdate` in the hono routes builder and
// its .NET / python / java / elixir twins).  No other operation is.
//
// The client half did not exist at all (F-023): `grep -rn 'If-Match' web/src`
// over a generated project returned NOTHING on every frontend, so
// `parseIfMatch(undefined, current)` fell back to the version the server had
// just loaded itself and the guard passed vacuously on every write the tool's
// own UI made.  That is a silent lost update — two people open the same record,
// both save, the second overwrites — and it is exactly what the header exists
// to prevent.
//
// This predicate is shared rather than re-derived per frontend for the reason
// `claimPathFor` was consolidated (`_auth/claim-types.ts`): four copies of one
// rule is four chances to drift, and a client that preconditions a call the
// server does not guard (or misses one it does) is invisible until someone
// loses an edit.
// ---------------------------------------------------------------------------

import type { AggregateIR, OperationIR } from "../../ir/types/loom-ir.js";
import { aggregateIsVersioned } from "../../ir/util/versioned-capability.js";

/** True when the generated client should send the `If-Match` precondition on
 *  this operation's call — i.e. when the backend guards the write on it. */
export function sendsIfMatchPrecondition(agg: AggregateIR, op: OperationIR): boolean {
  return op.name === "update" && aggregateIsVersioned(agg);
}
