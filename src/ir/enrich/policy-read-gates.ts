// Phase ⑥ — `policy { read X requires <expr> }` reaches every read of X.
//
// The policy rule is the ONE place an author says who may read an aggregate.
// Every backend already renders a read's gate from `FindIR.requires` — the list
// route, each find's route, the audit history read (copied from `all` by
// `ensureHistoryFind`) and the by-id route (taken from `all` by
// `byIdRouteFind`, `read-gates.ts`).  So the rule lowers into that carrier and
// no emitter learns a new field: this pass puts the gate on every
// author-declared find of X and on the compiler-injected list read `all`.
//
// Runs AFTER `ensureFindAll` (the injected `all` must exist to carry the gate)
// and BEFORE `ensureHistoryFind` (history copies `all`'s gate) and
// `applyDefaultDenyReads` (which stamps the deny gate only on an `all` that
// still has none).  Compiler-synthesised finds (the paged-run helpers a
// `queryHandler` mints) are not reads of their own — the handler's route and
// its own `requires` are the exposure — so they are left alone.

import type { PolicyReadGateIR, RepositoryIR } from "../types/loom-ir.js";

export function applyPolicyReadGates(
  repos: RepositoryIR[],
  gates: PolicyReadGateIR[] | undefined,
): RepositoryIR[] {
  if (!gates || gates.length === 0) return repos;
  // First rule wins; a second rule for the same aggregate is
  // `loom.policy-duplicate-target` in phase ⑦.
  const byAggregate = new Map<string, PolicyReadGateIR>();
  for (const g of gates) if (!byAggregate.has(g.aggregate)) byAggregate.set(g.aggregate, g);
  return repos.map((r) => {
    const rule = byAggregate.get(r.aggregateName);
    if (!rule) return r;
    return {
      ...r,
      finds: r.finds.map((f) =>
        f.synthesized ? f : { ...f, requires: structuredClone(rule.gate) },
      ),
    };
  });
}
