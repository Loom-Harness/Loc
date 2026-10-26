import type { BoundedContextIR, TableRenameIntentIR } from "../types/loom-ir.js";

// ---------------------------------------------------------------------------
// What a migration table step (`Old -> New`, `A.Old -> B.New`) names.
//
// The step's new side is a bare name, not a cross-reference: it may be an
// aggregate, a workflow or a projection, declared in any file of the project.
// So it is resolved here, on demand, against the merged model's contexts —
// by the phase-⑦ check that reports a bad target and by the phase-⑨ builder
// that turns a good one into table renames.  Both read the same answer.
// ---------------------------------------------------------------------------

export type TableStepTargetKind = "aggregate" | "workflow" | "projection";

/** The live declaration a table step names, with its owning context. */
export interface TableStepTarget<C extends BoundedContextIR> {
  kind: TableStepTargetKind;
  ctx: C;
  name: string;
}

export type TableStepResolution<C extends BoundedContextIR> =
  | { ok: true; target: TableStepTarget<C> }
  /** The qualified form names a context the model does not declare. */
  | { ok: false; reason: "unknown-context"; context: string }
  /** No aggregate, workflow or projection of that name (in that context). */
  | { ok: false; reason: "missing" }
  /** More than one declaration answers to the name; `candidates` spells each
   *  as `<Context>.<Name> (<kind>)`. */
  | { ok: false; reason: "ambiguous"; candidates: string[] };

/** Resolve a table step's NEW side.  The unqualified form searches every
 *  context; the qualified form only `toContext`. */
export function resolveTableStepTarget<C extends BoundedContextIR>(
  contexts: readonly C[],
  step: Pick<TableRenameIntentIR, "to" | "toContext">,
): TableStepResolution<C> {
  let pool: readonly C[] = contexts;
  if (step.toContext !== undefined) {
    const ctx = contexts.find((c) => c.name === step.toContext);
    if (!ctx) return { ok: false, reason: "unknown-context", context: step.toContext };
    pool = [ctx];
  }
  const found: TableStepTarget<C>[] = [];
  for (const ctx of pool) {
    if (ctx.aggregates.some((a) => a.name === step.to))
      found.push({ kind: "aggregate", ctx, name: step.to });
    if (ctx.workflows.some((w) => w.name === step.to))
      found.push({ kind: "workflow", ctx, name: step.to });
    if (ctx.projections.some((p) => p.name === step.to))
      found.push({ kind: "projection", ctx, name: step.to });
  }
  if (found.length === 0) return { ok: false, reason: "missing" };
  if (found.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates: found.map((t) => `${t.ctx.name}.${t.name} (${t.kind})`),
    };
  }
  return { ok: true, target: found[0]! };
}

/** The context the step's OLD side lived in: the named one on the move form,
 *  the target's own on a rename in place. */
export function tableStepFromContext(
  step: Pick<TableRenameIntentIR, "fromContext">,
  target: TableStepTarget<BoundedContextIR>,
): string {
  return step.fromContext ?? target.ctx.name;
}
