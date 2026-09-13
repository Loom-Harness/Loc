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

import type { TypeIR } from "../../ir/types/loom-ir.js";

/** A backend-zero Elixir literal for a required saga column at allocation. */
export function stateDefault(t: TypeIR): string {
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
