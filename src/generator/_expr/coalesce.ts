import type { ExprIR } from "../../ir/types/loom-ir.js";

type TernaryExpr = Extract<ExprIR, { kind: "ternary" }>;

/**
 * The `a ?? b` shape the lowerer builds — `a == null ? b : a` where the
 * else-branch is the IDENTICAL node of the null test's left side (identity,
 * not structural equality: a hand-written `x == null ? y : x` is a plain
 * ternary).  Returns the two operands, or `undefined` for any other ternary.
 * A chain `a ?? b ?? c` nests in the fallback: `fallback` is itself a coalesce.
 *
 * Every backend renders the shape through `ExprTarget.coalesce`, so the left
 * operand is rendered — and evaluated — once, and the fallback only when the
 * left is null.
 */
export function coalesceParts(e: TernaryExpr): { left: ExprIR; fallback: ExprIR } | undefined {
  const c = e.cond;
  if (
    c.kind === "binary" &&
    c.op === "==" &&
    c.right.kind === "literal" &&
    c.right.lit === "null" &&
    c.left === e.otherwise
  ) {
    return { left: e.otherwise, fallback: e.then };
  }
  return undefined;
}

/** `??` cannot mix with `||` / `&&` / `?:` unparenthesised; keep plain
 *  identifier/member/call chains bare and parenthesise anything else. */
export function nullishOperand(text: string): string {
  return /^[\w$.]+(\([^()]*\))?$/.test(text) ? text : `(${text})`;
}
