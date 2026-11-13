// ---------------------------------------------------------------------------
// Shared seed-dataset spine — the first `_persistence/` seam (M-T9.2).
//
// First-boot seeding (database-seeding.md) groups a context's `SeedIR`
// rows into datasets and derives which aggregates the domain path imports,
// identically across the SQL-relational backends (Hono/Drizzle, .NET/EF,
// FastAPI/SQLAlchemy).  `groupByDataset` and the `Entry`/`Dataset` model
// were byte-for-byte triplicated in each backend's `seed` emitter; this is
// their single home.  The per-backend `renderDatasetFn` framing (the
// `save`/`INSERT` call shape, imports, datetime coercion) stays in each
// emitter — the divergent leaf.
//
// Pure structural derivation over the shared IR (no target-backend IR, no
// upward import): lives at the generator layer, imported *down* by each
// `src/generator/<platform>/emit/seed.ts` — see https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/archive/missions/M-T9.2-persistence-seam-design.md §.
// ---------------------------------------------------------------------------

import { scalarCodecOf } from "../../ir/enrich/codec.js";
import { aggregateTableNameOf } from "../../ir/enrich/storage-names.js";
import {
  type CreateOmissionValue,
  createInputFields,
  type RequirableInput,
} from "../../ir/enrich/wire-projection.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  ExprIR,
  SeedRowIR,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import { discriminatorValue } from "../../ir/util/inheritance.js";
import { upperFirst } from "../../util/naming.js";

/** A bare numeric literal written into a `money` seed field (`minRent: 500.00`)
 *  is a money value, not a float: retag it so each backend's money-literal
 *  renderer (`new Decimal("500.00")` / `Decimal("500.00")`) spells it, keeping
 *  the digits exact (RS-12).  Any other expression passes through. */
export function asMoneySeedLiteral(value: ExprIR, type: TypeIR | undefined): ExprIR {
  if (!type || scalarCodecOf(type)?.wire.form !== "fixed-scale-decimal") return value;
  if (value.kind === "literal" && (value.lit === "decimal" || value.lit === "int"))
    return { ...value, lit: "money" };
  if (value.kind === "unary" && value.op === "-")
    return { ...value, operand: asMoneySeedLiteral(value.operand, type) };
  return value;
}

/** A seed row plus its block's path (domain create vs raw insert). */
export interface Entry {
  row: SeedRowIR;
  raw: boolean;
  /** The table the row's aggregate lives in (`aggregateTableNameOf`). */
  table: string;
}

/** One dataset's merged entries (across all `seed <dataset>` blocks). */
export interface Dataset {
  name: string;
  /** The dataset's key in the `__loom_seed` ship-once marker table — see
   *  {@link seedMarkerKey}. */
  marker: string;
  /** The identifier the backend's seeder function is named from (cased per
   *  backend): the dataset name, or `<context><Dataset>` when another hosted
   *  context declares a dataset of the same name. */
  ident: string;
  entries: Entry[];
}

/** The `__loom_seed` marker key of one context's dataset: `<Context>/<dataset>`.
 *  Deployables bound to one `storage` share its database, and with it one
 *  marker table, so a key of the dataset name alone would let the first
 *  context to seed `demo` mark every other context's `demo` as applied.  Each
 *  backend's `alreadySeeded` also honours a bare `<dataset>` row — the key a
 *  database seeded before the context was part of it holds — so an upgraded
 *  database never re-seeds a dataset it already has. */
export function seedMarkerKey(context: string, dataset: string): string {
  return `${context}/${dataset}`;
}

/** A raw row for a TPH concrete lands in the hierarchy's one shared table, whose
 *  `kind` discriminator is NOT NULL with no default — so the INSERT must name
 *  it.  The domain path writes it through the entity; only the raw path needs
 *  it spelled out. */
function withDiscriminator(
  row: SeedRowIR,
  pool: EnrichedBoundedContextIR["aggregates"],
): SeedRowIR {
  const agg = pool.find((a) => a.name === row.aggregate);
  const kind = agg ? discriminatorValue(agg, pool) : undefined;
  if (kind === undefined || row.fields.some((f) => f.name === "kind")) return row;
  return {
    ...row,
    fields: [
      ...row.fields,
      { name: "kind", value: { kind: "literal", lit: "string", value: kind } },
    ],
  };
}

