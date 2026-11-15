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

/** Whether the auto-derived REST layer exposes a **create** endpoint
 * (`POST /<coll>`) — and the request DTO / create command / factory-call
 * that ride it — for this aggregate.  Symmetric with the DELETE gate
 * (`canonicalDestroy != null`): a create endpoint appears only when the
 * aggregate declares an EXPLICIT canonical `create` member (written by hand
 * or synthesised by `with crudish`), never merely because the aggregate
 * happens to be `isConstructible`.  An event-sourced aggregate keeps
 * the creation-event gate — it is created via its declared `create` event.
 *
 * This is deliberately distinct from `isConstructible` / `hasCreate`
 * (`ir/enrich/wire-projection.ts`), which stay the gate for the DOMAIN factory
 * (`Agg.create(...)`) that seeds and tests call directly even when no REST
 * create is exposed. */
export function emitsRestCreate(agg: {
  readonly persistedAs?: string;
  readonly creates?: readonly OperationIR[];
}): boolean {
  return agg.persistedAs === "eventLog"
    ? (agg.creates?.length ?? 0) > 0
    : canonicalCreate(agg) != null;
}
