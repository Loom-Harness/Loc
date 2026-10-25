// The canonical (unnamed) `create` / `destroy` of an aggregate.
//
// Derived on demand from `creates` / `destroys` rather than stored beside
// them: a stored copy has to be re-pointed every time a pass rebuilds those
// arrays (enrichment stamps `routeSlug` onto fresh objects), and a pass that
// forgets leaves readers holding a stale operation.

import type { OperationIR } from "../types/loom-ir.js";

type HasCreates = { readonly creates?: readonly OperationIR[] } | null | undefined;
type HasDestroys = { readonly destroys?: readonly OperationIR[] } | null | undefined;

/** The single unnamed canonical `create`, or null when none is declared. */
export function canonicalCreate(agg: HasCreates): OperationIR | null {
  return agg?.creates?.find((c) => c.canonical) ?? null;
}

/** The single unnamed canonical `destroy`, or null when none is declared. */
export function canonicalDestroy(agg: HasDestroys): OperationIR | null {
  return agg?.destroys?.find((d) => d.canonical) ?? null;
}
