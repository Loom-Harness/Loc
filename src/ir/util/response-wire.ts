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

import type { WireMaskPlan } from "../enrich/wire-projection.js";
import type {
  AggregateIR,
  EntityPartIR,
  FieldAccess,
  PayloadIR,
  SystemIR,
  TypeIR,
  ValueObjectIR,
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

/** Where a response serializer redacts, read from the declared records: the
 *  masked rows of `ent` (each nulled unless the caller satisfies its
 *  predicate) and the containments whose part's record carries a mask
 *  somewhere below.  Undefined when nothing on or under `ent` is masked. */
export function responseMaskPlan(
  payloads: readonly PayloadIR[],
  ent: AggregateIR | EntityPartIR,
  parts: readonly EntityPartIR[],
  seen: ReadonlySet<string> = new Set(),
): WireMaskPlan | undefined {
  if (seen.has(ent.name)) return undefined;
  const inner = new Set([...seen, ent.name]);
  const rows = responseWireFor(payloads, ent);
  const fields = rows
    .filter((r) => r.maskUnless !== undefined && r.source !== "containment")
    .map((r) => ({ name: r.name, pred: r.maskUnless! }));
  const nested: WireMaskPlan["nested"] = [];
  for (const r of rows) {
    if (r.source !== "containment") continue;
    const el = r.type.kind === "array" ? r.type.element : r.type;
    const part = el.kind === "entity" ? parts.find((p) => p.name === el.name) : undefined;
    const plan = part ? responseMaskPlan(payloads, part, parts, inner) : undefined;
    if (plan) nested.push({ name: r.name, collection: r.type.kind === "array", plan });
  }
  return fields.length === 0 && nested.length === 0 ? undefined : { fields, nested };
}

/** The aggregate named `name` in `sys`, with the payloads of the context that
 *  declares it — what a consumer holding only the system needs to read the
 *  aggregate's response rows. */
function aggregateHome(
  sys: SystemIR,
  name: string,
): { agg: AggregateIR; payloads: readonly PayloadIR[] } | undefined {
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      const agg = ctx.aggregates.find((a) => a.name === name);
      if (agg) return { agg, payloads: ctx.payloads };
    }
  }
  return undefined;
}

/** The API-read wire rows of `agg`, read from the declared record of the
 *  context that declares it in `sys` — what a consumer holding only the system
 *  (an api-client reading another deployable's aggregate) renders. */
export function responseWireIn(sys: SystemIR, agg: AggregateIR | EntityPartIR): WireField[] {
  return responseWireFor(aggregateHome(sys, agg.name)?.payloads ?? [], agg);
}

/** The wire rows of a value object: its declared fields, then its derived
 *  values.  A value object has no identity and no response record of its own
 *  — it crosses inside the record of whatever holds it — so its declaration
 *  is its wire.  A field keeps its domain type: a value object has no row and
 *  no write-site instrumentation, so no backend emits a lineage carrier for a
 *  VO member. */
export function valueObjectWire(vo: ValueObjectIR): WireField[] {
  return [
    ...vo.fields.map(
      (f): WireField => ({
        name: f.name,
        type: f.type,
        optional: f.optional,
        source: "property",
        access: f.access ?? "editable",
      }),
    ),
    ...vo.derived.map(
      (d): WireField => ({
        name: d.name,
        type: d.type,
        optional: d.type.kind === "optional",
        source: "derived",
        access: "editable",
      }),
    ),
  ];
}
