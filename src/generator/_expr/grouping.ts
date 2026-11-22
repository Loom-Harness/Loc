import type { ExprIR } from "../../ir/types/loom-ir.js";
import { coalesceParts } from "./coalesce.js";

// ---------------------------------------------------------------------------
// Operator grouping — decided once, from the tree's shape.
//
// An `ExprIR` carries its grouping structurally: `binary(-, x, binary(-, a,
// b))` means `x - (a - b)` whether or not a `paren` node wraps the inner
// binary.  A `paren` node is only what the author wrote; a lowering pass, an
// enrichment or a macro that builds an operator node does not write one.  The
// leaves splice operand text (`${left} ${op} ${right}`), so a renderer that
// relied on `paren` alone regrouped every synthesized operand that binds more
// loosely than its parent — the result still compiled and returned a
// different value.
//
// Every expression dispatcher (the backend `renderExprWith`, the frontend
// walker and its F#/Dart leaf tables) asks `groupOperand` for each operand it
// hands an operator or a postfix receiver, so a construction site never has to
// remember `paren`.  The decision is Loom's grammar (`LOOM_PRECEDENCE`), with
// a per-target `GroupingPolicy` for host languages whose operators do not
// group the way Loom's do.
// ---------------------------------------------------------------------------

type BinaryExpr = Extract<ExprIR, { kind: "binary" }>;
type BinOp = BinaryExpr["op"];

/** Loom's binding strength per level (higher binds tighter), mirroring the
 *  `ddd.langium` expression ladder: ternary < `??` < `||` < `&&` < equality <
 *  comparison < additive < multiplicative < unary < postfix.  Every binary
 *  level is left-associative. */
const LOOM_PRECEDENCE = {
  ternary: 0,
  coalesce: 1,
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
  unary: 8,
  postfix: 9,
} as const satisfies Record<BinOp | "ternary" | "coalesce" | "unary" | "postfix", number>;

/** Operators whose result does not depend on how a run of them is nested,
 *  on every target: `a && (b && c)` and `(a && b) && c` evaluate the same
 *  operands in the same order and short-circuit at the same point.  The
 *  arithmetic operators are not here: `+` concatenates strings, overflows and
 *  rounds, so its nesting is observable. */
const ASSOCIATIVE: ReadonlySet<BinOp> = new Set<BinOp>(["&&", "||"]);

const COMPARISON: ReadonlySet<BinOp> = new Set<BinOp>(["==", "!=", "<", "<=", ">", ">="]);

const isString = (t: BinaryExpr["leftType"]): boolean =>
  t?.kind === "primitive" && t.name === "string";

/** True when `e` is a `+` that builds a string and every `+` its left
 *  operand renders ungrouped does too, so it can splice into an
 *  enclosing concatenation: `s + (t + u)` and `s + t + u` build the same
 *  string, while `s + (1 + 2 + t)` and `s + 1 + 2 + t` do not. */
function isStringConcatRun(e: BinaryExpr): boolean {
  if (e.op !== "+" || !isString(e.resultType)) return false;
  const l = e.left;
  if (l.kind === "binary" && LOOM_PRECEDENCE[l.op] === LOOM_PRECEDENCE["+"]) {
    return isStringConcatRun(l);
  }
  return true;
}

/** How a host language's operators differ from Loom's grouping. */
export interface GroupingPolicy {
  /** The host chains comparisons (`a < b == c` reads `a < b and b == c` in
   *  Python) or refuses to nest them (Dart's equality is non-associative), so
   *  a comparison operand of a comparison is always grouped. */
  readonly groupNestedComparisons?: boolean;
}

/** Where an operand sits under its parent. */
export type OperandPosition =
  | { readonly parent: "binary"; readonly op: BinOp; readonly side: "left" | "right" }
  | { readonly parent: "unary"; readonly op: "-" | "!" }
  | { readonly parent: "postfix" };

/** The binding strength of a node as an operand: the operator nodes rank by
 *  `LOOM_PRECEDENCE`; every other kind renders as one primary term (a name, a
 *  call, a literal, an author-written `paren`) and never needs grouping. */
