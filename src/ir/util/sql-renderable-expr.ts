import type { ExprIR } from "../types/loom-ir.js";

// ---------------------------------------------------------------------------
// The SQL-renderable expression subset (M-T2.3 data-migration surface).
//
// Pure predicate over ExprIR — the honest gate backing
// `loom.migration-expr-unsupported`.  Lives in `ir/util` (not next to the
// renderer in `generator/`) because the IR validator consumes it and
// `ir → generator` is a forbidden backward edge; the renderer
// (`src/generator/sql-pg-expr.ts`) imports it forward and MUST stay in
// lockstep: everything this admits, the renderer renders.
// ---------------------------------------------------------------------------

/** Is `e` inside the SQL-renderable subset a backfill expression may use?
 *  `true`, or the reason it is not — surfaced verbatim by the
 *  `loom.migration-expr-unsupported` validator so the user sees *why* the
 *  expression can't backfill.
 *
 *  Supported: literals, enum values, sibling-field refs (`this-prop`),
 *  parens, unary, the closed BinOp set, ternary.  Value-object leaves are
 *  excluded — Phoenix stores a VO as one `:map` column, so a leaf-column
 *  reference would not be portable across backends. */
export function sqlRenderableExpr(e: ExprIR): true | { reason: string } {
  switch (e.kind) {
    case "literal":
      return true;
    case "ref":
      if (e.refKind === "enum-value") return true;
      if (e.refKind === "this-prop") return true;
      if (e.refKind === "this-vo-prop") {
        return {
          reason:
            "value-object fields cannot be referenced in a backfill (Phoenix stores a value object as a single map column, so a leaf-column reference is not portable)",
        };
      }
      return { reason: `'${e.name}' does not resolve to a sibling field of the aggregate` };
    case "paren":
      return sqlRenderableExpr(e.inner);
    case "unary":
      return sqlRenderableExpr(e.operand);
    case "binary": {
      const l = sqlRenderableExpr(e.left);
      if (l !== true) return l;
      return sqlRenderableExpr(e.right);
    }
    case "ternary": {
      const c = sqlRenderableExpr(e.cond);
      if (c !== true) return c;
      const t = sqlRenderableExpr(e.then);
      if (t !== true) return t;
      return sqlRenderableExpr(e.otherwise);
    }
    default:
      return {
        reason: `'${e.kind}' expressions are not supported in a backfill — use literals, sibling fields, arithmetic/comparison operators, or a raw sql step`,
      };
  }
}

/** Is `e` a **scalar literal** — the strictly narrower subset a Postgres
 *  *column default* may hold (M-T2.16 / #2864 G1, decision D-3)?
 *
 *  `sqlRenderableExpr` above admits everything a *backfill* `UPDATE` may use,
 *  which is deliberately wider: an `UPDATE` runs per row and may read the row's
 *  other columns, so a sibling-field ref (`this-prop`), arithmetic over one, and
 *  the ternary are all fine there.  A column default is evaluated with no row in
 *  scope, so Postgres rejects any reference to another column outright
 *  (`cannot use column reference in DEFAULT expression`).  This predicate is
 *  therefore not a style choice — it is the boundary of what the DDL accepts.
 *
 *  Admitted: the literal kinds that render to a self-contained constant, and an
 *  enum value (stored as its text).  Excluded, each for its own reason:
 *
 *   - `now` — renders `now()`, a function call, not a literal.  D-3 keeps it
 *     out: a `DEFAULT now()` briefly stamps every pre-existing row with the
 *     migration's clock, which is a domain fact the app layer owns.
 *   - `null` — a NULL default on the NOT-NULL column this feeds is a
 *     contradiction; it would leave the add blocking anyway.
 *   - `this-prop` / `this-vo-prop` and every compound form — the column
 *     reference Postgres refuses (and, for the VO leaf, not portable besides;
 *     see `sqlRenderableExpr`).
 *   - anything else (`currentUser.*`, calls, …) — never a literal.
 *
 *  Callers render an admitted expression with `renderSqlScalarExpr`, which is
 *  total over this subset and never consults its `SqlExprContext` for it (the
 *  context is reached only through `this-prop`, which is rejected here). */
export function sqlLiteralColumnDefault(e: ExprIR): boolean {
  if (e.kind === "literal") return e.lit !== "now" && e.lit !== "null";
  return e.kind === "ref" && e.refKind === "enum-value";
}
