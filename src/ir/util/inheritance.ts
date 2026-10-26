// Platform-neutral aggregate-inheritance helpers (aggregate-inheritance.md).
//
// The single source of truth for the TPH (`sharedTable`) and TPC (`ownTable`)
// predicates every backend needs — "is this an abstract TPH/TPC base", "what
// are its concrete subtypes", "which table owns a concrete", "what `kind`
// discriminator value a concrete stamps", "which of a concrete's fields are
// its own vs inherited from the base".  They live under `ir/util/` (not a
// generator) so every backend — `typescript/`, `dotnet/`,
// `elixir/` — and the system migration builder consume them
// without importing across platform folders (the one-directional layering
// rule: `generator/<platform>` knows nothing about other platforms).

import { plural, snake, uniqueIndexName } from "../../util/naming.js";
import type { AggregateIR, FieldIR, UniqueKeyIR } from "../types/loom-ir.js";

/** The aggregate pool a base is resolved within — a context's aggregate
 *  list.  All helpers take this so the base/concrete relationship resolves
 *  identically for every emitter. */
export type AggPool = readonly AggregateIR[];

/** Default inheritance layout when the modifier is omitted — TPH
 *  (`sharedTable`), the documented default (aggregate-inheritance.md). */
const DEFAULT_LAYOUT = "sharedTable" as const;

/** The abstract base `agg` extends (resolved within `pool`), or undefined
 *  when `agg` is not a subtype / the base is in another context. */
export function baseOf(agg: AggregateIR, pool: AggPool): AggregateIR | undefined {
  if (!agg.extendsAggregate) return undefined;
  return pool.find((a) => a.name === agg.extendsAggregate);
}

/** `agg`'s ancestor chain (its `extends` bases resolved within `pool`),
 *  nearest first and root last.  A `seen` guard keeps a malformed cycle
 *  finite (the language-side `extends`-cycle validator rejects these
 *  upstream; this just prevents an infinite loop if one slips through). */
function chainOf(agg: AggregateIR, pool: AggPool): AggregateIR[] {
  const out: AggregateIR[] = [];
  let cur = agg;
  const seen = new Set<string>();
  while (cur.extendsAggregate && !seen.has(cur.name)) {
    seen.add(cur.name);
    const base = pool.find((a) => a.name === cur.extendsAggregate);
    if (!base) break;
    out.push(base);
    cur = base;
  }
  return out;
}

/** The root-most base of `agg`'s `extends` chain, or `agg` itself when it is
 *  a root (declares no `extends`).  In a multi-level chain (`Dog extends Pet
 *  extends Animal`) every intermediate base is abstract and owns no table —
 *  the single shared TPH table lives at the root. */
export function rootBaseOf(agg: AggregateIR, pool: AggPool): AggregateIR {
  const chain = chainOf(agg, pool);
  return chain.length > 0 ? chain[chain.length - 1] : agg;
}

/** True when `agg` descends (transitively) from the base named `baseName`. */
function descendsFrom(agg: AggregateIR, baseName: string, pool: AggPool): boolean {
  return chainOf(agg, pool).some((a) => a.name === baseName);
}

/** Effective inheritance layout for a participant: its own override wins,
 *  else the root base's, else the `sharedTable` default.  Resolving via the
 *  root (not just the direct base) keeps a multi-level chain's layout coherent
 *  — a layout declared only on the root reaches every leaf. */
function effectiveLayout(agg: AggregateIR, pool: AggPool): "sharedTable" | "ownTable" {
  return agg.inheritanceUsing ?? rootBaseOf(agg, pool).inheritanceUsing ?? DEFAULT_LAYOUT;
}

/** True when `agg` is an abstract base whose hierarchy uses TPC (`ownTable`):
 *  no base table, each concrete a standalone table.  It owns no storage, but
 *  is the read home for the polymorphic `find all <Base>` reader (which
 *  delegates to the concrete repositories). */
export function isTpcBase(agg: AggregateIR, pool: AggPool): boolean {
  return !!agg.isAbstract && effectiveLayout(agg, pool) === "ownTable";
}

/** True when `agg` is a concrete subtype of a TPC (`ownTable`) base — a
 *  standalone table carrying the merged base fields. */
export function isTpcConcrete(agg: AggregateIR, pool: AggPool): boolean {
  const base = baseOf(agg, pool);
  return !!base?.isAbstract && !agg.isAbstract && effectiveLayout(agg, pool) === "ownTable";
}

/** The concrete subtypes of a TPC base — every concrete that descends from it
 *  (transitively, so a multi-level chain's leaves are all read homes). */