function operandPrecedence(e: ExprIR): number | undefined {
  switch (e.kind) {
    case "binary":
      return LOOM_PRECEDENCE[e.op];
    case "unary":
      return LOOM_PRECEDENCE.unary;
    case "ternary":
      return coalesceParts(e) ? LOOM_PRECEDENCE.coalesce : LOOM_PRECEDENCE.ternary;
    // Every other kind is one primary term.  Listed, not defaulted: a new kind
    // that renders as an infix operator must take a level above.
    case "literal":
    case "this":
    case "id":
    case "ref":
    case "member":
    case "method-call":
    case "call":
    case "lambda":
    case "new":
    case "object":
    case "paren":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "match":
    case "list":
    case "authz-filter":
    case "exists":
    case "action-ref":
    case "modelText":
      return undefined;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/** True when `child` must be grouped to keep the meaning its position in the
 *  tree gives it.  The tree is the truth: a child that binds more loosely
 *  than its parent, or as loosely on the side a left-associative operator
 *  does not absorb, is grouped. */
export function needsGrouping(
  child: ExprIR,
  at: OperandPosition,
  policy?: GroupingPolicy,
): boolean {
  const p = operandPrecedence(child);
  if (p === undefined) return false;
  switch (at.parent) {
    case "postfix":
      return true;
    case "unary":
      // `- -x` would glue into a decrement on the C-family targets.
      if (child.kind === "unary") return at.op === "-" && child.op === "-";
      return p < LOOM_PRECEDENCE.unary;
    case "binary": {
      const parent = LOOM_PRECEDENCE[at.op];
      if (
        policy?.groupNestedComparisons &&
        child.kind === "binary" &&
        COMPARISON.has(child.op) &&
        COMPARISON.has(at.op)
      ) {
        return true;
      }
      if (p < parent) return true;
      if (p > parent) return false;
      // Same level: the left side is what left-associativity absorbs.
      if (at.side === "left") return false;
      if (child.kind !== "binary" || child.op !== at.op) return true;
      return !(ASSOCIATIVE.has(at.op) || (at.op === "+" && isStringConcatRun(child)));
    }
  }
}

/** True when `text` already reads as one term to any host parser: one
 *  bracket group, or a name / literal followed only by member, call, index
 *  and non-null postfixes — no whitespace or operator outside brackets and
 *  string literals.  Used only to avoid doubling a group a leaf already wrote
 *  (`a.plus(b)`, `(x if c else y)`); it never decides that a group is needed. */
export function isSelfDelimited(text: string): boolean {
  if (text.length === 0) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(text, i);
      if (end < 0) return false;
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) return false;
      continue;
    }
    if (depth > 0) continue;
    if (/[\w$@.]/.test(ch)) continue;
    // `x?.y` and a non-null postfix (`x!`, `x!.y`) after a term.
    if (ch === "?" && text[i + 1] === "." && i > 0) continue;
    if (ch === "!" && i > 0 && /[\w)\]]/.test(text[i - 1]!) && !/[=\w(]/.test(text[i + 1] ?? "")) {
      continue;
    }
    return false;
  }
  return depth === 0 && !/^[!-]/.test(text);
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return -1;
}

/** The operand text a dispatcher hands an operator or a postfix leaf:
 *  `text` grouped when the tree requires it and the text is not already one
 *  term. */
export function groupOperand(
  text: string,
  child: ExprIR,
  at: OperandPosition,
  policy?: GroupingPolicy,
): string {
  if (!needsGrouping(child, at, policy)) return text;
  return isSelfDelimited(text) ? text : `(${text})`;
}

/** A binary node's two operands, rendered by `render` and grouped — the
 *  entry a renderer that does not ride `renderExprWith` (a query language, a
 *  validator, a gate, a test emitter) splices its operator between. */
export function groupedOperands(
  e: BinaryExpr,
  render: (x: ExprIR) => string,
  policy?: GroupingPolicy,
): [left: string, right: string] {
  return [
    groupOperand(render(e.left), e.left, { parent: "binary", op: e.op, side: "left" }, policy),
    groupOperand(render(e.right), e.right, { parent: "binary", op: e.op, side: "right" }, policy),
  ];
}

/** A unary node's operand, rendered by `render` and grouped. */
export function groupedOperand(
  e: Extract<ExprIR, { kind: "unary" }>,
  render: (x: ExprIR) => string,
  policy?: GroupingPolicy,
): string {
  return groupOperand(render(e.operand), e.operand, { parent: "unary", op: e.op }, policy);
}

/** Hosts whose comparisons chain (Python) or do not nest the way Loom's do
 *  (F#'s comparisons share one level; Dart's and SQL's equality is
 *  non-associative). */
export const NESTED_COMPARISONS_GROUPED: GroupingPolicy = { groupNestedComparisons: true };
