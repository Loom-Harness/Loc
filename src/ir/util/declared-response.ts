// Which read contract a response emitter renders for an aggregate root.
//
// A context can declare the `response <Agg>Response` record that describes an
// aggregate's read wire (`with scaffoldHandlers`, the implicit
// `api X from <Subdomain>` form, or by hand).  Every backend's response-DTO /
// schema emitter renders that record when it is the authority and the derived
// wire shape (`forApiRead(wireFieldsFor*)`) otherwise.  This is the one place
// that decides which, so the five emitters cannot disagree.

import { forApiRead, wireFieldsFor, wireMaskPlan } from "../enrich/wire-projection.js";
import type { AggregateIR, PayloadIR, TypeIR } from "../types/loom-ir.js";

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

/** One response record a client receives: a root's or a contained part's read
 *  wire, as name + fields. */
export interface ResponseWire {
  /** The record name a client sees — `<Entity>Response`. */
  name: string;
  /** The aggregate or part the record describes. */
  entity: string;
  /** `declared`: the context's own `response` record.  `derived-fallback`: the
   *  derived read wire, used only where `declaredResponseFor` refuses the
   *  record because a mask sits on or under the aggregate. */
  source: "declared" | "derived-fallback";
  fields: readonly ResponseWireField[];
}

export interface ResponseWireField {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** The field is redacted to `null` for a caller who fails its `mask unless`
   *  predicate.  The flag ships; the predicate never does. */
  maskable?: true;
}

/** The read wire of `agg` and of every part it contains, as response records —
 *  through `declaredResponseFor`, so the declared records are the source and the
 *  derived shape is read only for the masked aggregates that function refuses.
 *  `undefined` when the context declares no `<Agg>Response` record: nothing
 *  exposes the aggregate over a declared contract. */
export function responseWireFor(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): ResponseWire[] | undefined {
  const declared = declaredResponseFor(payloads, agg);
  if (declared) {
    const out: ResponseWire[] = [recordWire(declared, agg.name)];
    for (const part of agg.parts) {
      const rec = payloads.find((p) => p.kind === "response" && p.name === `${part.name}Response`);
      if (rec) out.push(recordWire(rec, part.name));
    }
    return out;
  }
  if (!payloads.some((p) => p.kind === "response" && p.name === `${agg.name}Response`)) {
    return undefined;
  }
  return [agg, ...agg.parts].map((ent) => ({
    name: `${ent.name}Response`,
    entity: ent.name,
    source: "derived-fallback" as const,
    fields: forApiRead(wireFieldsFor(ent)).map((wf) => ({
      name: wf.name,
      type: wf.type,
      optional: wf.optional,
      ...(wf.maskUnless !== undefined ? { maskable: true as const } : {}),
    })),
  }));
}

/** A declared response record leaves the identity implicit; every backend
 *  serializes it first, as the derived shape does, so it is stated here. */
function recordWire(rec: PayloadIR, entity: string): ResponseWire {
  const fields: ResponseWireField[] = rec.fields.map((f) => ({
    name: f.name,
    type: f.type,
    optional: f.optional,
  }));
  if (!fields.some((f) => f.name === "id")) {
    fields.unshift({ name: "id", type: { kind: "id", targetName: entity }, optional: false });
  }
  return { name: rec.name, entity, source: "declared", fields };
}
