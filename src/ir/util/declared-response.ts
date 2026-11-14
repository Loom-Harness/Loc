// Which read contract a response emitter renders for an aggregate root.
//
// A context can declare the `response <Agg>Response` record that describes an
// aggregate's read wire (`with scaffoldHandlers`, the implicit
// `api X from <Subdomain>` form, or by hand).  Every backend's response-DTO /
// schema emitter renders that record when it is the authority and the derived
// wire shape (`forApiRead(wireFieldsFor*)`) otherwise.  This is the one place
// that decides which, so the five emitters cannot disagree.

import { maskedReadPredicates } from "../enrich/mask-taint.js";
import type { AggregateIR, EntityPartIR, PayloadIR, TypeIR } from "../types/loom-ir.js";

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

/** One response record a client receives: a root's or a contained part's read
 *  wire, as name + fields. */
export interface ContractResponse {
  /** The record name a client sees — `<Entity>Response`. */
  name: string;
  /** The aggregate or part the record describes. */
  entity: string;
  fields: readonly ContractResponseField[];
}

export interface ContractResponseField {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** The field is redacted to `null` for a caller who fails its `mask unless`
   *  predicate.  The flag ships; the predicate never does. */
  maskable?: true;
  /** The field rides the wire inside the `Provenanced<T>` carrier, with its
   *  lineage beside the value. */
  provenanced?: true;
}

/** The declared response records of `agg` and of every part it contains, read
 *  through `declaredResponseFor`, for the Frontend Contract.  `undefined` when
 *  the context declares no `<Agg>Response` record: nothing exposes the
 *  aggregate over a declared contract. */
export function contractResponsesFor(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): ContractResponse[] | undefined {
  const root = declaredResponseFor(payloads, agg);
  if (!root) return undefined;
  const out: ContractResponse[] = [contractResponse(root, agg.name)];
  for (const part of agg.parts) {
    const rec = declaredResponseFor(payloads, part);
    if (rec) out.push(contractResponse(rec, part.name));
  }
  return out;
}

/** A declared response record leaves the identity implicit; every backend
 *  serializes it first, so it is stated here. */
function contractResponse(rec: PayloadIR, entity: string): ContractResponse {
  const fields: ContractResponseField[] = rec.fields.map((f) => ({
    name: f.name,
    type: f.type,
    optional: f.optional,
    ...(f.maskUnless !== undefined ? { maskable: true as const } : {}),
    ...(f.provenanced ? { provenanced: true as const } : {}),
  }));
  if (!fields.some((f) => f.name === "id")) {
    fields.unshift({ name: "id", type: { kind: "id", targetName: entity }, optional: false });
  }
  return { name: rec.name, entity, fields };
}
