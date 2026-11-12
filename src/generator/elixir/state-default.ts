// ---------------------------------------------------------------------------
// The backend-zero Elixir literal for a required saga-state column at
// allocation (the correlation field is seeded from the routing key, never
// this).
//
// A LEAF on purpose.  Both entry points that allocate a fresh saga instance
// need it — the event-triggered starter (`dispatch-emit.ts`) and the
// command-triggered `create` route (`vanilla/workflow-execution-emit.ts`, F58)
// — and `dispatch-emit.ts` already imports FROM `workflow-execution-emit.ts`,
// so hanging it off either of those would close an import cycle.
// ---------------------------------------------------------------------------

import { type StateZero, stateZero } from "../../ir/plan/index.js";
import type { BoundedContextIR, EnumIR, TypeIR, ValueObjectIR } from "../../ir/types/loom-ir.js";
import { enumPool, valueObjectPool } from "../../ir/util/reachable-types.js";
import { snake } from "../../util/naming.js";

/** The declarations a zero value is built from — the hosting context. */
export interface StateDefaultDecls {
  readonly valueObjects?: readonly ValueObjectIR[];
  readonly enums?: readonly EnumIR[];
}

/** The decls a context's saga state resolves its field types against — the
 *  context's OWN enums / value objects PLUS the sibling-context ones a field
 *  may legally name (`enumPool` / `valueObjectPool`).  Passing the context
 *  itself would read only its own `.enums`, zeroing a sibling-enum state
 *  field to `nil` (claims D1). */
export function stateDefaultDecls(ctx: BoundedContextIR): StateDefaultDecls {
  return { enums: enumPool(ctx), valueObjects: valueObjectPool(ctx) };
}

/** A backend-zero Elixir literal for a required saga column at allocation.
 *
 *  Every required state field is a NOT NULL column, so a `nil` here fails the
 *  allocating `Repo.insert!` before the body ever runs.  A value-object field
 *  is ONE `:map` column (the state-table migration collapses its flattened
 *  leaves), so it zeroes to a map of its own fields' zeroes — the shape the
 *  body's `Money { … }` construction writes.  An enum's zero is its FIRST
 *  member as the declared-case ATOM, which the `Ecto.Enum` state field dumps
 *  to the declared string (the seed every other backend writes).  Without
 *  `decls` (the event-sourced fold seed) an enum or value object has no
 *  resolved zero and falls back to `nil`, as an undeclared name does. */
export function stateDefault(t: TypeIR, decls?: StateDefaultDecls): string {
  return exStateZero(
    stateZero(
      t,
      decls
        ? { enums: [...(decls.enums ?? [])], valueObjects: [...(decls.valueObjects ?? [])] }
        : undefined,
    ),
  );
}

function exStateZero(z: StateZero): string {
  switch (z.kind) {
    case "int":
    case "long":
      return "0";
    case "decimal":
    case "money":
      return "Decimal.new(0)";
    case "bool":
      return "false";
    case "datetime":
      return "DateTime.utc_now()";
    case "date":
      return "Date.utc_today()";
    case "json":
    case "text":
      return '""';
    case "array":
      return "[]";
    case "enum":
      return z.first === undefined ? "nil" : `:${z.first}`;
    case "valueobject":
      return z.fields
        ? `%{${z.fields.map((f) => `${snake(f.name)}: ${f.zero ? exStateZero(f.zero) : "nil"}`).join(", ")}}`
        : "nil";
    default:
      return "nil";
  }
}
