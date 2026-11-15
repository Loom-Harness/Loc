// `loom.requires-not-leading` — a `requires` the gate ladder cannot see.
//
// Only an operation body's LEADING run of `requires` statements is hoisted
// into the route's gate ladder (`splitLeadingGates`, `src/ir/util/op-gates.ts`;
// `src/ir/plan/gate-ladder.ts`).  A `requires` further down stays in the domain
// method: it runs after the load, the `If-Match` check and `when`, so a caller
// it refuses sees 404 for a missing id and 409 for a stale version or a
// wrong-state row before it sees its 403 — the oracle the ladder exists to
// remove.  That placement is the language's rule (the later `requires` may
// read a `let` or a field an earlier statement assigned), so it is not
// rewritten; but a `requires` that reads neither the row nor a local reads
// nothing an earlier statement can change, so moving it into the leading run
// keeps its meaning and puts it on the ladder.  This warns on exactly that
// shape (`misplacedGates`, `src/ir/plan/gate-ladder.ts`).

import { diagMessage } from "../../../diagnostics/messages.js";
import { misplacedGates } from "../../plan/gate-ladder.js";
import type { EnrichedSystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateRequiresPlacement(sys: EnrichedSystemIR, diags: LoomDiagnostic[]): void {
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      for (const agg of ctx.aggregates) {
        for (const op of agg.operations) {
          if (op.visibility === "private") continue;
          for (const s of misplacedGates(op)) {
            diags.push({
              severity: "warning",
              code: "loom.requires-not-leading",
              message: diagMessage("loom.requires-not-leading", {
                aggregate: agg.name,
                op: op.name,
                gate: s.source,
              }),
              source: `${ctx.name}/${agg.name}`,
              origin: s.origin ?? op.origin ?? agg.origin,
            });
          }
        }
      }
    }
  }
}
