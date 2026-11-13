// Write-time reference admission (docs/tenancy.md → "Reference admission").
//
// A persisted `X id` whose target is tenant-scoped (`tenantOwned`, or the
// tenancy registry) resolves in the row's tenant before the write; the plan
// (`src/ir/plan/ref-scope.ts`) decides the scope.  A target with no table
// beside the row — an aggregate of another context — leaves nothing to probe,
// so the reference is stored unchecked.  That is reported here rather than
// left silent.

import { diagMessage } from "../../../diagnostics/messages.js";
import { scopedReferences } from "../../plan/ref-scope.js";
import type { AggregateIR, SystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateRefScopes(sys: SystemIR, diags: LoomDiagnostic[]): void {
  if (!sys.tenancy) return;
  const all = new Map<string, AggregateIR>();
  const home = new Map<string, string>();
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      for (const a of ctx.aggregates) {
        all.set(a.name, a);
        home.set(a.name, ctx.name);
      }
    }
  }
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      for (const agg of ctx.aggregates) {
        for (const ref of scopedReferences(agg, ctx.aggregates, (n) => all.get(n))) {
          if (ref.scope !== "unresolvable") continue;
          const owner = ref.part ?? agg.name;
          diags.push({
            severity: "warning",
            code: "loom.tenancy-ref-unresolvable",
            message: diagMessage("loom.tenancy-ref-unresolvable", {
              owner,
              field: ref.field,
              target: ref.target,
              context: ctx.name,
              targetContext: home.get(ref.target) ?? "?",
            }),
            source: `${ctx.name}/aggregate ${agg.name}.${ref.part ? `${ref.part}.` : ""}${ref.field}`,
            ...(agg.origin ? { origin: agg.origin } : {}),
          });
        }
      }
    }
  }
}