export function tpcConcretesOf(base: AggregateIR, pool: AggPool): AggregateIR[] {
  return pool.filter((a) => descendsFrom(a, base.name, pool) && isTpcConcrete(a, pool));
}

/** A concrete's OWN fields — its declared fields minus the base fields the
 *  enrichment pass merged in (matched by name).  The enrichment merge prepends
 *  inherited base fields, so a concrete's `fields` is `[...base, ...own]`; this
 *  recovers just the own tail so an emitter can declare base fields on the
 *  abstract base class and leave the concrete to inherit them. */
export function ownFieldsOf(concrete: AggregateIR, base: AggregateIR): FieldIR[] {
  const baseNames = new Set(base.fields.map((f) => f.name));
  return concrete.fields.filter((f) => !baseNames.has(f.name));
}

/** How many of `agg`'s leading `contextFilters` it inherited from `ancestor`.
 *  The enrichment merge (`inheritBaseCapabilities`) puts every ancestor's
 *  filters before the concrete's own, so the inherited entries are exactly the
 *  ancestor's (already merged) filter list, in order.  0 when `ancestor` is
 *  `agg` itself or carries no filter. */
export function inheritedFilterCount(agg: AggregateIR, ancestor: AggregateIR): number {
  return ancestor === agg ? 0 : (ancestor.contextFilters?.length ?? 0);
}

// ---------------------------------------------------------------------------
// TPH (`sharedTable`) predicates — the whole hierarchy lives in ONE table
// named for the abstract base, with a `kind` discriminator column and the
// per-concrete columns made nullable.  These are the single source of truth
// the schema emitter, the repository builders, and the migration builder
// consult so the owning table name + discriminator are derived identically
// on every backend.
// ---------------------------------------------------------------------------

/** True when `agg` is the ROOT abstract base of a TPH hierarchy — i.e. it owns
 *  the single shared table for itself and every concrete subtype in the chain.
 *  An intermediate abstract base (`Pet` in `Dog extends Pet extends Animal`)
 *  is NOT a TPH base: the whole hierarchy lives in the root's one table, so an
 *  intermediate owns no table and emits nothing. */
export function isTphBase(agg: AggregateIR, pool: AggPool): boolean {
  return (
    !!agg.isAbstract &&
    effectiveLayout(agg, pool) === "sharedTable" &&
    rootBaseOf(agg, pool) === agg
  );
}

/** True when `agg` is a concrete subtype that shares its TPH base's table
 *  (so it emits no table of its own; its repo/routes target the base table
 *  filtered by `kind`). */
export function isTphConcrete(agg: AggregateIR, pool: AggPool): boolean {
  const base = baseOf(agg, pool);
  return !!base?.isAbstract && !agg.isAbstract && effectiveLayout(agg, pool) === "sharedTable";
}

/** The aggregate name that owns the physical table for `agg`: the ROOT-most
 *  TPH base for a TPH concrete, otherwise `agg` itself.  In a multi-level
 *  chain (`Dog extends Pet extends Animal`, both bases abstract TPH) the
 *  direct base is itself abstract and owns no table — the single shared
 *  table lives at the top of the chain, so walk `extends` to the root.
 *  A `seen` guard keeps a malformed cycle finite. */
export function tableOwnerName(agg: AggregateIR, pool: AggPool): string {
  return isTphConcrete(agg, pool) ? rootBaseOf(agg, pool).name : agg.name;
}

/** The `kind` discriminator value for a TPH concrete (its own name), or
 *  undefined when `agg` is not a TPH concrete. */
export function discriminatorValue(agg: AggregateIR, pool: AggPool): string | undefined {
  return isTphConcrete(agg, pool) ? agg.name : undefined;
}

/** The concrete subtypes that share a TPH base's table — every concrete that
 *  descends from it (transitively), so a multi-level chain's leaves all land
 *  their columns in the single root table. */
export function tphConcretesOf(base: AggregateIR, pool: AggPool): AggregateIR[] {
  return pool.filter((a) => descendsFrom(a, base.name, pool) && isTphConcrete(a, pool));
}

/** How many `extends` hops separate `agg` from its root base — 0 for a root,
 *  1 for a direct subtype, and so on.
 *
 *  Emitters that dispatch on the RUNTIME type need this: a C# `switch (entity)`
 *  over type patterns, a Java `instanceof` chain and a TS `instanceof` ladder
 *  all require the most-derived arm first.  Emitted in declaration order, a
 *  base arm ahead of its subtypes' makes those subtypes unreachable — which on
 *  .NET is `error CS8120` under `/warnaserror`, so the generated project does
 *  not build at all.  Sorting by this descending is the fix. */
