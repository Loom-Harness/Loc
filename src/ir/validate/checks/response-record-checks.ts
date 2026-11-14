// A declared `response <Agg>Response` / `<Part>Response` record is the read
// contract of its aggregate or part: every response DTO and serializer renders
// its rows (`responseWireFor`), projecting each field from the entity member of
// the same name.  So each record field must name a member the read wire can
// carry — a field that is not `internal` / `secret`, a containment (typed
// `<Part>Response`), or a `derived` — with the member's type.  A field that
// names nothing, or names it with another type, would describe a response the
// serializer cannot produce.

import { diagMessage } from "../../../diagnostics/messages.js";
import type {
  AggregateIR,
  BoundedContextIR,
  EntityPartIR,
  FieldIR,
  TypeIR,
} from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The record type a member of `ent` must carry, or a reason it cannot appear. */
function expectedType(
  ent: AggregateIR | EntityPartIR,
  name: string,
): { type: TypeIR; optional: boolean } | "unreadable" | undefined {
  const c = ent.contains.find((x) => x.name === name);
  if (c) {
    const el: TypeIR = { kind: "entity", name: `${c.partName}Response`, declKind: "response" };
    if (c.collection) return { type: { kind: "array", element: el }, optional: false };
    return c.optional
      ? { type: { kind: "optional", inner: el }, optional: true }
      : { type: el, optional: false };
  }
  const d = ent.derived.find((x) => x.name === name && x.name !== "inspect");
  if (d) return { type: d.type, optional: d.type.kind === "optional" };
  const f = ent.fields.find((x) => x.name === name);
  if (!f) return undefined;
  if (f.access === "internal" || f.access === "secret") return "unreadable";
  return { type: f.type, optional: f.optional };
}

/** A type's shape, ignoring how a reference to it was resolved. */
function shape(t: TypeIR): string {
  return JSON.stringify(t, (k, v) => (k === "declKind" || k === "origin" ? undefined : v));
}

function check(
  ctx: BoundedContextIR,
  ent: AggregateIR | EntityPartIR,
  diags: LoomDiagnostic[],
): void {
  const record = ctx.payloads.find(
    (p) => p.kind === "response" && p.name === `${ent.name}Response`,
  );
  if (!record) return;
  for (const f of record.fields as FieldIR[]) {
    const want = expectedType(ent, f.name);
    if (want === undefined || want === "unreadable") {
      diags.push({
        severity: "error",
        code: "loom.payload-response-field",
        message: diagMessage("loom.payload-response-field#unknown", {
          record: record.name,
          field: f.name,
          entity: ent.name,
        }),
        source: `${ctx.name}/${record.name}`,
        origin: f.origin,
      });
      continue;
    }
    if (shape(want.type) !== shape(f.type) || want.optional !== f.optional) {
      diags.push({
        severity: "error",
        code: "loom.payload-response-field",
        message: diagMessage("loom.payload-response-field#type", {
          record: record.name,
          field: f.name,
          entity: ent.name,
        }),
        source: `${ctx.name}/${record.name}`,
        origin: f.origin,
      });
    }
  }
}

export function validateResponseRecords(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const agg of ctx.aggregates) {
    check(ctx, agg, diags);
    for (const part of agg.parts) check(ctx, part, diags);
  }
}
