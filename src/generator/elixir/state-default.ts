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

import type { EnumIR, TypeIR, ValueObjectIR } from "../../ir/types/loom-ir.js";
import { snake } from "../../util/naming.js";

/** The declarations a zero value is built from — the hosting context. */
export interface StateDefaultDecls {
  readonly valueObjects?: readonly ValueObjectIR[];
  readonly enums?: readonly EnumIR[];
}

/** A backend-zero Elixir literal for a required saga column at allocation.
 *
 *  Every required state field is a NOT NULL column, so a `nil` here fails the
 *  allocating `Repo.insert!` before the body ever runs.  A value-object field
 *  is ONE `:map` column (the state-table migration collapses its flattened
 *  leaves), so it zeroes to a map of its own fields' zeroes — the shape the
 *  body's `Money { … }` construction writes.  An enum is a `:text` column
 *  holding the declared value, so it zeroes to its FIRST declared value (the
 *  column's enum CHECK rejects `""`).  An undeclared name still falls back to
 *  `nil`. */
export function stateDefault(
  t: TypeIR,
  decls: StateDefaultDecls = {},
  seen: ReadonlySet<string> = new Set(),
): string {
  if (t.kind === "primitive") {
    switch (t.name) {
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
      default:
        return '""';
    }
  }
  if (t.kind === "array") return "[]";
  if (t.kind === "enum") {
    const first = decls.enums?.find((e) => e.name === t.name)?.values[0];
    return first === undefined ? "nil" : JSON.stringify(first);
  }
  if (t.kind === "valueobject" && !seen.has(t.name)) {
    const vo = decls.valueObjects?.find((v) => v.name === t.name);
    if (!vo) return "nil";
    const inner = new Set([...seen, t.name]);
    const entries = vo.fields.map(
      (f) =>
        `${snake(f.name)}: ${f.optional || f.type.kind === "optional" ? "nil" : stateDefault(f.type, decls, inner)}`,
    );
    return `%{${entries.join(", ")}}`;
  }
  return "nil";
}
