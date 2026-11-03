// The HOME context of a query-time projection's `from` source.
//
// A projection may read an aggregate (or workflow / folded projection) declared
// in another context of its subdomain.  Everything a read of that source must
// apply — its capability filters, its tenancy floor, its TPH discriminator —
// and everything a backend names for it — its table, its schema module, its
// repository — belongs to the context the source is DECLARED in, not to the
// projection's own.  A backend that emits per context and looks `source` up in
// the projection's context finds nothing, and then reads the table with no
// scope at all (a cross-tenant leak) or names a module that does not exist.
//
// Name resolution already linked the source to its declaration; lowering
// records the declaring context as `ProjectionQueryIR.sourceContext`.  These
// helpers are the one way to turn that fact back into the context and the
// source declaration.

import type { AggregateIR, BoundedContextIR, ProjectionIR } from "../types/loom-ir.js";

type ContextLike = Pick<BoundedContextIR, "name">;

/** The context `p`'s `from` source is declared in, among `contexts` (the
 *  context hosting `p` is `host`).  Undefined when `p` has no source or its
 *  home context is not among `contexts`. */
export function projectionSourceContext<C extends ContextLike>(
  p: ProjectionIR,
  host: C,
  contexts: readonly C[],
): C | undefined {
  if (!p.query?.source) return undefined;
  const home = p.query.sourceContext ?? host.name;
  if (home === host.name) return host;
  return contexts.find((c) => c.name === home);
}

/** `p`'s source AGGREGATE and its home context, or undefined for a workflow /
 *  projection source, a source whose home context is not among `contexts`, or
 *  no source at all. */
export function projectionSourceAggregate<
  C extends ContextLike & { aggregates: readonly AggregateIR[] },
>(
  p: ProjectionIR,
  host: C,
  contexts: readonly C[],
): { agg: C["aggregates"][number]; ctx: C } | undefined {
  const kind = p.query?.sourceKind;
  if (kind === "workflow" || kind === "projection") return undefined;
  const ctx = projectionSourceContext(p, host, contexts);
  const agg = ctx?.aggregates.find((a) => a.name === p.query!.source);
  return ctx && agg ? { agg, ctx } : undefined;
}
