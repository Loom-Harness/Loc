import type { ContextStampIR } from "../types/loom-ir.js";

/** Every field any lifecycle stamp writes — `onCreate` AND `onUpdate`.
 *
 *  Both events count, and the `onUpdate` half is not laxity: `auditable`
 *  stamps `createdAt`/`createdBy` onCreate and `updatedAt`/`updatedBy`
 *  onUpdate, and the backends apply the stamp set at PERSIST time, so the
 *  very first insert writes the update columns too.  Keying on
 *  `event === "create"` alone would reject every `with auditable` aggregate in
 *  the repo. */
export function stampedFields(agg: {
  contextStamps?: readonly ContextStampIR[];
}): ReadonlySet<string> {
  return new Set((agg.contextStamps ?? []).flatMap((s) => s.assignments.map((a) => a.field)));
}
