// -------------------------------------------------------------------------
// Implicit model-text owner ambiguity (`loom.model-text-implicit-ambiguous`).
//
// An explicit `label(X)` over a type two contexts declare is rejected until the
// author qualifies it.  The implicit sites — a form field's label, an enum
// option, a submit button — have nobody to ask, so they must not quietly pick
// one: a context that REFERENCES a value object or enum it does not declare
// (legal across contexts) while two or more other contexts declare that name
// has no single catalog key for it.  This check reports that reference, so the
// implicit path and the explicit one agree.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, SystemIR, TypeIR } from "../../types/loom-ir.js";
import { modelTextFallbackOwners } from "../../util/model-text-owner.js";
import { collectReachableTypes, valueObjectPool } from "../../util/reachable-types.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The types a context's forms read their labels from: field types of its
 *  aggregates and parts, operation parameters and workflow parameters. */
function seedTypes(ctx: BoundedContextIR): TypeIR[] {
  const out: TypeIR[] = [];
  for (const a of ctx.aggregates) {
    for (const f of a.fields) out.push(f.type);
    for (const p of a.parts ?? []) for (const f of p.fields) out.push(f.type);
    for (const op of a.operations) for (const p of op.params) out.push(p.type);
  }
  for (const w of ctx.workflows) for (const p of w.params) out.push(p.type);
  return out;
}

export function validateModelTextOwners(sys: SystemIR, diags: LoomDiagnostic[]): void {
  if (sys.uis.length === 0) return;
  const contexts = sys.subdomains.flatMap((s) => s.contexts);
  for (const ctx of contexts) {
    const reached = collectReachableTypes(seedTypes(ctx), [...valueObjectPool(ctx)]);
    const names = [...reached.valueObjects, ...reached.enums].sort();
    for (const name of names) {
      const owners = modelTextFallbackOwners(name, ctx, contexts);
      if (owners.length < 2) continue;
      diags.push({
        severity: "error",
        code: "loom.model-text-implicit-ambiguous",
        source: `${sys.name}/${ctx.name}`,
        message: diagMessage("loom.model-text-implicit-ambiguous", {
          type: name,
          ctxName: ctx.name,
          owners: owners.join(", "),
        }),
      });
    }
  }
}
