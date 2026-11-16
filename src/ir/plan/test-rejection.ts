// What a `toThrow` assertion in a generated unit or context-integration test
// accepts.
//
// `expect(<call>).toThrow()` asserts that the domain floor refused the call:
// a `precondition`, an aggregate, part or value-object `invariant`, an
// operation's `when` state gate, or a `requires` left in the operation body.
// Nothing else counts, in either tier: an assertion that accepted any error
// would pass on a `TypeError` / `NameError` out of broken generated code.
// `toThrow(<rung>)` narrows the set to the one rung, read from the error's
// structural kind, never its message.
//
// A declared error an operation RETURNS (`operation close(): string or Closed`)
// is not a throw: the call answers it as a value, on every backend.  A
// `toThrow` over a call that can only answer that way asserts nothing a test
// can observe (`throwOnlyReturns`), and is refused at validation.
//
// Which exception class each rung raises is the language's leaf table
// (`src/generator/_test/throw-kind.ts`).

import type { ThrowKindName } from "../../util/intrinsic-matchers.js";
import type { AggregateIR, ExprIR, OperationIR, TypeIR } from "../types/loom-ir.js";
import { walkStmtExprsDeep, walkStmtsDeep } from "../util/walk.js";

/** Every way the in-process domain floor refuses a call. */
export const FLOOR_RUNGS = ["precondition", "invariant", "state-gate", "requires"] as const;
export type FloorRung = (typeof FLOOR_RUNGS)[number];

/** One `toThrow` assertion, decided. */
export type RejectionPlan =
  /** Any rung of the domain floor. */
  | { accepts: "floor"; rungs: readonly FloorRung[]; call: ExprIR }
  /** The named rung only. */
  | { accepts: "rung"; rung: ThrowKindName; call: ExprIR };

/** The plan for an `expect(<call>).toThrow(…)` statement, in either tier. */
export function rejectionPlan(s: { expr: ExprIR; throwKind?: ThrowKindName }): RejectionPlan {
  const call = s.expr.kind === "paren" ? s.expr.inner : s.expr;
  if (s.throwKind !== undefined) return { accepts: "rung", rung: s.throwKind, call };
  // A value object declares invariants and nothing else.
  const rungs =
    call.kind === "call" && call.callKind === "value-object-ctor"
      ? (["invariant"] as const)
      : FLOOR_RUNGS;
  return { accepts: "floor", rungs, call };
}

/** Can `op` refuse a call before its invariants are checked: a `when` state
 *  gate, or a `precondition` / `requires` reachable from its body — directly,
 *  nested, or through a private operation it calls, as a statement or an
 *  expression.  Conservative on an unresolvable private call: it answers true.
 *  A bare `toThrow()` over an operation that cannot can only mean an invariant
 *  rejection. */
function operationMayRejectBeforeInvariants(
  op: OperationIR | undefined,
  agg: Pick<AggregateIR, "operations">,
  seen: Set<string> = new Set(),
): boolean {
  if (!op || seen.has(op.name)) return false;
  seen.add(op.name);
  if (op.when !== undefined) return true;
  const callee = (name: string): boolean => {
    const target = agg.operations.find((o) => o.name === name);
    return !target || operationMayRejectBeforeInvariants(target, agg, seen);
  };
  let found = false;
  for (const top of op.statements) {
    walkStmtsDeep(top, (s) => {
      if (s.kind === "precondition" || s.kind === "requires") found = true;
      if (s.kind === "call" && s.target === "private-operation" && callee(s.name)) found = true;
      walkStmtExprsDeep(s, (e) => {
        if (e.kind === "call" && e.callKind === "private-operation" && callee(e.name)) found = true;
      });
    });
  }
  return found;
}

/** Does a `toThrow` over a call of `op` assert an invariant rejection: the
 *  `invariant` rung, or a bare `toThrow()` over an operation that cannot refuse
 *  before its invariants run. */
export function rejectionNeedsInvariant(
  plan: RejectionPlan,
  op: OperationIR | undefined,
  agg: Pick<AggregateIR, "operations">,
): boolean {
  if (plan.accepts === "rung") return plan.rung === "invariant";
  return !operationMayRejectBeforeInvariants(op, agg);
}

/** The declared errors `op` answers by returning them: the `error` arms of its
 *  return type. */
export function returnedErrorArms(op: Pick<OperationIR, "returnType">): string[] {
  const t = op.returnType;
  const arms: readonly TypeIR[] = t === undefined ? [] : t.kind === "union" ? t.variants : [t];
  return arms.flatMap((v) => (v.kind === "entity" && v.declKind === "error" ? [v.name] : []));
}

/** True when a `toThrow` over a call of `op` can only be about an error the
 *  operation returns: it returns a declared error, and nothing on its path
 *  throws — no `when` gate, no `precondition`, no `requires`.  A value-returning
 *  operation checks no invariant floor on any backend, so an invariant is not a
 *  path to a throw here. */
export function throwOnlyReturns(op: OperationIR, agg: Pick<AggregateIR, "operations">): boolean {
  return returnedErrorArms(op).length > 0 && !operationMayRejectBeforeInvariants(op, agg);
}
