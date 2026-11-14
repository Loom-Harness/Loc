// The gate ladder: the one order in which every backend refuses a request
// that addresses an aggregate row (docs/auth.md → "Gate order").
//
//   1. authn                                       401
//   2. request shape (framework binding)           422
//   3. `requires` that reads no row                403
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
// `GET /{id}/can_<op>` runs the same ladder (steps 1, 3–5, 7; no body, no
// `If-Match`) and answers `{ allowed }`: the operation's own `requires` gates
// and its `when` fold into `allowed`, before and after the load alike.  A row
// it cannot read is still 404, and a caller the by-id read's gate refuses is
// still 403, exactly as `GET /{id}` answers.
//
// Steps 1, 2 and 8 are the framework's and the domain method's: a body that
// does not bind is refused before any handler runs, on every backend.  A
// backend renders the checks this plan lists (3–7) in the listed order, and
// takes the gates of each rung from `ladderGates` — it never re-partitions a
// gate list itself (`test/system/gate-ladder-census.test.ts`).

import type { OperationIR } from "../types/loom-ir.js";
import { lifecycleGates, operationGates, type RequiresStmtIR } from "../util/op-gates.js";
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
  "shape",
  "requires",
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

/** One check `GET /{id}/can_<op>` renders, at its rung. */
export type CanCheck =
  | { step: "requires" | "row-requires"; gate: RequiresStmtIR }
  | { step: "load" }
  | { step: "undecided" }
  | { step: "when" };

/** The checks `GET /{id}/can_<op>` renders: the operation's ladder without the
 *  version check (a probe carries no `If-Match`).  A `requires` rung answers
 *  `{ allowed: false }` when its gate refuses — it does not 403 — so the probe
 *  tells a caller whether it may run the operation, not why.  A gate that reads
 *  an operation parameter cannot be decided without a body: such a gate is
 *  dropped from its rung and the probe answers `{ allowed: false }` at the
 *  `undecided` rung, after the load so a missing row is still 404.  Only a
 *  decidable probe reaches `when`, which folds into `allowed`. */
export function canOpLadder(op: OperationIR): CanCheck[] {
  const gates = operationGates(op);
  const decided = gates.filter((g) => !gateReadsParam(g));
  const undecided = decided.length < gates.length;
  return [
    ...decided.filter((g) => !gateReadsRow(g)).map((gate) => ({ step: "requires" as const, gate })),
    { step: "load" },
    ...decided.filter(gateReadsRow).map((gate) => ({ step: "row-requires" as const, gate })),
    ...(undecided ? [{ step: "undecided" as const }] : op.when ? [{ step: "when" as const }] : []),
  ];
}

/** The `requires` gates a ladder renders at one rung, in order. */
export function ladderGates(
  ladder: readonly (GateCheck | CanCheck)[],
  step: "requires" | "row-requires",
): RequiresStmtIR[] {
  return ladder.flatMap((c) => (c.step === step ? [c.gate] : []));
}

/** True when a `can_<op>` probe answers `{ allowed: false }` at its
 *  `undecided` rung, whatever the row holds. */
export function probeUndecided(ladder: readonly CanCheck[]): boolean {
  return ladder.some((c) => c.step === "undecided");
}

/** The ordered checks a canonical `DELETE /{id}` renders: the destroy's
 *  row-independent `requires` gates, the load, the row-reading gates, then the
 *  version check (when the route reads `If-Match`).  A destroy has no `when`. */
export function destroyLadder(
  destroy: OperationIR | null | undefined,
  opts: { readsIfMatch: boolean },
): GateCheck[] {
  const gates = lifecycleGates(destroy);
  return [
    ...gates.filter((g) => !gateReadsRow(g)).map((gate) => ({ step: "requires" as const, gate })),
    { step: "load" },
    ...gates.filter(gateReadsRow).map((gate) => ({ step: "row-requires" as const, gate })),
    ...(opts.readsIfMatch ? [{ step: "version" as const }] : []),
  ];
}

/** The ordered checks the generic merge-patch `update` seam renders around
 *  `gates` (the operation's `requires` plus its `mask unless` write gates): a
 *  gate that reads neither the row nor a parameter runs before the load; a
 *  parameter gate reads the MERGED value (the stored one when the body omits
 *  the key) and a mask write gate runs only when the body carries its key, so
 *  both run after the load, on the merged row. */
export function mergePatchUpdateLadder(gates: readonly RequiresStmtIR[]): GateCheck[] {
  const preLoad = (g: RequiresStmtIR): boolean =>
    g.maskWriteOf === undefined && !gateReadsRow(g) && !gateReadsParam(g);
  return [
    ...gates.filter(preLoad).map((gate) => ({ step: "requires" as const, gate })),
    { step: "load" },
    ...gates.filter((g) => !preLoad(g)).map((gate) => ({ step: "row-requires" as const, gate })),
  ];
}

/** True when a `requires` gate reads the addressed row — a field, a value
 *  object member of one, a derived, or a call to one of the aggregate's own
 *  functions / operations (every backend renders it on the loaded instance,
 *  whatever the callee's body reads) — so it can only run after the load. */
export function gateReadsRow(g: RequiresStmtIR): boolean {
  let reads = false;
  walkExprDeep(g.expr, (e) => {
    if (
      e.kind === "this" ||
      (e.kind === "ref" &&
        (e.refKind === "this-prop" ||
          e.refKind === "this-vo-prop" ||
          e.refKind === "this-derived")) ||
      (e.kind === "call" && (e.callKind === "function" || e.callKind === "private-operation"))
    ) {
      reads = true;
    }
  });
  return reads;
}

/** True when a `requires` gate reads an operation parameter.  A
 *  `can_<op>` probe carries no body, so such a gate cannot be decided there:
 *  the probe answers `{ allowed: false }` for it. */
export function gateReadsParam(g: RequiresStmtIR): boolean {
  let reads = false;
  walkExprDeep(g.expr, (e) => {
    if (e.kind === "ref" && e.refKind === "param") reads = true;
  });
  return reads;
}
