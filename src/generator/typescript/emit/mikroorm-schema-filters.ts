// -------------------------------------------------------------------------
// MikroORM schema filters — the read scope of an aggregate, declared ONCE on
// its `EntitySchema` as named `default: true` filters.
//
// MikroORM applies a default filter to every `find` / `findOne` / `count` /
// `nativeUpdate` / `nativeDelete` of the entity and (for a root-hosted filter)
// of every subclass of it, so a repository read states only its own `where`:
// no hand-ANDed capability predicate and no hand-ANDed `kind`.  The TPH
// discriminator is the entity class's own (`discriminatorColumn` +
// `discriminatorMap`), so `find(CarRow)` is scoped to `kind = 'Car'` by the ORM.
//
// The restrictions come from `readScopeFor` (src/ir/enrich/read-scope.ts),
// which every backend renders from.  Each is named by its provenance:
//
//   - a capability's filter (`softDeletable`, `tenantOwned`) takes the
//     capability's name, so `ignoring X` is `{ filters: { X: false } }`;
//   - a bare `filter <expr>` and a `policy` deny are never bypassable and take
//     fixed names, so no `ignoring` can name them.
//
// A TPH root hosts EVERY subtype's own restrictions, guarded by the subtype's
// discriminator (`kind <> 'Car' OR <pred>`).  MikroORM applies a filter
// declared on a subclass only to queries OF that subclass, so a read of the
// base (`find(VehicleRow)`) would otherwise serve a retired `Car`.
//
// A principal-referencing predicate (tenancy) is a function `cond`: it reads
// the request principal through the ambient accessor when the QUERY runs, so a
// query with no principal throws instead of reading unscoped (fail closed).
// -------------------------------------------------------------------------

import {
  type ReadBypass,
  type ReadRestriction,
  readScopeFor,
} from "../../../ir/enrich/read-scope.js";
import type { EnrichedAggregateIR } from "../../../ir/types/loom-ir.js";
import {
  discriminatorValue,
  isTphBase,
  isTphConcrete,
  rootBaseOf,
  tphConcretesOf,
} from "../../../ir/util/inheritance.js";
import { AMBIENT_PRINCIPAL, whereToMikroFilter } from "./mikroorm-filter.js";

/** Filter names a restriction without a capability provenance takes. */
const BARE_FILTER_NAME = "loom.filter";
const DENY_FILTER_NAME = "loom.deny";

/** A condition one concrete's own restriction contributes to a TPH root's
 *  filter, discriminator-guarded. */
export interface GuardedCond {
  /** The concrete aggregate's name. */
  concrete: string;
  /** `{ $or: [{ kind: { $ne: 'Car' } }, <pred>] }`. */
  cond: string;
}

/** One named default filter on an entity schema. */
export interface MikroSchemaFilter {
  /** The filter's registry name — the capability's name when bypassable. */
  name: string;
  /** The conditions that apply to a query of ANY entity of the schema. */
  base: string[];
  /** A TPH root's concretes' own conditions.  A concrete's predicate can name
   *  a column only that concrete has, and MikroORM rejects a condition on a
   *  property the QUERIED entity lacks — so a guarded condition joins the
   *  filter only for a query of the root or of its own concrete. */
  guarded: GuardedCond[];
  /** The capability whose `ignoring` clause switches this filter off.
   *  Undefined for a filter no `ignoring` may drop. */
  capability?: string;
}

function filterName(r: ReadRestriction): string {
  if (r.capability !== undefined) return r.capability;
  return r.kind === "deny" ? DENY_FILTER_NAME : BARE_FILTER_NAME;
}

/** The aggregate whose `EntitySchema` carries `agg`'s filters: a TPH concrete
 *  owns no schema of its own and reads through its root's. */
export function filterHostOf(agg: EnrichedAggregateIR, pool: readonly EnrichedAggregateIR[]) {
  return isTphConcrete(agg, pool) ? (rootBaseOf(agg, pool) as EnrichedAggregateIR) : agg;
}

/** The TPH concretes of `root`, as enriched aggregates of `pool`. */
export function tphConcreteAggregates(
  root: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
): EnrichedAggregateIR[] {
  const names = new Set(tphConcretesOf(root, pool).map((c) => c.name));
  return pool.filter((a) => names.has(a.name));
}

/** The named default filters `host`'s schema declares.  `host` is a schema
 *  owner: a standalone aggregate, a TPC concrete or a TPH root. */
