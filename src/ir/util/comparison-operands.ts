// -------------------------------------------------------------------------
// Comparison operand-order normalization — ONE place that answers "which side
// of this comparison is the column, and what does the operator become if it
// has to move".
//
// Every SQL-shaped predicate lowerer has a column position and a value
// position: Drizzle emits `lt(<col>, <value>)`, MikroORM emits
// `{ <col>: { $lt: <value> } }`, and neither vocabulary has a place to put a
// literal on the left.  A predicate written `where 100 < this.qty` is a
// perfectly ordinary queryable shape (`firstNonQueryableNode` walks a
// comparison's operands symmetrically), so each lowerer has to move the column
// to the left — and MIRROR the operator while doing it, or the emitted read
// answers the exact opposite question.
//
// Each adapter re-deciding that independently is what produced two bugs at
// once: Drizzle picked the column off either side but kept `<` as `lt`
// (silently inverted reads), and MikroORM required the column on the left and
// threw, turning a validator-accepted model into a runtime-throwing stub.  So
// the decision lives here, and adapters supply only their own notion of "this
// operand renders as a column".
//
// Platform-neutral (IR-level): the lowerers under `src/generator/` call it,
// `sql-pg-expr.ts` needs no help (it renders both operands symmetrically), and
// a future adapter inherits the commute instead of re-deriving it.
// -------------------------------------------------------------------------

/** The operator a comparison becomes when its operands swap sides.
 *  `a < b` ⇔ `b > a`; equality/inequality are symmetric, so they map to
 *  themselves. */
export const MIRRORED_COMPARE_OP: Readonly<Record<string, string>> = {
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

/** A comparison re-expressed with its column operand on the LEFT: `op` is the
 *  (possibly mirrored) operator, `column` the operand the caller's predicate
 *  accepted as a column, `value` the other side. */
export interface OrientedComparison<T> {
  op: string;
  column: T;
  value: T;
  /** True when the operands were swapped (and `op` therefore mirrored). */
  commuted: boolean;
}

/**
 * Orient a comparison so its column operand is on the left.
 *
 * `isColumnSide` is the adapter's own test — whatever it accepts in column
 * position (a `this.<field>` ref, a VO subfield, an intrinsic over a column).
 * The LEFT operand is tried first, so a predicate already written
 * column-on-left is returned untouched and byte-identical.
 *
 * Returns null when neither operand is a column, or when the operator has no
 * mirror (not a comparison) and the column sits on the right — the caller then
 * takes its own unsupported-shape path.
 */
export function orientComparison<T>(
  op: string,
  left: T,
  right: T,
  isColumnSide: (operand: T) => boolean,
): OrientedComparison<T> | null {
  if (isColumnSide(left)) return { op, column: left, value: right, commuted: false };
  if (!isColumnSide(right)) return null;
  const mirrored = MIRRORED_COMPARE_OP[op];
  if (mirrored === undefined) return null;
  return { op: mirrored, column: right, value: left, commuted: true };
}

// -------------------------------------------------------------------------
// `x == null` / `x != null` — the OTHER operand shape every SQL-shaped lowerer
// has to special-case, for a reason the orientation above does not cover: SQL
// has no `= NULL`.  `col = NULL` is never true, so an equality lowerer that
// binds the null literal as an ordinary value emits a predicate matching no
// row — and on Drizzle it does not even get that far, because `eq`/`ne` are
// typed `(column, column | value)` with no `null` in the value union, so the
// emitted project fails `tsc` with TS2769 (F-007).
//
// Each target has its own spelling (`isNull`/`isNotNull` on Drizzle,
// `cb.isNull`/`cb.isNotNull` on JPA Criteria, `IS NULL` in JPQL,
// `.is_(None)`/`.is_not(None)` on SQLAlchemy, `is_nil/1` on Ecto), so the only
// shared part is RECOGNISING the shape — which side carries the literal, and
// whether the test is negated.  That recognition was hand-rolled in four
// places before this helper; each copy is one missing `paren` arm away from
// failing to see `(this.x) != null`.
// -------------------------------------------------------------------------

/** The literal `null`, seen through parentheses. */
function isNullLiteralOperand(e: { kind: string; lit?: string; inner?: unknown }): boolean {
  if (e.kind === "paren") {
    return isNullLiteralOperand(e.inner as { kind: string; lit?: string; inner?: unknown });
  }
  return e.kind === "literal" && e.lit === "null";
}

/** An `x == null` / `x != null` comparison, re-expressed as the IS [NOT] NULL
 *  test SQL actually has. */
export interface NullComparison<T> {
  /** The non-null side — the operand the emitted IS [NOT] NULL tests. */
  operand: T;
  /** True for `!=` (IS NOT NULL), false for `==` (IS NULL). */
  negated: boolean;
}

/**
 * Recognise a null comparison: `==`/`!=` with the literal `null` on EXACTLY one
 * side (parenthesised or not).
 *
 * Returns null for every other shape, `null == null` included — with no operand
 * to test there is no IS [NOT] NULL predicate to emit, and the caller's ordinary
 * unsupported-shape path is the honest answer.
 */
export function nullComparison<T extends { kind: string }>(
  op: string,
  left: T,
  right: T,
): NullComparison<T> | null {
  if (op !== "==" && op !== "!=") return null;
  const leftIsNull = isNullLiteralOperand(left);
  const rightIsNull = isNullLiteralOperand(right);
  if (leftIsNull === rightIsNull) return null;
  return { operand: leftIsNull ? right : left, negated: op === "!=" };
}