/** Group every `SeedIR` row by dataset, preserving source order + path.
 *
 *  Datasets are keyed by their RAW name, and each backend derives the seeder
 *  function's identifier by casing that name (`snake` on elixir/python,
 *  `upperFirst` on node/java/.NET) with no uniquifier — so two datasets whose
 *  names collide under either transform would emit one duplicated function
 *  (`F2-SEED-DATASET-NAME-COLLISION`).  The uniqueness that makes this keying
 *  safe is enforced upstream by `loom.seed-dataset-name-collision`
 *  (src/language/validators/seed.ts), not here. */
export function groupByDataset(ctx: EnrichedBoundedContextIR): Dataset[] {
  const byKey = new Map<string, Dataset>();
  for (const seed of ctx.seeds) {
    const key = seedMarkerKey(seed.context, seed.dataset);
    let ds = byKey.get(key);
    if (!ds) {
      ds = { name: seed.dataset, marker: key, ident: seed.dataset, entries: [] };
      byKey.set(key, ds);
    }
    for (const row of seed.rows) {
      const raw = seed.path === "raw";
      ds.entries.push({
        row: raw ? withDiscriminator(row, ctx.aggregates) : row,
        raw,
        table: aggregateTableNameOf(row.aggregate, ctx.aggregates),
      });
    }
  }
  const datasets = [...byKey.values()];
  // A merged context (a deployable hosting several contexts) can hold two
  // contexts' datasets of one name: each keeps its own marker, and its
  // function is named for its context too.
  for (const ds of datasets) {
    if (datasets.some((o) => o !== ds && o.name === ds.name)) {
      const context = ds.marker.slice(0, ds.marker.indexOf("/"));
      ds.ident = `${context.charAt(0).toLowerCase()}${context.slice(1)}${upperFirst(ds.name)}`;
    }
  }
  return datasets;
}

/** Aggregate names whose domain class/repository are imported — `raw` rows
 *  emit pure SQL and import nothing. */
export function usedAggregates(datasets: Dataset[], seedable: Set<string>): string[] {
  const used = new Set<string>();
  for (const ds of datasets) {
    for (const e of ds.entries) {
      if (!e.raw && seedable.has(e.row.aggregate)) used.add(e.row.aggregate);
    }
  }
  return [...used].sort();
}

// ---------------------------------------------------------------------------
// The seeder model (M-T6.52) — "what does the seeder know" about ONE
// aggregate, derived once here and consumed by all five backends' seed
// emitters instead of each re-deriving its own create-input / create-call
// shape.  This is what closes the class of defect the mission found:
// java/.NET built an event-sourced aggregate's `create` call from
// `createInputFields(agg)` — every declared FIELD — against a factory
// that takes only the event-sourced `create` action's own declared
// PARAMETERS (`create open(owner: string)` → `create(String owner)`), a
// param-count/name mismatch (CS1501 / javac "cannot be applied").  node and
// python were "accidentally correct": both build the call as a keyword-
// shaped literal from the seed row's OWN fields, which structurally matches
// either factory shape as long as the row only names params the factory
// declares — a coincidence of calling convention, not a derivation every
// backend shares.  This model makes the derivation shared instead.
// ---------------------------------------------------------------------------

/** The saving strategy that decides how a seed row reaches storage:
 *   - `event-sourced` — the aggregate's truth is its append-only event
 *     stream (`persistedAs: eventLog`); a seed row APPENDS the creation
 *     event through the same command seam an ordinary create request uses.
 *   - `relational` / `document` / `embedded` — the `SavingShape` axis
 *     (D-DOCUMENT-AXIS); a seed row goes through the aggregate's domain
 *     `create` factory + repository save, exactly as before. */
export type SeederPersistenceKind = "relational" | "document" | "embedded" | "event-sourced";

