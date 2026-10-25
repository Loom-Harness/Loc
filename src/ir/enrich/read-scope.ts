// Phase ⑥ read fact — `readScope`: every restriction a read of an aggregate
// must apply, in one ordered, typed list.
//
// A read of `Car` (a TPH concrete of `Vehicle with softDeletable`, in a
// `tenantOwned` hierarchy, with `filter this.seats > 0`) must apply four things:
// the `kind = 'Car'` discriminator, the inherited `softDeletable` filter, the
// tenancy stance's predicate, and the bare filter.  Every one of those is
// already a fact on the enriched IR — the discriminator is a function of the
// `extends` chain, and enrichment has merged every filter (inherited first,
// see `inherited-capabilities.ts`; tenancy widened by `policy` levels; `deny`
// appended) into `contextFilters` with its `contextFilterOrigins` provenance.
// What no backend had was ONE answer to "which of these apply to this read,
// which may `ignoring` drop, and where is each one declared" — so each backend
// re-derived it from the three index-aligned arrays, and they drifted.
//
// The fact is DERIVED, never stamped (CLAUDE.md "Derive, don't stamp"): it is a
// pure function of the enriched aggregate and its context's aggregate pool, so
// it is computed on demand by the accessors below and cannot go stale against
// the arrays it reads.  Backends consume `readScopeFor` (a concrete or a
// standalone aggregate) and, for a TPH root's polymorphic read,
// `subtypeRestrictions` — each concrete's own filters in ROOT-HOSTED,
// discriminator-guarded form (`kind <> 'Car' OR <pred>`).  That shape is the
// one every ORM agrees on: EF Core, Hibernate, SQLAlchemy and MikroORM apply a
// filter declared on a subtype only to queries OF that subtype, never to a
// query of the base, and EF/Hibernate additionally require filters to be
// declared on the root.
//
// Reads with no declared order get the deterministic `id` order: `readOrderFor`.
// The database's physical order moves a row whenever an update rewrites it, so
// an unordered read answers differently from run to run and backend to backend.
// Where ids are UUIDv7 (node), `id` order also tracks creation order.

import type { AggregateIR, ExprIR, SortTermIR } from "../types/loom-ir.js";
import {
  type AggPool,
  baseOf,
  discriminatorValue,
  isTphBase,
  tphConcretesOf,
} from "../util/inheritance.js";
import { defaultSortOrder } from "../util/sortable-fields.js";
import {
  deepScopeAnchorClaim,
  isDeepScopeFilter,
  isDenyFilter,
  ROOT_ORG_CLAIM_FIELD,
  TENANCY_SELF_SCOPE_ORIGIN,
  TENANT_OWNED_CAPABILITY,
} from "../util/tenant-stance.js";

/** What a restriction is.
 *
 *   - `discriminator` — the TPH `kind = '<Concrete>'` scope over the shared
 *                       table.  Carries no predicate; each backend spells its
 *                       discriminator column.  Never bypassable.
 *   - `tenancy`       — the tenant boundary: `tenantOwned`'s floor (or its
 *                       `policy`-widened deep/global subtree sentinel), or the
 *                       registry's derived self-scope.  See `tenancy`.
 *   - `capability`    — a filter a capability contributed (`softDeletable`).
 *   - `deny`          — a `policy { deny on X }` carve-out (always false).
 *                       Never bypassable.
 *   - `filter`        — a bare, author-written `filter <expr>`.  Never
 *                       bypassable: `ignoring` names capabilities only. */
export type ReadRestrictionKind = "discriminator" | "tenancy" | "capability" | "deny" | "filter";

/** The tenancy stance a `tenancy` restriction enforces, read off its predicate:
 *  `tenant` the flat `tenantId ==` floor, `deep` the caller's org + descendants,
 *  `global` the caller's root-org subtree, `self` the registry's own-row scope
 *  (`this.id == currentUser.<claim>`). */
export type TenancyStance = "tenant" | "deep" | "global" | "self";

