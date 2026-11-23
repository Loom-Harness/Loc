// One null rule for an ordinary query predicate (owner ruling 172 on #5438):
// on an OPTIONAL column, a negated or inequality filter answers what the same
// criterion answers in memory.  In memory an absent value is unequal to every
// value, and a membership, substring or ordering test against it is false, so
//
//   this.memo != q              matches a row whose memo is absent
//   !ids.contains(this.ref)     matches a row whose ref is absent
//
// Plain SQL answers NULL for both and drops the row.  This rewrite turns the
// predicate into an equivalent one every SQL path already renders definitely —
// `== null` is `IS NULL` on all of them — so a query and the same criterion
// run in memory agree, on every backend, from one rule:
//
//   this.memo != q              →  this.memo == null || this.memo != q
//   !ids.contains(this.ref)     →  this.ref == null || !ids.contains(this.ref)
//   !(this.a == 1 && this.m == x)  →  !(this.a == 1) || (this.m == null || !(this.m == x))
//
// A negation is pushed through `&&` / `||` first (De Morgan), so each guard sits
// on the one comparison it decides; a positive comparison is left alone, since
// NULL in a `WHERE` drops the row exactly as the in-memory `false` does.
//
// The result is equivalent IN MEMORY too, so the rewritten predicate is safe
// wherever it is also evaluated as code (a criterion's `IsSatisfiedBy`).
//
// Scope: ordinary filters and queries only.  An AUTHORIZATION predicate — a
// principal term (`currentUser…`, `organizationContext…`) — keeps its own rule
// (an absent claim admits nothing; owner ruling 312), so any comparison that
// reads the principal is left exactly as written, and the capability / policy /
// tenancy scopes and write scopes are never passed through here.

import type { ExprIR, TypeIR } from "../types/loom-ir.js";
import { isNullLiteralOperand } from "./comparison-operands.js";
import { walkExprDeep } from "./walk.js";

type Binary = Extract<ExprIR, { kind: "binary" }>;

const BOOL: TypeIR = { kind: "primitive", name: "bool" } as TypeIR;
const NULL: ExprIR = { kind: "literal", lit: "null", value: "null" };

/** A stored column of the filtered row (or of an `exists` row) declared
 *  optional. */
function isOptionalColumn(e: ExprIR): boolean {
  if (e.kind === "paren") return isOptionalColumn(e.inner);
  if (e.kind === "ref") {
    return (
      (e.refKind === "this-prop" || e.refKind === "this-vo-prop") && e.type?.kind === "optional"
    );
  }
  if (e.kind === "member") {
    return e.memberType.kind === "optional" && rootedInRow(e.receiver);
  }
  return false;
}

function rootedInRow(e: ExprIR): boolean {
  if (e.kind === "this") return true;
  if (e.kind === "ref")
    return e.refKind === "row" || e.refKind === "this-prop" || e.refKind === "this-vo-prop";
  if (e.kind === "member") return rootedInRow(e.receiver);
  return false;
}

/** True when `e` reads the request principal anywhere. */
function readsPrincipal(e: ExprIR): boolean {
  let found = false;
  walkExprDeep(e, (n) => {
    if (n.kind === "ref" && (n.refKind === "current-user" || n.name === "organizationContext")) {
      found = true;
    }
  });
  return found;
}

/** True when `e` is a value that may itself be absent (an optional parameter
 *  or binding): the comparison keeps its existing null branch. */
function isNullableValue(e: ExprIR): boolean {
  if (e.kind === "paren") return isNullableValue(e.inner);
  if (e.kind === "ref") return e.type?.kind === "optional" && !isOptionalColumn(e);
  if (e.kind === "member") return e.memberType.kind === "optional" && !rootedInRow(e.receiver);
  return false;
}

/** The optional columns an atom reads, in first-seen order. */
function optionalColumnsIn(e: ExprIR): ExprIR[] {
  const out: ExprIR[] = [];
  const seen = new Set<string>();
  walkExprDeep(e, (n) => {
    if (!isOptionalColumn(n)) return;
    const key = JSON.stringify(n);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  });
  return out;
}

/** Renderers print a node's operands as they stand, so a synthesized node
 *  parenthesises every compound operand itself (a source tree carries its own
 *  `paren` nodes). */
const grouped = (e: ExprIR): ExprIR =>
  e.kind === "binary" || e.kind === "unary" ? { kind: "paren", inner: e } : e;

const bin = (op: Binary["op"], left: ExprIR, right: ExprIR, leftType?: TypeIR): ExprIR => ({
  kind: "binary",
  op,
  left: op === "&&" || op === "||" ? grouped(left) : left,
  right: op === "&&" || op === "||" ? grouped(right) : right,
  ...(leftType ? { leftType } : {}),
  rightType: op === "&&" || op === "||" ? BOOL : leftType,
  resultType: BOOL,
});

const typeOf = (e: ExprIR): TypeIR | undefined =>
  e.kind === "ref" ? e.type : e.kind === "member" ? e.memberType : undefined;

