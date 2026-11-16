// The rules a client validates a request against before sending it.
//
// A frontend folds an aggregate's invariants, and an operation's
// preconditions, into its request schema or form validators so a request the
// server would refuse with a 422 is caught in the browser.  Only a rule that
// reads nothing but the request body can run there (`classifyForWire`); the
// rest stay on the server.  The Frontend Contract carries these lists on its
// create and operation entries, and the walker model answers them for a form,
// so both read them here and agree by construction.

import type {
  AggregateIR,
  ExprIR,
  InvariantIR,
  MessageIR,
  OperationIR,
  PayloadIR,
} from "../types/loom-ir.js";
import { classifyForWire } from "../util/invariant-classify.js";
import { createRequestRecord } from "./create-request.js";

/** One rule a client validates its request against. */
export interface WireInvariant {
  expr: ExprIR;
  guard?: ExprIR;
  message?: MessageIR;
}

/** The rules an operation's request is validated against: the aggregate's
 *  invariants and then the operation's `precondition`s, each kept when it
 *  reads only the operation's params. */
export function operationWireInvariants(
  agg: { readonly invariants: readonly InvariantIR[] } | undefined,
  op: OperationIR,
): WireInvariant[] {
  const available = new Set(op.params.map((p) => p.name));
  return wireRules([...(agg?.invariants ?? []), ...preconditionsOf(op)], available);
}

/** The rules an aggregate's create request is validated against: its
 *  invariants that read only the declared create record's fields, or none
 *  when its context declares no create record. */
export function createWireInvariants(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): WireInvariant[] {
  const record = createRequestRecord(payloads, agg);
  if (!record) return [];
  return wireRules(agg.invariants, new Set(record.fields.map((f) => f.name)));
}

function wireRules(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): WireInvariant[] {
  return invariants
    .filter((inv) => classifyForWire(inv, { available }))
    .map((inv) => ({
      expr: inv.expr,
      ...(inv.guard ? { guard: inv.guard } : {}),
      ...(inv.message ? { message: inv.message } : {}),
    }));
}

/** An operation's `precondition` statements, as the invariants a request is
 *  validated against. */
function preconditionsOf(op: OperationIR): InvariantIR[] {
  return op.statements.flatMap((s) =>
    s.kind === "precondition" ? [{ expr: s.expr, source: s.source, message: s.message }] : [],
  );
}