export function inheritanceDepth(agg: AggregateIR, pool: AggPool): number {
  return chainOf(agg, pool).length;
}

/** Where a query-time projection over the aggregate `source` reads its rows:
 *  the aggregate that OWNS the physical table (`tableOwner`), plus — for a TPH
 *  (`sharedTable`) concrete — the `kind` discriminator value that scopes the
 *  shared table to this concrete's rows.
 *
 *  Every backend that pushes a projection down to SQL against the source's
 *  table (node's drizzle/mikro direct-table arms, python's SQLAlchemy
 *  select, elixir's Ecto `from`) must consult this rather than naming the
 *  table after the source: a TPH concrete owns NO table (node selected a
 *  nonexistent `schema.<concretes>`), and reading the shared table without the
 *  `kind` conjunct silently aggregates EVERY sibling concrete's rows.
 *  An unknown `source` (a workflow / projection raw-table source, or an
 *  aggregate outside `pool`) resolves to itself with no discriminator. */
export function projectionSourceTable(
  source: string,
  pool: AggPool,
): { tableOwner: string; kind?: string } {
  const agg = pool.find((a) => a.name === source);
  if (!agg) return { tableOwner: source };
  const kind = discriminatorValue(agg, pool);
  return kind
    ? { tableOwner: tableOwnerName(agg, pool), kind }
    : { tableOwner: tableOwnerName(agg, pool) };
}

// ---------------------------------------------------------------------------
// `unique (…)` keys across inheritance.  Enrichment copies every abstract
// ancestor's keys onto each TPC / TPH concrete, so the concrete's write surface
// maps the 23505 its rows can raise.  These helpers tell those copies apart
// from the keys a concrete declares itself, and say which index enforces each.
// ---------------------------------------------------------------------------

/** The column lists (`"a,b"`) of every `unique (…)` key `agg`'s abstract
 *  ancestors declare, when `agg` is a TPC or TPH concrete — the keys
 *  enrichment copies onto it.  Empty otherwise. */
export function ancestorUniqueKeySet(agg: AggregateIR, pool: AggPool): Set<string> {
  const out = new Set<string>();
  if (!isTpcConcrete(agg, pool) && !isTphConcrete(agg, pool)) return out;
  const seen = new Set<string>();
  for (let b = baseOf(agg, pool); b && !seen.has(b.name); b = baseOf(b, pool)) {
    seen.add(b.name);
    for (const uk of b.uniqueKeys ?? []) out.add(uk.columns.join(","));
  }
  return out;
}

/** The `unique (…)` keys `agg` declares ITSELF — its `uniqueKeys` minus the
 *  copies enrichment merged in from its abstract ancestors. */
export function ownUniqueKeysOf(agg: AggregateIR, pool: AggPool): UniqueKeyIR[] {
  const inherited = ancestorUniqueKeySet(agg, pool);
  return (agg.uniqueKeys ?? []).filter((uk) => !inherited.has(uk.columns.join(",")));
}

/** The index that enforces one of `agg`'s `unique (…)` keys: the physical
 *  table it lives on, its deterministic name, its columns and — for a TPH
 *  concrete's OWN key — the `kind` discriminator value it is partial on.
 *
 *  Why partial: the TPH table is shared by every concrete, and so is a column
 *  two concretes both declare (`tphTableForAggregate` de-duplicates columns by
 *  name).  A key declared on `Lathe` constrains Lathes; a FULL index on the
 *  shared column would also refuse a `Press` whose value matches a Lathe's —
 *  a constraint nobody declared.  `WHERE kind = 'Lathe'` scopes the index to
 *  exactly the rows the declaration is about.  A key inherited from the base
 *  stays a full index: the base declared it for the whole hierarchy. */
export function uniqueKeyIndex(
  agg: AggregateIR,
  uk: UniqueKeyIR,
  pool: AggPool,
): { table: string; name: string; columns: string[]; discriminator?: string } {
  const table = plural(snake(tableOwnerName(agg, pool)));
  const columns = uk.columns.map((c) => snake(c));
  const own =
    isTphConcrete(agg, pool) && !ancestorUniqueKeySet(agg, pool).has(uk.columns.join(","));
  if (!own) return { table, name: uniqueIndexName(table, columns), columns };
  return {
    table,
    name: uniqueIndexName(table, columns, agg.name),
    columns,
    discriminator: agg.name,
  };
}
