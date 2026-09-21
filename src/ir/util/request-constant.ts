// -------------------------------------------------------------------------
// Request-constant read predicates.
//
// A read filter is normally `<column> <op> <value>`: SQL decides it row by
// row.  Some legal, useful filters decide NOTHING row by row —
//
//     criterion Visible() of Doc = currentUser.role == "admin"
//     find all(): Doc[] where true || ownerUserId == currentUser.id
//
// — because every operand is fixed for the whole request: a principal claim,
// a parameter, an enum member, a literal.  Such a sub-expression is a REQUEST
// CONSTANT.  Its value is known in the HOST language before the query is
// built, so the honest lowering is to evaluate it there and splice in an
// always-true / always-false SQL term, rather than to push two bound values
// at the database and ask it to compare them (`WHERE $1 <> $2` — which
// Postgres refuses outright: "could not determine data type of parameter").
//
// Why this module exists at all: `firstNonQueryableNode` (the phase-⑦
// queryable gate) has ALWAYS admitted these — a `currentUser.<claim>` member,
// a comparison, a literal are each individually queryable — while the narrow
// per-adapter query renderers only ever implemented `<column> <op> <value>`
// and returned null for anything with no column in it.  Every caller turns
// that null into `refuseOutOfVocabulary`, so `currentUser.role !=
// "technician"` parsed clean, validated clean, and then killed `ddd generate
// system` with an uncaught `QueryEmissionRefusal` whose own message says the
// validator should have stopped it.  Naming the shape here is what lets the
// renderers lower it instead of refusing it, and lets the per-adapter
// capability descriptor narrow it for the one adapter that genuinely cannot.
//
// Deliberately NOT "constant-fold the whole predicate": the recursion in each
// renderer already visits `&&` / `||` / `!` operands one at a time, so a mixed
// predicate (`currentUser.role == "admin" || ownerUserId == currentUser.id`)
// folds only its request-constant HALF and keeps the column half as real SQL.
// That is both the correct semantics and the finest granularity available.
// -------------------------------------------------------------------------

import type { ExprIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** Comparison operators — the ones that make a boolean out of two values. */
const COMPARE_OPS: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

/** True when NOTHING reachable from `e` reads the row under the query — no
 *  `this`, no `this-prop` / `this-vo-prop` alias, no authorization/tenancy
 *  sentinel (those ARE row predicates; they expand to `data_key` / `id`
 *  column tests).  Rides `walkExprDeep` rather than a private recursion so a
 *  new `ExprIR` kind cannot hide a row reference from it — the exact drift
 *  `ir-walk-census.test.ts` exists to prevent. */
export function isRowFree(e: ExprIR): boolean {
  let touchesRow = false;
  walkExprDeep(e, (n) => {
    if (n.kind === "this") touchesRow = true;
    else if (n.kind === "ref" && (n.refKind === "this-prop" || n.refKind === "this-vo-prop"))
      touchesRow = true;
    else if (n.kind === "authz-filter") touchesRow = true;
  });
  return !touchesRow;
}

/** The request-constant shape standing in a BOOLEAN position, or null when
 *  `e` is not one.  Three spellings qualify:
 *
 *   - `{ compare }` — a comparison (`==`/`!=`/`<`/`<=`/`>`/`>=`) with no row
 *     reference on either side (`currentUser.role != "technician"`);
 *   - `{ literal }` — a bare `bool` literal (`true` / `false`), which a
 *     renderer keyed on `<column> <op> <value>` had no arm for either;
 *   - `{ value }` — a bare `bool`-TYPED value with no row reference (a `bool`
 *     find parameter, a `bool` principal claim).
 *
 *  Paren-transparent.  Every other shape returns null, so a caller adds ONE
 *  arm and its existing behaviour is untouched everywhere else — in
 *  particular a bare NON-boolean value in boolean position (`where p`, a
 *  `string` param) is NOT admitted here: it has no truth value to fold, and
 *  folding it would emit a silently-truthy host ternary.  That shape is a
 *  model error and `loom.find-where-not-boolean` refuses it by name. */
export type RequestConstant =
  /** A comparison with no row reference on either side. */
  | { kind: "compare"; op: string; left: ExprIR; right: ExprIR }
  /** A bare `bool` literal (`true` / `false`). */
  | { kind: "literal"; value: boolean }
  /** A bare `bool`-typed value with no row reference — a `bool` parameter
   *  (`find v(flag: bool): Doc[] where flag`), a `bool` principal claim. */
  | { kind: "value"; expr: ExprIR };

/** The `bool` primitive — the only type a value may carry to stand alone in a
 *  boolean position. */
function isBoolTyped(e: ExprIR): boolean {
  const t =
    e.kind === "ref"
      ? e.type
      : e.kind === "member"
        ? e.memberType
        : e.kind === "method-call"
          ? undefined
          : undefined;
  return t?.kind === "primitive" && t.name === "bool";
}

export function asRequestConstant(e: ExprIR): RequestConstant | null {
  if (e.kind === "paren") return asRequestConstant(e.inner);
  if (e.kind === "literal" && e.lit === "bool") {
    return { kind: "literal", value: e.value === "true" };
  }
  if (e.kind === "binary" && COMPARE_OPS.has(e.op) && isRowFree(e)) {
    return { kind: "compare", op: e.op, left: e.left, right: e.right };
  }
  // A bare `bool` value.  Type-checked, not merely row-free: a `string`
  // parameter standing in boolean position is a MODEL error, and folding it
  // would emit `(p ? … : …)` against a string — silently truthy.  That shape
  // stays outside the vocabulary and is refused by `loom.find-where-not-boolean`.
  if (isBoolTyped(e) && isRowFree(e)) return { kind: "value", expr: e };
  return null;
}
