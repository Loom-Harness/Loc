// The gate ladder: the one order in which every backend refuses a request
// that addresses an aggregate row (docs/auth.md → "Gate order").
//
//   1. authn                                       401
//   2. `requires` that reads no row                403
//   3. request shape (framework binding)           422
//   4. load through the read scope                 404
//   5. `requires` that reads the row; write scope  403 / 404
//   6. version (`If-Match`)                        409
//   7. `when`                                      409
//   8. preconditions / invariants (the body)       409 / 422
//
// The order makes the refusals no oracle: a caller the row-independent gate
// refuses gets 403 for an existing id, a missing id, a stale `If-Match` and a
// wrong-state row alike; a row outside the read scope answers 404, never 403.
//
// `GET /{id}/can_<op>` runs the same ladder (steps 1, 2, 4–7, no body) and
// answers `{ allowed }` for the steps after the load: a row it cannot read is
// still 404, and a caller step 2 refuses is still 403.
//
// Steps 1, 3 and 8 are the framework's and the domain method's; a backend
// renders the checks this plan lists (2, 4, 5, 6, 7) in the listed order.

import type { OperationIR } from "../types/loom-ir.js";
import { operationGates, type RequiresStmtIR } from "../util/op-gates.js";
import { walkExprDeep } from "../util/walk.js";

/** One rung of the ladder. */
export type GateStep =
  | "authn"
  | "requires"
  | "shape"
  | "load"
  | "row-requires"
  | "version"
  | "when"
  | "domain";

/** The rungs in the order every backend evaluates them. */
export const GATE_ORDER: readonly GateStep[] = [
  "authn",
  "requires",
  "shape",
  "load",
  "row-requires",
  "version",
  "when",
  "domain",
];

/** The position of `step` in {@link GATE_ORDER}. */
export function gateRank(step: GateStep): number {
  return GATE_ORDER.indexOf(step);
}

/** One check a backend renders, at its rung. */
export type GateCheck =
  | { step: "requires" | "row-requires"; gate: RequiresStmtIR }
  | { step: "load" }
  | { step: "version" }
  | { step: "when" };

/** The ordered checks a route renders around an operation on a loaded row:
 *  the row-independent `requires` gates, the load, the row-reading gates,
 *  the version check (when the route reads `If-Match`), then `when`. */
export function operationLadder(op: OperationIR, opts: { readsIfMatch: boolean }): GateCheck[] {
  const gates = operationGates(op);
  return [
    ...gates.filter((g) => !gateReadsRow(g)).map((gate) => ({ step: "requires" as const, gate })),
    { step: "load" },
    ...gates.filter(gateReadsRow).map((gate) => ({ step: "row-requires" as const, gate })),
    ...(opts.readsIfMatch ? [{ step: "version" as const }] : []),
    ...(op.when ? [{ step: "when" as const }] : []),
  ];
}

/** The checks `GET /{id}/can_<op>` renders: the operation's ladder without the
 *  version check (a probe carries no `If-Match`).  The `requires` rungs refuse
 *  (403) exactly as the operation does; only `when` folds into `allowed`. */
export function canOpLadder(op: OperationIR): GateCheck[] {
  return operationLadder(op, { readsIfMatch: false });
}

/** True when a `requires` gate reads the addressed row — a field, a value
 *  object member of one, or a derived — so it can only run after the load. */
export function gateReadsRow(g: RequiresStmtIR): boolean {
  let reads = false;
  walkExprDeep(g.expr, (e) => {
    if (
      e.kind === "this" ||
      (e.kind === "ref" &&
        (e.refKind === "this-prop" || e.refKind === "this-vo-prop" || e.refKind === "this-derived"))
    ) {
      reads = true;
    }
  });
  return reads;
}