/** One restriction a read applies. */
export interface ReadRestriction {
  kind: ReadRestrictionKind;
  /** The row predicate over the candidate (`this`).  Absent only for a
   *  `discriminator`, which is a column equality each backend spells. */
  predicate?: ExprIR;
  /** The concrete's discriminator value (`discriminator` restrictions only). */
  discriminator?: string;
  /** Set when the predicate is exactly one named `criterion` reference — for
   *  backends that call the reified criterion instead of inlining the body. */
  criterionRef?: { name: string; args: ExprIR[] };
  /** The provenance `ignoring <name>` resolves against: the contributing
   *  capability (`softDeletable`, `tenantOwned`), or the `tenancy` marker for
   *  the registry self-scope (reachable only by `ignoring *`).  Undefined for a
   *  bare filter, a deny and a discriminator. */
  capability?: string;
  /** True when some `ignoring` clause can drop this restriction — exactly the
   *  restrictions with a `capability`. */
  bypassable: boolean;
  /** The aggregate that declares the restriction: an ancestor for an inherited
   *  filter, the aggregate itself otherwise. */
  declaredOn: string;
  /** True when `declaredOn` is an ancestor (the filter reached this aggregate
   *  through `extends`). */
  inherited: boolean;
  /** The tenancy stance (`tenancy` restrictions only). */
  tenancy?: TenancyStance;
}

/** A subtype's restriction hosted on its TPH root, guarded by the subtype's
 *  discriminator: it constrains rows whose `kind` is `discriminator` and leaves
 *  every other row alone — `kind <> '<discriminator>' OR <predicate>`. */
export interface GuardedReadRestriction {
  discriminator: string;
  restriction: ReadRestriction;
}

/** A read's `ignoring` stance — `ignoring *` (`bypassAll`) or `ignoring A, B`
 *  (`bypassCaps`), as carried on `FindIR`, a repo-run stmt or a projection
 *  query. */
export interface ReadBypass {
  bypassAll?: boolean;
  bypassCaps?: readonly string[];
}

export interface ReadScopeOptions {
  /** The read's `ignoring` clause; restrictions it names are omitted. */
  ignoring?: ReadBypass;
}

/** Every restriction one read of an aggregate applies. */
export interface ReadScope {
  aggregate: string;
  /** Applied conjunctively, in order: the discriminator first, then the
   *  filters root-most ancestor first and the aggregate's own last — the
   *  `contextFilters` order enrichment establishes. */
  restrictions: readonly ReadRestriction[];
  /** Non-empty only for a TPH root: each concrete's restrictions the root does
   *  not itself host, discriminator-guarded, concretes in pool order.  A
   *  polymorphic read of the root applies `restrictions` AND every entry. */
  subtypeRestrictions: readonly GuardedReadRestriction[];
}

/** True when `ignoring` drops a restriction of this provenance: `ignoring *`
 *  drops every capability-provenanced restriction, a named clause only the one
 *  it names.  Restrictions without provenance are never dropped. */
function isBypassedBy(capability: string | undefined, ignoring?: ReadBypass): boolean {
  if (!ignoring || capability === undefined) return false;
  if (ignoring.bypassAll) return true;
  return (ignoring.bypassCaps ?? []).includes(capability);
}

function tenancyStanceOf(predicate: ExprIR, origin: string | undefined): TenancyStance | undefined {
  if (origin === TENANCY_SELF_SCOPE_ORIGIN) return "self";
  if (origin !== TENANT_OWNED_CAPABILITY) return undefined;
  if (!isDeepScopeFilter(predicate)) return "tenant";
  return deepScopeAnchorClaim(predicate) === ROOT_ORG_CLAIM_FIELD ? "global" : "deep";
}

/** `agg` and its ancestors, root-most first. */
function lineage(agg: AggregateIR, pool: AggPool): AggregateIR[] {
  const out: AggregateIR[] = [agg];
  const seen = new Set<string>([agg.name]);
  let cur = baseOf(agg, pool);
  while (cur && !seen.has(cur.name)) {
    out.unshift(cur);
    seen.add(cur.name);
    cur = baseOf(cur, pool);
  }
  return out;
}

