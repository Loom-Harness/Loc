// ---------------------------------------------------------------------------
// Query-time `projection`s sourced from an aggregate synthesise a repository
// read — `repo.<projName>(<params>)` returns the filtered aggregate rows the
// projection route then follows (`join`) + projects (`select`).
//
// The find carries the projection's OWN parameters.  It used to hard-code
// `params: []` on the reasoning that "a parameterised projection's `where`
// still lowers criterion params away at compile time, so the synthesised find
// stays parameterless".  That is false: inlining `where: OwnedBy(o)` substitutes
// the criterion's body with the PROJECTION's parameter `o` in the predicate, so
// the filter expression references a name the parameterless method never binds.
// Every backend then emitted a method whose body read a free variable —
// `TS2304: Cannot find name 'o'` on node, the same shape on .NET and python, and
// a JPQL `:o` with no `@Param` on java (which compiles, then fails at Spring
// context startup).  An UNUSED parameter was quieter and equally wrong: the read
// ignored it, so the route returned unfiltered rows.  Threading the params here
// gives every builder's find-method emitter the binding for free.
//
// EVERY TypeScript repository builder must emit these, whatever its persistence
// adapter or saving shape: the projection query routes call the method BY NAME
// (`repo.articleTitles()`), so a builder that skips them emits a project that
// does not compile ("Property 'articleTitles' does not exist on type
// '<Agg>Repository'").  That is exactly what the drizzle DOCUMENT builder did —
// the relational and MikroORM builders each carried their own copy of this
// synthesis and the document one had none — so the one copy lives here and all
// three read it.  Reusing the `FindIR` shape means each builder's find-method
// emitter (predicate lowering, capability-filter AND, hydration) applies for
// free.
// ---------------------------------------------------------------------------

import type { EnrichedBoundedContextIR, FindIR } from "../../ir/types/loom-ir.js";
import { isQueryTimeProjection } from "../../ir/types/loom-ir.js";
import { lowerFirst } from "../../util/naming.js";

/** The synthesised repository finds for every query-time projection in `ctx`
 *  sourced from the aggregate named `aggName`, in declaration order. */
export function synthProjectionFinds(aggName: string, ctx: EnrichedBoundedContextIR): FindIR[] {
  return (ctx.projections ?? [])
    .filter((p) => isQueryTimeProjection(p) && p.query?.source === aggName)
    .map((p) => ({
      name: lowerFirst(p.name),
      params: p.params ?? [],
      returnType: { kind: "array", element: { kind: "entity", name: aggName } },
      filter: p.query?.filter,
      bypassAll: p.query?.bypassAll,
      bypassCaps: p.query?.bypassCaps,
    }));
}
