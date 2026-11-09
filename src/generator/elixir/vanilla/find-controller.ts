// ---------------------------------------------------------------------------
// Vanilla controller read helpers shared by the aggregate controller, the
// event-sourced controller and the query-projection controller:
//
//   - `findParamRead`   — read one query param off `params`, coerced to its
//                         declared type (Phoenix delivers every param as a
//                         string).
//   - `renderPageParamHelper` — the once-per-controller `page_param/4` reader
//                         the auto-`all` `index` action's `page`/`pageSize`
//                         reads go through.
//
// A repository declares no reads of its own, so there is no per-find route or
// action here: the only HTTP find is the auto-`all` index, rendered by
// `api-emit.ts`.
// ---------------------------------------------------------------------------

import { pagedReturn } from "../../../ir/stdlib/generics.js";
import type { AggregateIR, BoundedContextIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { isAbstractBase } from "./inheritance-emit.js";
import { PAGE_PARAM_HELPER } from "./page-param.js";

/** The scalar KIND a find param must be coerced to, or `undefined` when the
 *  query-string form is already right (string / guid / enum / id). */
function findParamCoercion(
  t: TypeIR | undefined,
): "int" | "decimal" | "bool" | "datetime" | "date" | undefined {
  const inner = t?.kind === "optional" ? t.inner : t;
  if (inner?.kind !== "primitive") return undefined;
  switch (inner.name) {
    case "int":
    case "long":
      return "int";
    case "decimal":
    case "money":
      return "decimal";
    case "bool":
      return "bool";
    case "datetime":
      return "datetime";
    case "date":
      return "date";
    default:
      return undefined;
  }
}

/**
 * Read one declared find param off the query string, COERCED to its declared
 * type.
 *
 * Phoenix delivers every query param as a STRING — the emitter already knows
 * this, which is why `page`/`pageSize` go through `page_param/3`.  The find's
 * OWN params never got the same treatment, and on the relational path that was
 * invisible: the value lands in an Ecto query (`^min`), and Ecto casts it
 * against the schema's field type.
 *
 * The IN-MEMORY filter path has no Ecto to cast.  A `shape: document`
 * aggregate's find loads the rows and filters in Elixir:
 *
 *     Enum.filter(fn row -> row.data.view_count >= min end)
 *
 * …so `6 >= "6"` is evaluated under Erlang's term ordering, where a number is
 * ALWAYS less than a binary — the comparison is silently `false` and the find
 * returns `[]` for every row.  No error, no log: a find that quietly answers
 * nothing.
 *
 * Coercing at the controller fixes the in-memory path and leaves the relational
 * one equivalent (Ecto accepted the string; it accepts the integer too).  A
 * string / guid / enum / id param is returned unchanged, so only finds with a
 * numeric or boolean param change bytes at all.
 *
 * Found 2026-08-05 by the caller-census drain: `corpus/document`'s
 * `popular(min: int)` — an in-memory find over a jsonb document — was driven
 * for the first time and answered `[]` where every other backend answered 1.
 */
export function findParamRead(p: { name: string; type?: TypeIR }): string {
  const raw = `params[${JSON.stringify(p.name)}]`;
  switch (findParamCoercion(p.type)) {
    case "int":
      return `__find_int(${raw})`;
    case "decimal":
      return `__find_decimal(${raw})`;
    case "bool":
      return `__find_bool(${raw})`;
    case "datetime":
      return `__find_datetime(${raw})`;
    case "date":
      return `__find_date(${raw})`;
    default:
      return raw;
  }
}

/** The `page_param/4` reader, once per controller whose auto-`all` `index`
 *  is paged — shared with the queryHandler controller (`page-param.ts`) rather
 *  than copied into each, so both clamp and refuse identically.  Abstract
 *  bases serve no index. */
export function renderPageParamHelper(agg: AggregateIR, ctx: BoundedContextIR): string {
  const indexAllFind = (ctx.repositories ?? [])
    .find((r) => r.aggregateName === agg.name)
    ?.finds?.find((f) => f.name === "all");
  const indexPaged =
    !isAbstractBase(agg) && !!(indexAllFind && pagedReturn(indexAllFind.returnType));
  return indexPaged ? PAGE_PARAM_HELPER : "";
}