export function mikroSchemaFilters(
  host: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
): MikroSchemaFilter[] {
  const scope = readScopeFor(host, pool);
  const filters = new Map<string, MikroSchemaFilter>();
  const slot = (r: ReadRestriction): MikroSchemaFilter => {
    const name = filterName(r);
    let f = filters.get(name);
    if (!f) {
      f = {
        name,
        base: [],
        guarded: [],
        ...(r.capability !== undefined ? { capability: r.capability } : {}),
      };
      filters.set(name, f);
    }
    return f;
  };
  // Same-named restrictions (a capability's filter reaching the schema from
  // several declarations) are ONE filter: their conditions conjoin.
  for (const r of scope.restrictions) {
    if (r.predicate === undefined) continue;
    slot(r).base.push(whereToMikroFilter(r.predicate, AMBIENT_PRINCIPAL, host.associations));
  }
  if (isTphBase(host, pool)) {
    const concretes = tphConcreteAggregates(host, pool);
    for (const { discriminator, restriction } of scope.subtypeRestrictions) {
      if (restriction.predicate === undefined) continue;
      const owner = concretes.find((c) => discriminatorValue(c, pool) === discriminator) ?? host;
      const cond = whereToMikroFilter(restriction.predicate, AMBIENT_PRINCIPAL, owner.associations);
      slot(restriction).guarded.push({
        concrete: owner.name,
        cond: `{ $or: [{ kind: { $ne: ${JSON.stringify(discriminator)} } }, ${cond}] }`,
      });
    }
  }
  return [...filters.values()];
}

const conj = (conds: readonly string[]): string =>
  conds.length === 1 ? conds[0]! : `{ $and: [${conds.join(", ")}] }`;

/** The `filters:` property of an `EntitySchema` literal, as source lines
 *  (empty when the schema hosts none).  `rowOf` names an aggregate's Row
 *  class; `host` is the schema's own aggregate. */
export function mikroSchemaFilterLines(
  host: EnrichedAggregateIR,
  filters: readonly MikroSchemaFilter[],
  rowOf: (aggregate: string) => string,
): string[] {
  if (filters.length === 0) return [];
  const entry = (f: MikroSchemaFilter): string => {
    const name = JSON.stringify(f.name);
    if (f.guarded.length === 0) {
      return `    ${name}: { name: ${name}, cond: () => (${conj(f.base)}), default: true },`;
    }
    // The concretes' conditions join per queried entity (see `guarded`).
    const rootRow = JSON.stringify(rowOf(host.name));
    return [
      `    ${name}: {`,
      `      name: ${name},`,
      `      args: false,`,
      `      default: true,`,
      `      cond: (_args, _type, _em, _options, entity) => {`,
      `        const parts: object[] = [${f.base.join(", ")}];`,
      ...f.guarded.map(
        (g) =>
          `        if (entity === ${rootRow} || entity === ${JSON.stringify(rowOf(g.concrete))}) parts.push(${g.cond});`,
      ),
      `        return parts.length === 0 ? {} : { $and: parts };`,
      `      },`,
      `    },`,
    ].join("\n");
  };
  return [`  filters: {`, ...filters.map(entry), `  },`];
}

/** The `filters` names a read with this `ignoring` clause switches off on
 *  `agg`'s schema.  Only filters the schema actually declares are named. */
export function mikroBypassedFilters(
  agg: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
  bypass?: ReadBypass,
): string[] {
  if (!bypass || (!bypass.bypassAll && (bypass.bypassCaps ?? []).length === 0)) return [];
  const names = new Set<string>();
  for (const f of mikroSchemaFilters(filterHostOf(agg, pool), pool)) {
    if (f.capability === undefined) continue;
    if (bypass.bypassAll || (bypass.bypassCaps ?? []).includes(f.capability)) names.add(f.name);
  }
  return [...names];
}

/** The `filters:` ORM option fragment (`filters: { "softDeletable": false }`)
 *  for a read's `ignoring` clause, or null when it bypasses nothing. */
export function mikroFilterOption(
  agg: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
  bypass?: ReadBypass,
): string | null {
  const names = mikroBypassedFilters(agg, pool, bypass);
  if (names.length === 0) return null;
  return `filters: { ${names.map((n) => `${JSON.stringify(n)}: false`).join(", ")} }`;
}

/** The ORM options literal of a read: its `ignoring` filters plus `extra`
 *  options (`limit`, `orderBy`, …); null when there is neither. */
export function mikroReadOptions(
  agg: EnrichedAggregateIR,
  pool: readonly EnrichedAggregateIR[],
  bypass?: ReadBypass,
  extra: readonly string[] = [],
): string | null {
  const parts = [...extra, mikroFilterOption(agg, pool, bypass)].filter(
    (p): p is string => p !== null,
  );
  return parts.length === 0 ? null : `{ ${parts.join(", ")} }`;
}
