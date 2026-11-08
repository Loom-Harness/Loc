// ---------------------------------------------------------------------------
// Vanilla controller read helper shared by the aggregate controller and the
// event-sourced controller: `renderPageParamHelper`, the once-per-controller
// `page_param/4` reader the auto-`all` `index` action's `page`/`pageSize`
// reads go through.  Query-param checking and coercion live in
// `query-param.ts`.
//
// A repository declares no reads of its own, so there is no per-find route or
// action here: the only HTTP find is the auto-`all` index, rendered by
// `api-emit.ts`.
// ---------------------------------------------------------------------------

import { pagedReturn } from "../../../ir/stdlib/generics.js";
import type { AggregateIR, BoundedContextIR } from "../../../ir/types/loom-ir.js";
import { isAbstractBase } from "./inheritance-emit.js";
import { PAGE_PARAM_HELPER } from "./page-param.js";

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