/** Every filter restriction on `agg`, bypass not yet applied.  The `i`-th
 *  `contextFilters` entry is declared on the root-most ancestor whose own
 *  (merged) list already reaches index `i` — enrichment puts each ancestor's
 *  filters ahead of its descendants'. */
function filterRestrictions(agg: AggregateIR, pool: AggPool): ReadRestriction[] {
  const chain = lineage(agg, pool);
  return (agg.contextFilters ?? []).map((predicate, i): ReadRestriction => {
    const origin = agg.contextFilterOrigins?.[i];
    const host = chain.find((a) => (a.contextFilters?.length ?? 0) > i) ?? agg;
    const tenancy = tenancyStanceOf(predicate, origin);
    const kind: ReadRestrictionKind = isDenyFilter(predicate)
      ? "deny"
      : tenancy
        ? "tenancy"
        : origin !== undefined
          ? "capability"
          : "filter";
    const criterionRef = agg.contextFilterRefs?.[i];
    return {
      kind,
      predicate,
      ...(criterionRef ? { criterionRef } : {}),
      ...(origin !== undefined ? { capability: origin } : {}),
      bypassable: origin !== undefined,
      declaredOn: host.name,
      inherited: host !== agg,
      ...(tenancy ? { tenancy } : {}),
    };
  });
}

/** The restrictions a read of `agg` applies (resolved within its context's
 *  aggregate `pool`), with the read's `ignoring` clause applied.  For a TPH
 *  root, `subtypeRestrictions` carries the root-hosted, discriminator-guarded
 *  form of every concrete's own restrictions. */
export function readScopeFor(
  agg: AggregateIR,
  pool: AggPool,
  opts: ReadScopeOptions = {},
): ReadScope {
  const kept = (r: ReadRestriction): boolean => !isBypassedBy(r.capability, opts.ignoring);
  const discriminator = discriminatorValue(agg, pool);
  const restrictions: ReadRestriction[] = [
    ...(discriminator
      ? [
          {
            kind: "discriminator" as const,
            discriminator,
            bypassable: false,
            declaredOn: agg.name,
            inherited: false,
          },
        ]
      : []),
    ...filterRestrictions(agg, pool).filter(kept),
  ];
  const subtypeRestrictions: GuardedReadRestriction[] = isTphBase(agg, pool)
    ? tphConcretesOf(agg, pool).flatMap((concrete) => {
        const hosted = agg.contextFilters?.length ?? 0;
        const d = discriminatorValue(concrete, pool)!;
        return filterRestrictions(concrete, pool)
          .slice(hosted)
          .filter(kept)
          .map((restriction) => ({ discriminator: d, restriction }));
      })
    : [];
  return { aggregate: agg.name, restrictions, subtypeRestrictions };
}

/** The discriminator a read of `agg` is scoped by, or undefined when it reads
 *  a table of its own. */
export function readDiscriminator(scope: ReadScope): string | undefined {
  return scope.restrictions.find((r) => r.kind === "discriminator")?.discriminator;
}

/** The predicate-carrying restrictions of a scope (everything but the
 *  discriminator), in application order. */
export function readFilterRestrictions(
  scope: ReadScope,
): (ReadRestriction & { predicate: ExprIR })[] {
  return scope.restrictions.filter(
    (r): r is ReadRestriction & { predicate: ExprIR } => r.predicate !== undefined,
  );
}

/** One ORDER BY term over a candidate column. */
export interface ReadOrderTerm {
  field: string;
  direction: "asc" | "desc";
}

/** The order a read returns rows in: its declared terms with `id` appended as
 *  the tie-break, or `id` ascending when it declares none — no read is left to the
 *  database's physical order. */
export function readOrderFor(declared?: readonly SortTermIR[]): ReadOrderTerm[] {
  return defaultSortOrder(declared) ?? [{ field: "id", direction: "asc" }];
}
