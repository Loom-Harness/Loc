// The API-read wire rows of an aggregate or entity part, read from its
// declared `<Agg>Response` / `<Part>Response` record.
//
// The record is the read contract: every exposed context carries one per
// aggregate and part (`scaffoldHandlers`, the implicit
// `api X from <Subdomain>` form, or a hand-written record).  A serializer
// walks rows, not records, so this turns the record into the row list it
// renders:
//   - a leading `id` row (the record cannot declare `id`, a reserved name);
//   - each record field in record order, with
//       · a containment's `<Part>Response` name read back as the part it
//         projects (every emitter appends `Response` itself), its optionality
//         carried as the row flag;
//       · a `provenanced` field wrapped in the `Provenanced<T>` carrier it
//         ships as;
//       · the field's read mask, from `declaredResponseFor`;
//       · its source (property / containment / derived) and access role,
//         read off the entity member of the same name.
//
// An entity with no declared record has no read contract, and asking for its
// rows is an internal error: a hosted context always carries the records.

import type {
  AggregateIR,
  EntityPartIR,
  FieldAccess,
  PayloadIR,
  TypeIR,
  WireField,
} from "../types/loom-ir.js";
import { declaredResponseFor } from "./declared-response.js";

/** The API-read wire rows of `ent`, read from its declared response record.
 *  Throws when `ent` has no declared record. */
export function responseWireFor(
  payloads: readonly PayloadIR[],
  ent: AggregateIR | EntityPartIR,
): WireField[] {
  const record = declaredResponseFor(payloads, ent);
  if (!record) {
    throw new Error(
      `loom internal: '${ent.name}' has no declared '${ent.name}Response' record — its context is not hosted by any deployable`,
    );
  }
  const rows: WireField[] = [
    {
      name: "id",
      type: { kind: "id", targetName: ent.name },
      optional: false,
      source: "id",
      access: "token",
    },
  ];
  for (const f of record.fields) {
    const containment = ent.contains.find((c) => c.name === f.name);
    const mask = f.maskUnless ? { maskUnless: f.maskUnless } : {};
    if (containment) {
      const part: TypeIR = { kind: "entity", name: containment.partName, declKind: "part" };
      rows.push({
        name: f.name,
        type: containment.collection ? { kind: "array", element: part } : part,
        optional: !!containment.optional && !containment.collection,
        source: "containment",
        access: "editable",
        ...mask,
      });
      continue;
    }
    const derived = ent.derived.find((d) => d.name === f.name);
    if (derived) {
      rows.push({
        name: f.name,
        type: f.type,
        optional: f.type.kind === "optional",
        source: "derived",
        access: "editable",
        ...mask,
      });
      continue;
    }
    const field = ent.fields.find((x) => x.name === f.name);
    rows.push({
      name: f.name,
      type: field?.provenanced
        ? { kind: "genericInstance", ctor: "provenanced", arg: f.type }
        : f.type,
      optional: f.optional,
      source: "property",
      access: (field?.access ?? "editable") as FieldAccess,
      ...mask,
    });
  }
  return rows;
}
