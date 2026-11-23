// Which numeric operation a `binary` / `unary` node is — decided once.
//
// The typing pass knows when an operator has a `money` or `decimal` operand,
// but the IR keeps it a plain `binary`.  Every backend has to answer the same
// questions about such a node before it can spell it: is it a null test, an
// ordering or equality where a side may be absent, money arithmetic (and which
// scalar side is lifted into money), exact decimal arithmetic, or a plain
// operator?  Two targets answering differently is a different VALUE on the
// wire, so the answer lives here, and each backend's leaf only spells it in
// its own representation (decimal.js, `BigDecimal`, `%Decimal{}`, …).
//
// The rules this module encodes are the language's:
//   - `docs/language.md` "Comparing a nullable money or decimal": an equality
//     is null-safe (both absent are equal, one absent is unequal), and an
//     ordering with an absent side is false — for `money?` / `decimal?`, and a
//     nullable `int?` / `long?` against a `decimal`.
//   - RS-37: `decimal` arithmetic is exact.
//   - The typing pass's `arithmetic` (src/language/typing/elaborate.ts):
//     `money ± money`, `money × scalar` in either order, `money / scalar`.

import { bodyTypeOf } from "../../util/expr-body-type.js";
import type { ExprIR, TypeIR } from "../types/loom-ir.js";

type BinaryExpr = Extract<ExprIR, { kind: "binary" }>;
type UnaryExpr = Extract<ExprIR, { kind: "unary" }>;

/** The numeric family an operand belongs to, or undefined for any other type
 *  (string, bool, temporal, a value object, …). */
export type NumericFamily = "money" | "decimal" | "integral";

/** What the plan knows about one operand. */
export interface NumericOperand {
  readonly family: NumericFamily | undefined;
  /** The operand's static type is optional (`T?`). */
  readonly optional: boolean;
}

export type NumericOpPlan =
  /** `x == null` / `x != null`: a presence test, whatever `x` is.
   *  `subject` is the side that is not the `null` literal. */
  | { readonly kind: "null-test"; readonly subject: "left" | "right" }
  /** `+ - * / %` whose result is `decimal` — exact arithmetic, computed in
   *  the target's decimal representation and narrowed once at the root of the
   *  chain.  `intDivWidened` marks `int / int` (both operands integral). */
  | {
      readonly kind: "decimal-arithmetic";
      readonly intDivWidened: boolean;
      readonly left: NumericOperand;
      readonly right: NumericOperand;
    }
  /** `<` `<=` `>` `>=` where a side may be absent and a side is money or
   *  decimal: an absent side answers false. */
  | {
      readonly kind: "absent-ordering";
      readonly left: NumericOperand;
      readonly right: NumericOperand;
    }
  /** `==` `!=` where a side may be absent and a side is money or decimal:
   *  both absent are equal, one absent is unequal. */
  | {
      readonly kind: "absent-equality";
      readonly left: NumericOperand;
      readonly right: NumericOperand;
    }
  /** Arithmetic or a comparison with a present `money` operand.  `lift` is the
   *  scalar side (`int` / `long` / `decimal`) a target whose money is a
   *  distinct type must convert, or undefined for `money ∘ money`. */
  | {
      readonly kind: "money";
      readonly lift: "left" | "right" | undefined;
      readonly left: NumericOperand;
      readonly right: NumericOperand;
    }
  /** A comparison between present operands with a `decimal` side and no
   *  money. */
  | {
      readonly kind: "decimal-comparison";
      readonly left: NumericOperand;
      readonly right: NumericOperand;
    }
  /** Anything else: the target's native operator. */
  | { readonly kind: "native" };

const ARITHMETIC = new Set<BinaryExpr["op"]>(["+", "-", "*", "/", "%"]);
const ORDERING = new Set<BinaryExpr["op"]>(["<", "<=", ">", ">="]);
const EQUALITY = new Set<BinaryExpr["op"]>(["==", "!="]);

