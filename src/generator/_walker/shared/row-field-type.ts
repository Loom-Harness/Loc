// Row-field TYPE lookups shared by the row-rendering primitives (`DataGrid`,
// `Table`).
//
// A page body carries no `receiverType`: inside a `data: rows => …` lambda every
// member read (`o.amount`) types as `string`, money and decimal included.  So a
// primitive that needs to know what a COLUMN really holds cannot ask the
// expression — it asks the ROW AGGREGATE the enclosing `QueryView` recorded
// (`ctx.listRowAggregates`), whose declared fields carry the real types.
//
// Both call sites need the identical answer for the identical reason (money and
// decimal are not plain comparables on any frontend — a `Decimal` object on the
// JS targets, the wire STRING on Flutter — so the default `a < b` comparator
// orders them wrongly), which is why the predicate lives here rather than twice.

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import type { WalkContext } from "../walker-core.js";
import { extendLambdaParams } from "../walker-core.js";

/** The PRIMITIVE a row column reads, or undefined when it cannot be resolved
 *  (no recorded row aggregate, an unknown field, a non-primitive field).  The
 *  single resolution both predicates below are built on. */
export function rowFieldPrimitive(
  field: string | undefined,
  rowAggregate: string | undefined,
  ctx: WalkContext,
): string | undefined {
  if (!field || !rowAggregate) return undefined;
  const agg = ctx.aggregatesByName.get(rowAggregate);
  const t = agg?.fields.find((x) => x.name === field)?.type;
  const base = t?.kind === "optional" ? t.inner : t;
  return base?.kind === "primitive" ? base.name : undefined;
}

/** True when a column reads a `money`/`decimal` field — the two primitives the
 *  JS frontends hold as a decimal OBJECT whose `valueOf()` is a string, so the
 *  default `a < b` comparator orders them lexicographically.
 *
 *  Unresolvable → false, which keeps whatever the target's default comparator
 *  already did. */
export function isDecimalLikeField(
  field: string | undefined,
  rowAggregate: string | undefined,
  ctx: WalkContext,
): boolean {
  const p = rowFieldPrimitive(field, rowAggregate, ctx);
  return p === "money" || p === "decimal";
}

/** True when a column reads a `money` field specifically.
 *
 *  Narrower than `isDecimalLikeField` on purpose: on a target where `decimal`
 *  IS the host's numeric type but `money` is not (Flutter — `double` vs the
 *  wire String), only money needs the special comparator, and routing decimal
 *  through a money helper would re-quantize it to the money scale. */
export function isMoneyField(
  field: string | undefined,
  rowAggregate: string | undefined,
  ctx: WalkContext,
): boolean {
  return rowFieldPrimitive(field, rowAggregate, ctx) === "money";
}

/** Open a CELL-lambda scope over one table/grid row: bind the accessor's param
 *  to the target's row variable, and record which aggregate that row IS.
 *
 *  The second half is the one that used to be missing, and the omission is why
 *  an optional reference rendered an unguarded link in a LIST cell long after
 *  the detail page's guard worked (M-T1.33).  `ctx.listRowAggregates` is
 *  recorded by the enclosing `QueryView` against ITS `data:` param (`rows`),
 *  but a column accessor rebinds the row under its own name (`o => o.origin`),
 *  and nothing carried the aggregate across that rebinding.  So every
 *  resolution built on this map — including `apiReadMemberType`, which is how
 *  `IdLink` learns a reference is optional — silently returned "unknown" for
 *  every cell in every table, and an unknown field type reads as a required
 *  one.
 *
 *  Both row-rendering primitives open this scope for the identical reason, so
 *  it lives here beside the lookups it feeds rather than twice. */
export function extendRowScope(
  ctx: WalkContext,
  param: string,
  rowVar: string,
  rowAggregate: string | undefined,
): WalkContext {
  return {
    ...ctx,
    lambdaParams: extendLambdaParams(ctx, param, rowVar),
    listRowAggregates: rowAggregate
      ? new Map([...(ctx.listRowAggregates ?? []), [param, rowAggregate]])
      : ctx.listRowAggregates,
  };
}

/** The aggregate a `Table`/`DataGrid` `rows:` expression yields ROWS of, for
 *  the purpose of typing its CELLS.
 *
 *  Wider than the bare `ctx.listRowAggregates.get(<ref>)` lookup the sort
 *  comparator makes, and deliberately so: a SERVER-PAGED list — which is every
 *  scaffolded `all` list — binds the `Paged<T>` ENVELOPE as the `QueryView`
 *  `data:` param and the table reads `rows.items` off it, so the `rows:`
 *  argument is a member access and the bare lookup finds nothing.  That is the
 *  second reason a list cell walked with an unknown row type (M-T1.33); the
 *  first is `extendRowScope`'s.
 *
 *  Kept separate from the sort path's own resolution rather than replacing it:
 *  widening THAT would change which columns get a money comparator on every
 *  server-paged table, which is a different defect with its own goldens. */
export function cellRowAggregate(
  rowsArg: ExprIR | undefined,
  ctx: WalkContext,
): string | undefined {
  if (!rowsArg) return undefined;
  if (rowsArg.kind === "ref") return ctx.listRowAggregates?.get(rowsArg.name);
  if (rowsArg.kind === "member" && rowsArg.receiver.kind === "ref") {
    return ctx.listRowAggregates?.get(rowsArg.receiver.name);
  }
  return undefined;
}
