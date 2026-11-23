// `==` / `!=` on value objects — decided once (ruling 457): BY VALUE and
// ABSENCE-SAFE.  Two value objects are equal when all their fields are; two
// absent ones are equal; one absent and one present are not.  A target spells
// the field-wise comparison in its own idiom (a generated `equals`, record
// equality, a dataclass `__eq__`, `Loom.ValueObject.equal?`); a target whose
// comparison is not already null-safe guards the absent side itself.

import type { ExprIR, TypeIR } from "../types/loom-ir.js";

type BinaryExpr = Extract<ExprIR, { kind: "binary" }>;

export interface ValueObjectEqualityPlan {
  readonly leftOptional: boolean;
  readonly rightOptional: boolean;
}

const isValueObject = (t: TypeIR | undefined): boolean =>
  (t?.kind === "optional" ? t.inner : t)?.kind === "valueobject";

/** The value-object comparison a `==` / `!=` node is, or undefined when no
 *  side is a value object (a `null` literal side is a presence test). */
export function valueObjectEqualityPlan(e: BinaryExpr): ValueObjectEqualityPlan | undefined {
  if (e.op !== "==" && e.op !== "!=") return undefined;
  const isNull = (x: ExprIR | undefined) => x?.kind === "literal" && x.lit === "null";
  if (isNull(e.left) || isNull(e.right)) return undefined;
  if (!isValueObject(e.leftType) && !isValueObject(e.rightType)) return undefined;
  return {
    leftOptional: e.leftType?.kind === "optional",
    rightOptional: e.rightType?.kind === "optional",
  };
}
