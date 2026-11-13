// Which read contract a response emitter renders for an aggregate root.
//
// A context can declare the `response <Agg>Response` record that describes an
// aggregate's read wire (`with scaffoldHandlers`, the implicit
// `api X from <Subdomain>` form, or by hand).  Every backend's response-DTO /
// schema emitter renders that record when it is the authority and the derived
// wire shape (`forApiRead(wireFieldsFor*)`) otherwise.  This is the one place
// that decides which, so the five emitters cannot disagree.

import { maskedReadPredicates } from "../enrich/mask-taint.js";
import type { AggregateIR, EntityPartIR, PayloadIR } from "../types/loom-ir.js";

/** The declared `<Agg>Response` (or `<Part>Response`) record a response
 *  emitter reads for `agg`, or `undefined` when it must read the derived wire
 *  shape instead.
 *
 *  Each field the aggregate masks carries that mask as `maskUnless`: a
 *  declared `mask unless` field keeps its own predicate, and a `derived`
 *  computed from masked members carries the conjunction of theirs (the
 *  visibility taint, `maskedReadPredicates`).  The mask is the aggregate's,
 *  never the record's — a payload field cannot declare one
 *  (`loom.field-mask-on-payload`) — so a hand-written record cannot drop a
 *  redaction the serializer applies, and every emitter reading the record
 *  renders a masked field nullable exactly as the serializer redacts it. */
export function declaredResponseFor(
  payloads: readonly PayloadIR[],
  agg: AggregateIR | EntityPartIR,
): PayloadIR | undefined {
  const declared = payloads.find((p) => p.kind === "response" && p.name === `${agg.name}Response`);
  if (!declared) return undefined;
  const masks = maskedReadPredicates(agg);
  if (masks.size === 0) return declared;
  return {
    ...declared,
    fields: declared.fields.map((f) => {
      const pred = masks.get(f.name);
      return pred ? { ...f, maskUnless: pred } : f;
    }),
  };
}
