import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { walkExprDeep } from "../../ir/util/walk.js";
import { bodyTypeOf } from "../../util/expr-body-type.js";
import { INT32_MAX, INT32_MIN, LONG_SAFE_MAX, LONG_SAFE_MIN } from "../../util/numeric-range.js";
import type { BinaryExpr, UnaryExpr } from "./target.js";

// ---------------------------------------------------------------------------
// Checked integer arithmetic (RS-48).
//
// Domain code that leaves the declared range of its integral type — int32 for
// `int`, int64 for `long` — answers the domain floor's 422 with
// `INTEGER_OVERFLOW_DETAIL`; it never wraps and never faults.  This module is
// the ONE place that decides WHICH nodes are checked, so the five backends'
// leaf tables agree on the set; each backend only chooses how to spell the
// check (`Math.addExact`, `checked(...)`, a range guard).
// ---------------------------------------------------------------------------

export type IntegralKind = "int" | "long";

function integralOf(t: TypeIR | undefined): IntegralKind | null {
  return t?.kind === "primitive" && (t.name === "int" || t.name === "long") ? t.name : null;
}

/** True when the expression is built from literals alone, whose arithmetic the
 *  compiler folds. */
function isConstant(e: ExprIR): boolean {
  let constant = true;
  walkExprDeep(e, (n) => {
    if (n.kind !== "literal" && n.kind !== "paren" && n.kind !== "unary" && n.kind !== "binary") {
      constant = false;
    }
  });
  return constant;
}

/** The integral kind a binary `+ - *` must be range-checked at, or null when
 *  the node is not integer arithmetic (money / decimal / string / temporal,
 *  comparison, division — which widens to decimal) or is a constant. */
export function checkedBinaryKind(e: BinaryExpr): IntegralKind | null {
  if (e.op !== "+" && e.op !== "-" && e.op !== "*") return null;
  const l = integralOf(e.leftType);
  const r = integralOf(e.rightType);
  if (l === null || r === null) return null;
  if (isConstant(e.left) && isConstant(e.right)) return null;
  return l === "long" || r === "long" ? "long" : "int";
}

/** The integral kind a unary `-` must be range-checked at (`-int32.MIN`). */
export function checkedUnaryKind(e: UnaryExpr): IntegralKind | null {
  if (e.op !== "-") return null;
  if (isConstant(e.operand)) return null;
  return integralOf(bodyTypeOf(e.operand));
}

/** The declared range a backend with unbounded or 64-bit integers enforces:
 *  int32 for `int`, int64 for `long`.  (node bounds `long` at the safe-integer
 *  ceiling instead, `integralWireRange`.) */
export const DECLARED_INT_RANGE: Record<
  IntegralKind,
  { min: number | bigint; max: number | bigint }
> = {
  int: { min: INT32_MIN, max: INT32_MAX },
  long: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
};

/** node's range: `long` is bounded at the safe-integer ceiling, past which a JS
 *  `number` has already lost precision (D-LONG-AVG-DEFAULTS). */
export const NODE_INT_RANGE: Record<IntegralKind, { min: number; max: number }> = {
  int: { min: INT32_MIN, max: INT32_MAX },
  long: { min: LONG_SAFE_MIN, max: LONG_SAFE_MAX },
};
