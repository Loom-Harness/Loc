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

import type { EnumIR, TypeIR } from "../../ir/types/loom-ir.js";

/** A backend-zero Elixir literal for a required saga column at allocation.
 *  An enum's zero is its FIRST member (the seed every other backend writes);
 *  `nil` there inserted the fresh saga row into a NOT NULL column and 500'd
 *  before the create body's assignment reached it (wave C3 D6). */
export function stateDefault(t: TypeIR, enums: readonly EnumIR[] = []): string {
  if (t.kind === "enum") {
    const first = enums.find((e) => e.name === t.name)?.values[0];
    return first ? `:${first}` : "nil";
  }
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
  return "nil";
}
