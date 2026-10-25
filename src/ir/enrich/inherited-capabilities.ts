// Phase ⑥ — a concrete aggregate inherits its abstract bases' capabilities
// (D-INHERITED-CAPABILITIES).
//
// `Car extends Vehicle` where `Vehicle with softDeletable`: a `Car` IS a
// `Vehicle`, so the base's capability filters, its bare `filter` declarations,
// its stamps, its capability tags and its `crossTenant` stance apply to every
// concrete.  Lowering records them only on the declaring aggregate (it reads
// `agg.members`), so this pass copies them down the `extends` chain once —
// every backend then reads the merged `contextFilters` / `contextFilterRefs` /
// `contextFilterOrigins` / `contextStamps` / `capabilities` and needs no
// inheritance logic of its own, and the `ignoring <baseCap>` validator and the
// tenancy stance checks resolve against the same merged set.  Filters and
// stamps travel together: a tenant filter without the stamp that fills the
// column would hide every row the concrete creates.
//
// Order: the ancestors' filters come FIRST (root-most first), then the
// concrete's own.  `inheritedFilterCount` (`src/ir/util/inheritance.ts`) relies
// on that prefix to tell a backend which entries an ancestor hosts — EF Core
// under TPH registers the root's filters once on the root entity type, not per
// concrete.
//
// A concrete that re-applies a capability its base already applies (both say
// `with tenantOwned`) contributes that capability's filter once: the
// inherited entry wins and the concrete's own copy is dropped, so the filter is
// not applied twice and the prefix invariant above holds.  Stamps carry no
// capability origin, so they dedupe per assignment: an own assignment to a
// field the inherited rules already stamp on the same event is dropped.

import type { AggregateIR, ContextStampIR, ExprIR } from "../types/loom-ir.js";

type FilterEntry = {
  predicate: ExprIR;
  ref: { name: string; args: ExprIR[] } | undefined;
  origin: string | undefined;
};

function filterEntries(a: AggregateIR): FilterEntry[] {
  return (a.contextFilters ?? []).map((predicate, i) => ({
    predicate,
    ref: a.contextFilterRefs?.[i],
    origin: a.contextFilterOrigins?.[i],
  }));
}

function mergeStamps(
  inherited: readonly ContextStampIR[],
  own: readonly ContextStampIR[],
): ContextStampIR[] {
  const stamped = new Set(
    inherited.flatMap((r) => r.assignments.map((x) => `${r.event}:${x.field}`)),
  );
  const ownKept = own
    .map((r) => ({
      ...r,
      assignments: r.assignments.filter((x) => !stamped.has(`${r.event}:${x.field}`)),
    }))
    .filter((r) => r.assignments.length > 0);
  return [...inherited, ...ownKept];
}

/** Copy every abstract ancestor's filters, stamps, capability tags and
 *  `crossTenant` stance onto each
 *  aggregate that `extends` it, resolved within one context's aggregate list.
 *  Aggregates with no ancestor carrying any of them are returned unchanged (same
 *  object), so a model without inherited restrictions is byte-identical. */
export function inheritBaseCapabilities(aggs: readonly AggregateIR[]): AggregateIR[] {
  const byName = new Map(aggs.map((a) => [a.name, a] as const));
  const merged = new Map<string, AggregateIR>();
  const resolve = (a: AggregateIR, seen: Set<string>): AggregateIR => {
    const done = merged.get(a.name);
    if (done) return done;
    const baseIr = a.extendsAggregate ? byName.get(a.extendsAggregate) : undefined;
    // `seen` keeps a malformed `extends` cycle finite; the language-side cycle
    // validator rejects those upstream.
    if (!baseIr || seen.has(a.name)) {
      merged.set(a.name, a);
      return a;
    }
    seen.add(a.name);
    const base = resolve(baseIr, seen);
    const inherited = filterEntries(base);
    const baseCaps = base.capabilities ?? [];
    const baseStamps = base.contextStamps ?? [];
    if (
      inherited.length === 0 &&
      baseCaps.length === 0 &&
      baseStamps.length === 0 &&
      !base.crossTenant
    ) {
      merged.set(a.name, a);
      return a;
    }
    const inheritedOrigins = new Set(inherited.map((f) => f.origin).filter((o) => o != null));
    const own = filterEntries(a).filter((f) => f.origin == null || !inheritedOrigins.has(f.origin));
    const filters = [...inherited, ...own];
    const caps = [...new Set([...baseCaps, ...(a.capabilities ?? [])])].sort();
    const stamps = mergeStamps(baseStamps, a.contextStamps ?? []);
    const out: AggregateIR = {
      ...a,
      contextFilters: filters.length > 0 ? filters.map((f) => f.predicate) : undefined,
      contextFilterRefs: filters.some((f) => f.ref) ? filters.map((f) => f.ref) : undefined,
      contextFilterOrigins: filters.some((f) => f.origin)
        ? filters.map((f) => f.origin)
        : undefined,
      contextStamps: stamps.length > 0 ? stamps : undefined,
      capabilities: caps.length > 0 ? caps : undefined,
      crossTenant: a.crossTenant || base.crossTenant ? true : undefined,
    };
    merged.set(a.name, out);
    return out;
  };
  return aggs.map((a) => resolve(a, new Set<string>()));
}
