import { type AggPool, isTphConcrete, rootBaseOf } from "../../ir/util/inheritance.js";
import { plural, upperFirst } from "../../util/naming.js";

// Where an EF Core read of an aggregate starts.
//
// A TPH (`sharedTable`) concrete is read FROM ITS ROOT: `_db.Vehicles.OfType<Car>()`,
// never `_db.Cars`.  Every query filter of a hierarchy is registered on the root
// entity type, and a subtype's own filter is hosted there type-guarded —
// `!(x is Car) || !((Car)x).IsDeleted` — so it narrows Car rows only.  EF
// translates that guard when the query source is the root (or `OfType<C>()` of
// it), and refuses to build it over a concrete `DbSet<Truck>` ("No coercion
// operator is defined between types 'Truck' and 'Car'").  So the AppDbContext
// exposes no `DbSet<Concrete>` for a TPH concrete at all: a read that names one
// does not compile.  Writes go through the root set too — `Add`/`Remove` and
// the `Local` identity-map probe are not queries, but routing them through the
// root keeps every emitted reference to the hierarchy on the one set.
//
// Every other aggregate (standalone, TPC concrete, document, event-sourced)
// reads its own `DbSet<Agg>` under its pluralised name.

/** The `AppDbContext` member a read of `agg` starts from — `Vehicles.OfType<Car>()`
 *  for a TPH concrete, `<Agg>s` otherwise. */
export function efReadSource(agg: { name: string }, pool: AggPool): string {
  const full = pool.find((a) => a.name === agg.name);
  if (full && isTphConcrete(full, pool)) {
    return `${efSetName(rootBaseOf(full, pool).name)}.OfType<${full.name}>()`;
  }
  return efSetName(agg.name);
}

/** The `DbSet` an `Add` / `Remove` / `Local` probe of `agg` uses — the root's
 *  set for a TPH concrete, its own otherwise. */
export function efWriteSet(agg: { name: string }, pool: AggPool): string {
  const full = pool.find((a) => a.name === agg.name);
  if (full && isTphConcrete(full, pool)) return efSetName(rootBaseOf(full, pool).name);
  return efSetName(agg.name);
}

/** The `AppDbContext` `DbSet` property name an entity type is exposed under. */
export function efSetName(entityName: string): string {
  return plural(upperFirst(entityName));
}