function familyOf(t: TypeIR | undefined): NumericFamily | undefined {
  const inner = t?.kind === "optional" ? t.inner : t;
  if (inner?.kind !== "primitive") return undefined;
  if (inner.name === "money") return "money";
  if (inner.name === "decimal") return "decimal";
  if (inner.name === "int" || inner.name === "long") return "integral";
  return undefined;
}

/** The plan's view of an operand of static type `t`. */
function numericOperand(t: TypeIR | undefined): NumericOperand {
  return { family: familyOf(t), optional: t?.kind === "optional" };
}

const isNullLiteral = (e: ExprIR | undefined): boolean => e?.kind === "literal" && e.lit === "null";

/** The family an arithmetic node's result takes: its stamped `resultType`, or —
 *  for a synthesized node that left it unstamped — what the typing pass's
 *  `arithmetic` would give the operand families (money absorbs a scalar,
 *  decimal absorbs an integer, `int / int` widens to decimal). */
function resultFamily(
  e: BinaryExpr,
  left: NumericOperand,
  right: NumericOperand,
): NumericFamily | undefined {
  if (e.resultType) return familyOf(e.resultType);
  if (left.family === undefined || right.family === undefined) return undefined;
  if (left.family === "money" || right.family === "money") return "money";
  if (left.family === "decimal" || right.family === "decimal") return "decimal";
  return e.op === "/" ? "decimal" : "integral";
}

/** The numeric operation a binary node is. */
export function numericOpPlan(e: BinaryExpr): NumericOpPlan {
  if (EQUALITY.has(e.op) && (isNullLiteral(e.left) || isNullLiteral(e.right))) {
    return { kind: "null-test", subject: isNullLiteral(e.right) ? "left" : "right" };
  }
  // A synthesized node (a compound own-state write, a walker expansion) may
  // leave an operand type unstamped; the operand's own type answers then.
  const left = numericOperand(e.leftType ?? (e.left ? bodyTypeOf(e.left) : undefined));
  const right = numericOperand(e.rightType ?? (e.right ? bodyTypeOf(e.right) : undefined));
  if (ARITHMETIC.has(e.op) && resultFamily(e, left, right) === "decimal") {
    return {
      kind: "decimal-arithmetic",
      intDivWidened: e.op === "/" && left.family === "integral" && right.family === "integral",
      left,
      right,
    };
  }
  if (left.family === undefined || right.family === undefined) return { kind: "native" };
  const decimalFamily = (o: NumericOperand) => o.family === "money" || o.family === "decimal";
  const comparison = ORDERING.has(e.op) || EQUALITY.has(e.op);
  if (
    comparison &&
    (left.optional || right.optional) &&
    (decimalFamily(left) || decimalFamily(right))
  ) {
    return { kind: ORDERING.has(e.op) ? "absent-ordering" : "absent-equality", left, right };
  }
  // A comparison with an absent integral side and no money/decimal keeps the
  // host's own null semantics.  Arithmetic ignores optionality: an operand a
  // null test narrowed keeps its `T?` stamp.
  if (comparison && (left.optional || right.optional)) return { kind: "native" };
  if (left.family === "money" || right.family === "money") {
    const lift =
      left.family === "money" && right.family === "money"
        ? undefined
        : left.family === "money"
          ? "right"
          : "left";
    return { kind: "money", lift, left, right };
  }
  if (comparison && (left.family === "decimal" || right.family === "decimal")) {
    return { kind: "decimal-comparison", left, right };
  }
  return { kind: "native" };
}

/** The family a unary `-` negates when it is money or decimal (a target
 *  whose money or decimal is an object negates by method), else undefined. */
export function negatedFamily(e: UnaryExpr): "money" | "decimal" | undefined {
  if (e.op !== "-") return undefined;
  const f = familyOf(bodyTypeOf(e.operand));
  return f === "money" || f === "decimal" ? f : undefined;
}
