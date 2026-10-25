import { diagMessage } from "../../../diagnostics/messages.js";
import {
  declaredCreateParamNames,
  forCreateInput,
  isRequiredCreateInput,
} from "../../enrich/wire-projection.js";
import type {
  BoundedContextIR,
  EnrichedAggregateIR,
  FieldIR,
  TypeIR,
} from "../../types/loom-ir.js";
import { isConstantDefault } from "../../util/constant-default.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// A declared `create(…)`'s parameter list IS the create input.
//
// On a state-based aggregate, a non-empty canonical `create(p1, p2, …)` narrows
// `POST /<plural>` — wire schema, route binding, OpenAPI, generated clients,
// the domain factory and the frontend `CreateForm` — to exactly the fields it
// lists (`declaredCreateParamNames` / `buildCreateInput`,
// `src/ir/enrich/wire-projection.ts`).  Every other field is initialised by
// the factory:
//
//     aggregate Appointment {
//       minutes: int
//       status: AppointmentStatus = Requested   // → Requested, never the client's
//       notes: string?                          // → null
//       create(minutes: int) { }
//     }
//
// Two shapes have no honest emission, and are refused here:
//
//   1. A param that names no client-suppliable field — no such field, or one
//      the server owns (`managed` / `internal` / `token`), or one whose type
//      differs from the param's.  The param is the wire slot of a FIELD; a
//      free-standing param has nowhere to land.
//   2. A field the list leaves out that the factory cannot initialise: a
//      required one (non-nullable, no default, not a `bool` / collection), or
//      one whose default is not a compile-time constant (`now()`,
//      `currentUser.*`, a value-object constructor) — the factory has no
//      clock, principal or wire-shape carrier to evaluate it with.  Filling
//      either with the type's zero would be a fabricated value.
//
// `create()` (the empty list) keeps the full field-derived input, and an
// event-sourced create's params are its command payload on a separate path —
// neither is narrowed, so neither is checked here.
// ---------------------------------------------------------------------------

/** A type with its outer `optional` peeled, plus whether it was nullable. */
function nullableBase(t: TypeIR, optionalFlag = false): { base: TypeIR; nullable: boolean } {
  if (t.kind === "optional") return { base: t.inner, nullable: true };
  return { base: t, nullable: optionalFlag };
}

/** Structural type equality, ignoring source spans and sensitivity tags (a
 *  `sensitive(pii)` field and its plain-typed param share one wire slot). */
function sameType(a: TypeIR, b: TypeIR): boolean {
  const strip = (t: TypeIR): string =>
    JSON.stringify(t, (k, v) => (k === "origin" || k === "sensitivity" ? undefined : v));
  return strip(a) === strip(b);
}

/** Every field any lifecycle stamp writes — a stamp is a construction-time
 *  value the factory does not have to supply. */
function stampedFields(agg: EnrichedAggregateIR): ReadonlySet<string> {
  return new Set((agg.contextStamps ?? []).flatMap((s) => s.assignments.map((a) => a.field)));
}

/** Whether the factory can initialise a field the narrowed list leaves out. */
function factoryCanInitialise(f: FieldIR, stamped: ReadonlySet<string>): boolean {
  if (stamped.has(f.name)) return true;
  if (f.default !== undefined) return isConstantDefault(f.default);
  return !isRequiredCreateInput(f);
}

export function validateDeclaredCreateParams(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const agg of ctx.aggregates as EnrichedAggregateIR[]) {
    const declared = declaredCreateParamNames(agg);
    const create = agg.canonicalCreate;
    if (!declared || !create) continue;
    const source = `${ctx.name}/aggregate ${agg.name}.create`;
    const suppliable = new Map(forCreateInput(agg.fields).map((f) => [f.name, f] as const));

    for (const p of create.params) {
      const field = suppliable.get(p.name);
      if (!field) {
        const owned = agg.fields.find((f) => f.name === p.name);
        diags.push({
          severity: "error",
          code: "loom.create-param-not-a-field",
          message: owned
            ? diagMessage("loom.create-param-not-a-field#server-owned", {
                agg: agg.name,
                param: p.name,
                access: owned.access ?? "managed",
              })
            : diagMessage("loom.create-param-not-a-field", {
                agg: agg.name,
                param: p.name,
                fields: [...suppliable.keys()].map((n) => `\`${n}\``).join(", "),
              }),
          source,
          origin: create.origin,
        });
        continue;
      }
      const fieldT = nullableBase(field.type, field.optional === true);
      const paramT = nullableBase(p.type);
      if (fieldT.nullable !== paramT.nullable || !sameType(fieldT.base, paramT.base)) {
        diags.push({
          severity: "error",
          code: "loom.create-param-not-a-field",
          message: diagMessage("loom.create-param-not-a-field#type", {
            agg: agg.name,
            param: p.name,
          }),
          source,
          origin: create.origin,
        });
      }
    }

    const stamped = stampedFields(agg);
    const omitted = [...suppliable.values()].filter(
      (f) => !declared.has(f.name) && !factoryCanInitialise(f, stamped),
    );
    for (const f of omitted) {
      diags.push({
        severity: "error",
        code: "loom.create-param-required-omitted",
        message:
          f.default !== undefined
            ? diagMessage("loom.create-param-required-omitted#default", {
                agg: agg.name,
                field: f.name,
              })
            : diagMessage("loom.create-param-required-omitted", {
                agg: agg.name,
                field: f.name,
              }),
        source,
        origin: f.origin ?? create.origin,
      });
    }
  }
}