const isNull = (col: ExprIR): ExprIR => bin("==", col, NULL, typeOf(col));
const isNotNull = (col: ExprIR): ExprIR => bin("!=", col, NULL, typeOf(col));
const not = (e: ExprIR): ExprIR => ({ kind: "unary", op: "!", operand: grouped(e) }) as ExprIR;
const or = (a: ExprIR, b: ExprIR): ExprIR => bin("||", a, b, BOOL);
const and = (a: ExprIR, b: ExprIR): ExprIR => bin("&&", a, b, BOOL);

/** Columns already guarded by an enclosing `<null tests> || …` — the rewrite's
 *  own output — keyed by their JSON.  Threading them makes the rewrite
 *  idempotent: enrichment may run more than once. */
type Guarded = ReadonlySet<string>;

const keyOf = (col: ExprIR): string => JSON.stringify(col);

/** The columns `e` null-tests, when `e` is nothing but null tests joined by
 *  `&&` / `||` (the guard the rewrite puts in front of a comparison); else
 *  none. */
function nullTestedColumns(e: ExprIR): string[] | undefined {
  if (e.kind === "paren") return nullTestedColumns(e.inner);
  if (e.kind === "binary" && (e.op === "&&" || e.op === "||")) {
    const l = nullTestedColumns(e.left);
    const r = nullTestedColumns(e.right);
    return l && r ? [...l, ...r] : undefined;
  }
  if (e.kind === "binary" && (e.op === "==" || e.op === "!=")) {
    if (isNullLiteralOperand(e.right) && isOptionalColumn(e.left)) return [keyOf(e.left)];
    if (isNullLiteralOperand(e.left) && isOptionalColumn(e.right)) return [keyOf(e.right)];
  }
  return undefined;
}

const unguarded = (col: ExprIR, g: Guarded): boolean => isOptionalColumn(col) && !g.has(keyOf(col));

/** `l != r` with the in-memory answer when a side is an absent column. */
function inequality(e: Binary, g: Guarded): ExprIR {
  if (isNullLiteralOperand(e.left) || isNullLiteralOperand(e.right) || readsPrincipal(e)) return e;
  const l = unguarded(e.left, g);
  const r = unguarded(e.right, g);
  if (l && r) {
    // Both absent → equal (not a match); exactly one absent → a match.
    return or(
      or(and(isNull(e.left), isNotNull(e.right)), and(isNotNull(e.left), isNull(e.right))),
      e,
    );
  }
  if (l && !isNullableValue(e.right)) return or(isNull(e.left), e);
  if (r && !isNullableValue(e.left)) return or(isNull(e.right), e);
  return e;
}

/** `!e`, with each comparison it decides guarded. */
function negate(e: ExprIR, g: Guarded): ExprIR {
  if (e.kind === "paren") return negate(e.inner, g);
  if (e.kind === "unary" && e.op === "!") return rewrite(e.operand, g);
  if (e.kind === "binary" && e.op === "&&") return or(negate(e.left, g), negate(e.right, g));
  if (e.kind === "binary" && e.op === "||") return and(negate(e.left, g), negate(e.right, g));
  // `!(a != b)` is `a == b`: in memory an absent side makes it false, and SQL's
  // NULL drops the row the same way.
  if (e.kind === "binary" && e.op === "!=" && !readsPrincipal(e)) {
    return { ...e, op: "==" };
  }
  if (readsPrincipal(e)) return not(e);
  // `!(a == b)` is the inequality.
  if (e.kind === "binary" && e.op === "==") return inequality({ ...e, op: "!=" }, g);
  const cols = optionalColumnsIn(e).filter((c) => !g.has(keyOf(c)));
  if (cols.length === 0) return not(e);
  return cols.reduceRight<ExprIR>((acc, col) => or(isNull(col), acc), not(e));
}

function rewrite(e: ExprIR, g: Guarded): ExprIR {
  switch (e.kind) {
    case "paren":
      return { ...e, inner: rewrite(e.inner, g) };
    case "unary":
      return e.op === "!" ? negate(e.operand, g) : e;
    case "binary":
      if (e.op === "||") {
        // `<null tests on c> || X`: X already answers for an absent c.
        const tested = nullTestedColumns(e.left);
        const inner = tested ? new Set([...g, ...tested]) : g;
        return { ...e, left: rewrite(e.left, g), right: rewrite(e.right, inner) };
      }
      if (e.op === "&&") return { ...e, left: rewrite(e.left, g), right: rewrite(e.right, g) };
      if (e.op === "!=") return inequality(e, g);
      return e;
    default:
      return e;
  }
}

/** The predicate with its negations and inequalities made null-safe; the same
 *  object when nothing changes. */
export function nullSafeFilter(e: ExprIR): ExprIR {
  const out = rewrite(e, new Set());
  return JSON.stringify(out) === JSON.stringify(e) ? e : out;
}
