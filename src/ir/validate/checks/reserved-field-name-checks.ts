// -------------------------------------------------------------------------
// Field names a backend's RUNTIME reserves — legal `.ddd` identifiers that no
// emitter can carry under their own name without a wire-visible rename.
//
//   - `loom.dunder-field-name` (every backend).  A `__name__`-shaped field on a
//     record (aggregate / part / value object / event / payload).  Elixir
//     reserves `__struct__` on every struct (`defstruct` refuses it: "cannot
//     set :__struct__ in struct definition") and Ecto `__meta__` on every
//     schema ("field/association :__meta__ already exists on schema"); Python's
//     pydantic silently does not treat a dunder annotation as a field at all,
//     so `body.__meta__` is an AttributeError at request time.  A rename would
//     move the wire key on those backends alone, so refuse it up front.
//
//   - `loom.elixir-part-timestamp-field` (elixir only).  A RELATIONAL entity
//     part's Ecto schema carries the bundled `timestamps()` macro (its child
//     table is created with them), so a declared part field whose column is
//     `inserted_at` / `updated_at` defines the field twice and the generated
//     project fails `mix compile`.  On an aggregate ROOT the emitter instead
//     drops `timestamps()` and lets the declared field own the column
//     (`ownsEctoTimestampColumn`, `vanilla/schema-emit.ts`); the part path
//     cannot do that cleanly, because the shared relational-containment helper
//     (`__put_assoc_parts`) strips `:inserted_at`/`:updated_at` off every part
//     before `put_assoc` — a declared column of that name would silently lose
//     its value on every containment write.  Scoped to contexts a
//     `platform: elixir` deployable hosts; node / python / java / dotnet have
//     no implicit timestamp columns and are untouched.  (The camelCase
//     `createdAt` / `updatedAt` audit names are not this shape — the emitter
//     skips them as explicit audit fields.)
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { platformFamily } from "../../../language/validators/data/platform-rules.js";
import { snake } from "../../../util/naming.js";
import type {
  BoundedContextIR,
  EnrichedAggregateIR,
  FieldIR,
  SystemIR,
} from "../../types/loom-ir.js";
import { effectiveSavingShape, resolveDataSourceConfig } from "../../util/resolve-datasource.js";
import type { LoomDiagnostic } from "./diagnostic.js";

const DUNDER = /^__\w+__$/;

/** Every field-bearing record in `ctx`, as `[what, owner, fields]`. */
function fieldHolders(ctx: BoundedContextIR): [string, string, FieldIR[]][] {
  const out: [string, string, FieldIR[]][] = [];
  for (const a of ctx.aggregates) {
    out.push(["aggregate", a.name, a.fields]);
    for (const p of a.parts) out.push(["entity part", `${a.name}.${p.name}`, p.fields]);
  }
  for (const v of ctx.valueObjects) out.push(["value object", v.name, v.fields]);
  for (const e of ctx.events) out.push(["event", e.name, e.fields]);
  // A synthesized `<Agg>Wire` mirrors its aggregate's fields — already reported
  // on the aggregate itself.
  for (const p of ctx.payloads) if (!p.synthesized) out.push(["payload", p.name, p.fields]);
  return out;
}

export function validateReservedFieldNames(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const elixirContexts = new Set<string>();
  for (const dep of sys.deployables) {
    if (platformFamily(dep.platform) === "elixir") {
      for (const c of dep.contextNames) elixirContexts.add(c);
    }
  }
  for (const m of sys.subdomains) {
    for (const ctx of m.contexts) {
      // One diagnostic per (record, field): an event is also reachable as a
      // same-named payload, which would otherwise report the field twice.
      const seen = new Set<string>();
      for (const [what, owner, fields] of fieldHolders(ctx)) {
        for (const f of fields) {
          if (!DUNDER.test(f.name)) continue;
          const key = `${owner}/${f.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          diags.push({
            severity: "error",
            message: diagMessage("loom.dunder-field-name", {
              what,
              owner,
              name: f.name,
              ctxName: ctx.name,
            }),
            source: `${sys.name}/${ctx.name}/${owner}`,
            code: "loom.dunder-field-name",
          });
        }
      }
      if (!elixirContexts.has(ctx.name)) continue;
      for (const a of ctx.aggregates) {
        // Only a RELATIONAL owner gives its parts table-backed schemas with
        // `timestamps()`; an embedded / document owner folds them into an
        // `embedded_schema` with no timestamp fields.
        const enriched = a as EnrichedAggregateIR;
        const shape = effectiveSavingShape(enriched, resolveDataSourceConfig(enriched, ctx, sys));
        if (shape !== "relational") continue;
        for (const p of a.parts) {
          for (const f of p.fields) {
            if (f.name === "createdAt" || f.name === "updatedAt") continue;
            const column = snake(f.name);
            if (column !== "inserted_at" && column !== "updated_at") continue;
            diags.push({
              severity: "error",
              message: diagMessage("loom.elixir-part-timestamp-field", {
                owner: `${a.name}.${p.name}`,
                name: f.name,
                column,
                ctxName: ctx.name,
              }),
              source: `${sys.name}/${ctx.name}/${a.name}.${p.name}`,
              code: "loom.elixir-part-timestamp-field",
            });
          }
        }
      }
    }
  }
}
