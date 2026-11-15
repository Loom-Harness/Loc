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
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, FieldIR, SystemIR } from "../../types/loom-ir.js";
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
  // A synthesized generic / union payload has compiler-chosen fields, never an author's.
  for (const p of ctx.payloads) if (!p.synthesized) out.push(["payload", p.name, p.fields]);
  return out;
}

export function validateReservedFieldNames(sys: SystemIR, diags: LoomDiagnostic[]): void {
  for (const m of sys.subdomains) {
    for (const ctx of m.contexts) {
      // One diagnostic per (record, field): an event is also reachable as a
      // same-named payload, which would otherwise report the field twice.
      const seen = new Set<string>();
      // A contract record (`command` / `query` / `response`) copies the fields
      // of the aggregate or part it describes — every exposed context carries
      // one per aggregate — so a field already reported on a domain record is
      // not reported again on the contract that mirrors it.
      const domainFields = new Set<string>();
      const contract = new Set(
        ctx.payloads
          .filter((p) => p.kind === "command" || p.kind === "query" || p.kind === "response")
          .map((p) => p.name),
      );
      for (const [what, owner, fields] of fieldHolders(ctx)) {
        for (const f of fields) {
          if (!DUNDER.test(f.name)) continue;
          const key = `${owner}/${f.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (what === "aggregate" || what === "entity part") domainFields.add(f.name);
          else if (what === "payload" && contract.has(owner) && domainFields.has(f.name)) continue;
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
    }
  }
}
