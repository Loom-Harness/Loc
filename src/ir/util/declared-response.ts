// Which read contract a response emitter renders for an aggregate root.
//
// A context can declare the `response <Agg>Response` record that describes an
// aggregate's read wire (`with scaffoldHandlers`, the implicit
// `api X from <Subdomain>` form, or by hand).  Every backend's response-DTO /
// schema emitter renders that record when it is the authority and the derived
// wire shape (`forApiRead(wireFieldsFor*)`) otherwise.  This is the one place
// that decides which, so the five emitters cannot disagree.

import { wireMaskPlan } from "../enrich/wire-projection.js";
import type { AggregateIR, PayloadIR } from "../types/loom-ir.js";

/** The declared `<Agg>Response` record a response emitter reads for `agg`, or
 *  `undefined` when it must read the derived wire shape instead.
 *
 *  A record field has no `mask unless` clause, so a record cannot say that a
 *  field is redacted to null for a caller who fails the predicate: rendered
 *  from the record, a masked field would be declared non-nullable and its
 *  `fromMasked` / nullable projection would vanish while the serializer still
 *  redacts.  An aggregate whose read wire carries a masked field therefore
 *  keeps the derived shape, which does carry the predicate — and so does one
 *  whose contained part carries a mask, which the record cannot say either. */
export function declaredResponseFor(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): PayloadIR | undefined {
  const declared = payloads.find((p) => p.kind === "response" && p.name === `${agg.name}Response`);
  if (!declared) return undefined;
  if (wireMaskPlan(agg, agg.parts) !== undefined) {
    return undefined;
  }
  return declared;
}