/** One ordered create-call parameter — the value to substitute when a seed
 *  row's record omits it mirrors {@link createOmissionValue}'s existing
 *  contract (`default` → its expression, a bare `bool` → `false`, else
 *  `null`), generalised to `RequirableInput` so the SAME rule covers an
 *  aggregate FIELD (relational/document/embedded) and a `create` action
 *  PARAMETER (event-sourced) without re-deriving it per shape. */
export interface SeederCreateParam {
  name: string;
  type: TypeIR;
  omission: CreateOmissionValue;
}

/** What a seed emitter needs to know about ONE seedable aggregate. */
export interface SeederAggregate {
  name: string;
  persistenceKind: SeederPersistenceKind;
  /** Ordered create-call parameters — the aggregate's full create-input set
   *  (`createInputFields`) for relational/document/embedded aggregates, or
   *  the event-sourced `create` action's OWN declared params for an
   *  event-sourced one.  The two are NOT the same set (M-T6.52) — this
   *  field is the ONE place that distinction is decided. */
  createParams: SeederCreateParam[];
}

/** {@link createOmissionValue}'s omission rule, generalised over
 *  `RequirableInput` (satisfied by both `FieldIR` and `ParamIR`) so an
 *  event-sourced `create` action's parameters can be given the same
 *  omission treatment as an aggregate's create-input fields without a
 *  second copy of the rule per shape. */
function omissionValueFor(f: RequirableInput): CreateOmissionValue {
  if (f.default !== undefined) return { kind: "default", expr: f.default };
  const base = f.type.kind === "optional" ? f.type.inner : f.type;
  if (base.kind === "primitive" && base.name === "bool") return { kind: "false" };
  // Kept in step with `createOmissionValue`'s collection arm: a non-nullable
  // collection omits to the empty collection, a nullable one to `null`.
  // `test/ir/wire/create-input-contract.test.ts` pins the two in agreement —
  // this is a deliberate second copy (it generalises over `RequirableInput`),
  // so the pin is what stops them drifting.
  if (base.kind === "array" && f.type.kind !== "optional" && f.optional !== true) {
    return { kind: "empty-collection" };
  }
  return { kind: "null" };
}

/** Derive the seeder model for one aggregate, or `null` when it is not
 *  seedable at all:
 *   - an abstract inheritance base has no create factory and no
 *     repository (`loom.seed-abstract-aggregate` rejects a row at the AST
 *     tier; this is the codegen-side backstop, matching the pre-existing
 *     per-backend `!isAbstract` filters);
 *   - an event-sourced aggregate with no declared `create` action is not
 *     constructible at all (mirrors `emitsRestCreate`'s ES branch and the
 *     elixir command-runner's `:not_constructible` fallback). */
export function seederAggregate(agg: EnrichedAggregateIR): SeederAggregate | null {
  if (agg.isAbstract) return null;
  if (agg.persistedAs === "eventLog") {
    const create = agg.creates?.[0];
    if (!create) return null;
    return {
      name: agg.name,
      persistenceKind: "event-sourced",
      createParams: create.params.map((p) => ({
        name: p.name,
        type: p.type,
        omission: omissionValueFor(p),
      })),
    };
  }
  return {
    name: agg.name,
    persistenceKind: agg.savingShape ?? "relational",
    createParams: createInputFields(agg).map((f) => ({
      name: f.name,
      type: f.type,
      omission: omissionValueFor(f),
    })),
  };
}

/** Every seedable aggregate in a context, keyed by name — the ONE
 *  classifier every backend's seed emitter consults instead of re-deriving
 *  "is this aggregate seedable, and with what create-call shape".  A test
 *  or seed row naming an aggregate absent from this map is not seedable on
 *  any backend (`test/generator/_persistence/seed-model-census.test.ts`). */
export function seederAggregates(ctx: EnrichedBoundedContextIR): Map<string, SeederAggregate> {
  const out = new Map<string, SeederAggregate>();
  for (const a of ctx.aggregates) {
    const s = seederAggregate(a);
    if (s) out.set(a.name, s);
  }
  return out;
}
