// ---------------------------------------------------------------------------
// Query-time `projection`s sourced from an aggregate synthesise a repository
// read — `repo.<projName>(<params>)` returns the filtered aggregate rows the
// projection route then follows (`join`) + projects (`select`).  The method
// is named after the projection (the `stem` of its type name), so the routes
// that call it and every builder that defines it spell it alike.
//
// The find carries the projection's OWN parameters: inlining `where:
// OwnedBy(o)` substitutes the criterion's body with the projection's parameter
// `o`, so the filter references a name only a parameterised method binds — a
// parameterless method reads a free variable (`TS2304` on node, a JPQL `:o`
// with no `@Param` on java), and an unused parameter returns unfiltered rows.
//
// EVERY TypeScript repository builder must emit these, whatever its persistence
// adapter or saving shape: the projection query routes call the method BY NAME
// (`repo.articleTitles()`), so a builder that skips them emits a project that
// does not compile ("Property 'articleTitles' does not exist on type
// '<Agg>Repository'").  The one synthesis lives here and every builder reads
// it; reusing the `FindIR` shape means each builder's find-method emitter
// (predicate lowering, capability-filter AND, hydration) applies for free.
// ---------------------------------------------------------------------------

import type { EnrichedBoundedContextIR, FindIR } from "../../ir/types/loom-ir.js";
import { isQueryTimeProjection, PLAIN_FIND_FLAGS } from "../../ir/types/loom-ir.js";
import { DOMAIN_NAMES } from "../_symbols/plan.js";

const N = DOMAIN_NAMES.ts;

/** The synthesised repository finds for every query-time projection in `ctx`
 *  sourced from the aggregate named `aggName`, in declaration order. */
export function synthProjectionFinds(aggName: string, ctx: EnrichedBoundedContextIR): FindIR[] {
  return (ctx.projections ?? [])
    .filter((p) => isQueryTimeProjection(p) && p.query?.source === aggName)
    .map((p) => ({
      ...PLAIN_FIND_FLAGS,
      name: N.stem(p.name),
      params: p.params ?? [],
      returnType: {
        kind: "array",
        element: { kind: "entity", name: aggName, declKind: "aggregate" },
      },
      filter: p.query?.filter,
      bypassAll: p.query?.bypassAll,
      bypassCaps: p.query?.bypassCaps,
    }));
}
