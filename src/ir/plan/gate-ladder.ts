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

import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  OperationIR,
  TypeIR,
} from "../types/loom-ir.js";
import { isMergePatchUpdate } from "../util/merge-patch.js";
import {
  gateReadsParam,
  gateReadsRow,
  gateRungs,
  lifecycleGates,
  operationGates,
  type RequiresStmtIR,
  splitLeadingGates,
} from "../util/op-gates.js";
import { mapExprChildren, walkExprDeep } from "../util/walk.js";

export { gateReadsParam, gateReadsRow } from "../util/op-gates.js";

import { type PolymorphicReadGate, polymorphicReadGates } from "./repo-polymorphic.js";

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

/** An operation's gates on their rungs around the load (`gateRungs`). */
function rungsOf(
  gates: readonly RequiresStmtIR[],
): ({ step: "requires" | "row-requires"; gate: RequiresStmtIR } | { step: "load" })[] {
  const { preLoad, postLoad } = gateRungs(gates);
  return [
    ...preLoad.map((gate) => ({ step: "requires" as const, gate })),
    { step: "load" as const },
    ...postLoad.map((gate) => ({ step: "row-requires" as const, gate })),
  ];
}

/** The ordered checks a route renders around an operation on a loaded row:
 *  the row-independent `requires` gates, the load, the row-reading gates,
 *  the version check (when the route reads `If-Match`), then `when`.  A
 *  merge-patch `update` (RS-47) partitions its gates by
 *  {@link mergePatchUpdateLadder}: a gate that reads a parameter reads the
 *  merged value, so it runs after the load like a row-reading one. */
export function operationLadder(op: OperationIR, opts: { readsIfMatch: boolean }): GateCheck[] {
  const gates = operationGates(op);
  return [
    ...(isMergePatchUpdate(op) ? mergePatchUpdateLadder(gates) : [...rungsOf(gates)]),
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
    ...rungsOf(decided),
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
  return [...rungsOf(gates), ...(opts.readsIfMatch ? [{ step: "version" as const }] : [])];
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

/** One check the polymorphic base read (`GET /api/<bases>`, TPH `/{id}`)
 *  renders, at its rung. */
export type ReadCheck = { step: "requires"; gate: PolymorphicReadGate } | { step: "load" };

/** The ordered checks the polymorphic base read renders: every concrete's
 *  list-read gate, in variant order, then the load.  Each gate reads the
 *  principal only (a list read has no row to read), so a caller one refuses
 *  gets that concrete's 403 whatever rows exist; a TPH by-id read runs the same
 *  gates before its load, so a missing id is 404 only for a caller every gate
 *  admits. */
export function readLadder(
  base: AggregateIR,
  ctx: Pick<BoundedContextIR, "aggregates" | "repositories">,
): ReadCheck[] {
  return [
    ...polymorphicReadGates(base, ctx).map((gate) => ({ step: "requires" as const, gate })),
    { step: "load" },
  ];
}

/** The gates a read ladder renders before its load, in order. */
export function readLadderGates(ladder: readonly ReadCheck[]): PolymorphicReadGate[] {
  return ladder.flatMap((c) => (c.step === "requires" ? [c.gate] : []));
}

/** The `requires` statements of `op` that sit outside its ladder although
 *  nothing before them can change their answer: top-level statements past the
 *  leading run that read no row and no `let`.  Each runs in the domain method,
 *  after the load, `If-Match` and `when`; moved into the leading run, it keeps
 *  its meaning and runs on the ladder (`loom.requires-not-leading`). */
export function misplacedGates(op: OperationIR): RequiresStmtIR[] {
  return splitLeadingGates(op.statements).body.filter(
    (s): s is RequiresStmtIR =>
      s.kind === "requires" && s.maskWriteOf === undefined && !gateReadsRow(s) && !readsLet(s),
  );
}

function readsLet(g: RequiresStmtIR): boolean {
  let reads = false;
  walkExprDeep(g.expr, (e) => {
    if (e.kind === "ref" && e.refKind === "let") reads = true;
  });
  return reads;
}

/** One `requires` check a domain unit test runs at an operation call. */
export interface UnitGateCheck {
  /** The gate's predicate, bound to the call: `this` and its fields read the
   *  call's receiver, each parameter is the call's argument for it.  A
   *  `currentUser` read stays a `current-user` ref, which the test framework
   *  renders as its test principal. */
  cond: ExprIR;
  gate: RequiresStmtIR;
}

/** The `requires` gates a domain unit test checks at a call of `op`: the
 *  route's row-independent rung, then its row-reading rung, in ladder order.
 *  The route runs these before the domain method; the method runs only the
 *  gates left in its body.  A unit test calls the method directly, so it runs
 *  the route's gates itself, against the test principal: the default
 *  principal holds every permission and passes, an `as { … }` principal is
 *  refused exactly as over HTTP (D-GENERATED-TESTS). */
export function unitTestGateChecks(
  op: OperationIR,
  call: { receiver: ExprIR; receiverType: TypeIR; args: readonly ExprIR[] },
): UnitGateCheck[] {
  const ladder = operationLadder(op, { readsIfMatch: false });
  const gates = [...ladderGates(ladder, "requires"), ...ladderGates(ladder, "row-requires")];
  const argFor = new Map(op.params.map((p, i) => [p.name, call.args[i]] as const));
  const bind = (e: ExprIR): ExprIR => {
    if (e.kind === "this") return call.receiver;
    if (e.kind === "id") {
      return {
        kind: "member",
        receiver: call.receiver,
        member: "id",
        receiverType: call.receiverType,
        memberType: { kind: "id", targetName: typeName(call.receiverType) },
      };
    }
    if (e.kind === "ref") {
      if (e.refKind === "param") {
        const arg = argFor.get(e.name);
        if (arg) return arg;
      }
      if ((e.refKind === "this-prop" || e.refKind === "this-derived") && e.type) {
        return {
          kind: "member",
          receiver: call.receiver,
          member: e.name,
          receiverType: call.receiverType,
          memberType: e.type,
        };
      }
    }
    return mapExprChildren(e, bind);
  };
  return gates.map((gate) => ({ cond: bind(gate.expr), gate }));
}

function typeName(t: TypeIR): string {
  return t.kind === "entity" ? t.name : "";
}
