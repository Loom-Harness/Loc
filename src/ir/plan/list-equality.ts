// `==` / `!=` between two lists — decided once (ruling 456: element by
// element, in order; equal when the lengths match and every pair of elements
// is equal).
//
// What "equal elements" means is the element type's own value equality: a
// money or decimal by value whatever its scale, a datetime by instant, a value
// object field by field.  A target spells the comparison in its own idiom and
// only needs to know which of those the elements take; whether its host `==`
// on a list already does that is the target's own representation question.

import type { ExprIR, TypeIR } from "../types/loom-ir.js";

type BinaryExpr = Extract<ExprIR, { kind: "binary" }>;

/** How two elements of a list compare. */
export type ElementEquality =
  /** The host's `==` on the element already compares by value (string, an
   *  integer, bool, an enum, an id). */
  | "host"
  /** money / decimal: by value, scale-agnostic (`10` equals `10.00`). */
  | "decimal"
  /** datetime / date: by the instant or day. */
  | "instant"
  /** A value object: field by field. */
  | "value-object";

export interface ListEqualityPlan {
  readonly element: ElementEquality;
  /** The element is `money` (a target whose money and decimal differ in
   *  representation reads this). */
  readonly money: boolean;
  readonly leftOptional: boolean;
  readonly rightOptional: boolean;
}

function elementOf(t: TypeIR | undefined): TypeIR | undefined {
  const inner = t?.kind === "optional" ? t.inner : t;
  return inner?.kind === "array" ? inner.element : undefined;
}

function elementEquality(t: TypeIR): ElementEquality {
  const inner = t.kind === "optional" ? t.inner : t;
  if (inner.kind === "valueobject") return "value-object";
  if (inner.kind === "primitive") {
    if (inner.name === "money" || inner.name === "decimal") return "decimal";
    if (inner.name === "datetime" || inner.name === "date") return "instant";
  }
  return "host";
}

/** The list comparison a `==` / `!=` node is, or undefined when it does not
 *  compare two lists (a `null` literal side is a presence test, not this). */
export function listEqualityPlan(e: BinaryExpr): ListEqualityPlan | undefined {
  if (e.op !== "==" && e.op !== "!=") return undefined;
  const isNull = (x: ExprIR | undefined) => x?.kind === "literal" && x.lit === "null";
  if (isNull(e.left) || isNull(e.right)) return undefined;
  const le = elementOf(e.leftType);
  const re = elementOf(e.rightType);
  if (le === undefined || re === undefined) return undefined;
  const inner = le.kind === "optional" ? le.inner : le;
  return {
    element: elementEquality(le),
    money: inner.kind === "primitive" && inner.name === "money",
    leftOptional: e.leftType?.kind === "optional",
    rightOptional: e.rightType?.kind === "optional",
  };
}
