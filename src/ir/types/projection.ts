import type { ExprIR } from "./expr.js";
import type { FieldIR, ParamIR, WireField } from "./members.js";
import type { StmtIR } from "./stmt.js";
import type { Sourced, TypeIR } from "./types.js";

/** A `projection <Name> keyed by <field> { … }` read model (projection.md) —
 *  the passive read-half of an event-sourced workflow.  Declared state fields
 *  (the read-model schema + wire shape) plus pure `on(e: Event)` folds over
 *  FOREIGN events, keyed by an explicit correlation column.  No command side:
 *  a projection never emits, calls repos/operations, or starts anything — it
 *  only reflects an event stream into a queryable table.  Reuses the
 *  event-triggered saga machinery (load-or-allocate on every handler,
 *  `wireShape` read surface, state-table migration). */
export interface ProjectionIR extends Sourced {
  name: string;
  /** Query parameters — a query-time projection may be parameterised
   *  (`projection OrdersInRegion(region: string) …`), exactly like a
   *  criterion / retrieval.  Empty for the folded flavor. */
  params: ParamIR[];
  /** The read-model schema — the fold-target columns and the wire shape.
   *  Lowered with the same `lowerField` as aggregate / workflow state. */
  stateFields: FieldIR[];
  /** The explicit id-shaped state field inbound events route to (`keyed by`).
   *  Required for the KEYED flavor — no inference (unlike
   *  `WorkflowIR.correlationField`).  **Absent** for a SINGLETON projection
   *  (no `keyed by`); its absence is the singleton discriminant — see
   *  `isSingletonProjection`. */
  correlationField?: string;
  /** One pure fold per subscribed foreign event.  Non-empty ⇒ the read model
   *  is MATERIALIZED (needs a table); empty ⇒ query-time (computed per read).
   *  See `isMaterializedProjection`. */
  handlers: ProjectionOnIR[];
  /** The query-time comprehension.  Present when the projection declares a
   *  `from`/`where`/`join`/`select` clause (read-path-architecture.md
   *  rev.13, § "projection generalises").  Absent ⇒ a pure folded read model
   *  (today's projection).  The `materialized`/`singleton`/`query-time` facts
   *  are DERIVED from clause presence (never stamped) — see the predicates
   *  below `ProjectionIR`. */
  query?: ProjectionQueryIR;
  /** Canonical wire shape of a projection row — correlation field as an id
   *  token then the state fields, mirroring `WorkflowIR.instanceWireShape`.
   *  Populated by `enrichLoomModel`. */
  wireShape?: WireField[];
  /** The principal claim (`tenancy by user.<claim>`) a FOLDED projection's rows
   *  are tenant-scoped by — set by enrichment when the fold folds events of a
   *  tenant-scoped producer (`foldTenancyVerdict` in
   *  `src/ir/enrich/fold-tenancy.ts` answers `scoped`).  Stored because the
   *  verdict reads every context's producers of the folded events, which a
   *  backend emitting one context cannot see; consume it only through
   *  `foldTenancyFor`.  Absent ⇒ the fold is unscoped. */
  foldTenantClaim?: string;
}

/** The query-time comprehension clauses of a generalised projection
 *  (read-path-architecture.md rev.13).  Every expression inside is Loom's one
 *  candidate-rooted language (the same `criterion` / `find … where` dialect);
 *  the LINQ shape is purely structural. */
export interface ProjectionQueryIR {
  /** `from <Source> [as <alias>]` — the query source aggregate / workflow, by
   *  name.  Undefined for the folded+`join` hybrid (no `from`; `join`s resolve
   *  stored id columns instead). */
  source?: string;
  /** Whether `source` names an AGGREGATE (read through its repository), a
   *  WORKFLOW (read through its persisted instance / saga-state rows,
   *  `instanceWireShape`), or another materialized PROJECTION (read through its
   *  persisted `<Proj>Row` read-model table).  Absent ⇒ aggregate (the default /
   *  folded-hybrid case).  A workflow / projection source is `select`-projection
   *  only (no `join`s). */
  sourceKind?: "aggregate" | "workflow" | "projection";
  /** The bounded context `source` is declared in, as name resolution linked
   *  it.  A projection may read a source declared in ANOTHER context of its
   *  subdomain (`context Reports { projection V { from Order … } }` over
   *  `Orders.Order`), so `source` alone is ambiguous to a backend that emits
   *  per context: its capability filters, tenancy floor, table and module all
   *  belong to the HOME context.  Resolve it through
   *  `projectionSourceContext` (`src/ir/util/projection-source.ts`), never by
   *  looking `source` up in the projection's own context. */
  sourceContext?: string;
  /** The author's alias for the source candidate (`from Order as o`).  `this`
   *  / bare stays the default; the alias resolves identically (like
   *  `criterion … of T as o`). */
  sourceAlias?: string;
  /** `where <criterion-expr>` — a single-aggregate queryable predicate over
   *  the source, in the criterion position (composes named criteria). */
  filter?: ExprIR;
  /** Named criterion this `where` reifies to when it is exactly one criterion
   *  reference (mirrors `RetrievalIR.criterionRef`) — the criterion name plus
   *  its lowered argument expressions. */
  criterionRef?: { name: string; args: ExprIR[] };
  /** `join <Aggregate> as <c> on <idRef>` clauses — by-id follows.  Each is
   *  one batched load through the aggregate's own repository (boundary-safe).
   *  Also surfaced pre-planned as `auxiliaries` (path + mapVar) below, reusing
   *  the id-follow bulk-load planning machinery. */
  joins: ProjectionJoinIR[];
  /** `select <field> = <expr>, …` — fills the declared row fields from the
   *  source (`this`/alias) and join aliases.  Undefined ⇒ the projection
   *  exposes the source's own shape (shorthand, deferred).
   *
   *  `aggregate` marks a WHOLE-TABLE aggregation (`select orders = count`,
   *  `select revenue = sum(o.total)`) — the singleton read model of
   *  read-path-architecture.md rev. 8.  It is the NORMALIZED reading of `expr`,
   *  resolved once in lowering so emitters consume a disciplined shape instead
   *  of each re-detecting the aggregation from the raw expression (the
   *  proposal's own rule: "lowering normalises to a validated shape ...
   *  emitters read a disciplined IR").  `expr` is left as lowered — for an
   *  aggregation it is an unresolved ref / free call, which is exactly why an
   *  emitter that ignores `aggregate` would write an undeclared identifier.
   *  That is gated per-backend (`loom.projection-whole-table-aggregation-
   *  unsupported`), so only a ported emitter ever reaches these selects. */
  selects?: { field: string; expr: ExprIR; type: TypeIR; aggregate?: ProjectionAggregateIR }[];
  /** `group by <col>, …` (M-T4.2) — the grouping columns of a GROUPED read
   *  model: one row per distinct value of these expressions, aggregate
   *  `select`s computed per group, per-row `select`s restricted to the grouping
   *  columns.  Each expression is lowered in the same source-candidate scope as
   *  `select` (so `o.status` arrives as a `this`-rooted member access), and
   *  validation pins it COLUMNAR — a single-hop member on the source row
   *  (`loom.projection-groupby-key-not-columnar`) — so every backend can render
   *  it as a bare SQL column.  Emitters ORDER BY these columns too, ASCENDING
   *  and by the STORED COLUMN VALUE, so the grouped read is deterministic
   *  across backends — an enum key therefore orders by the lexicographic order
   *  of its member NAME (the column is TEXT everywhere, per `mapTypeToColumn`),
   *  not by declaration position.  Absent ⇒ not grouped. */
  groupBy?: ExprIR[];
  /** Bulk-load plan derived from the `join` clauses — the `auxiliaries` shape
   *  built for by-id follows, populated by reading the
   *  DECLARED `join`s. */
  auxiliaries: { path: string[]; aggName: string; mapVar: string }[];
  /** Authorization gate (D-AUTH-OIDC / default-deny) — an optional
   *  `requires <expr>` clause evaluated against `currentUser` *before* the query
   *  runs; failure → 403.  Distinct from `filter`: the filter scopes which rows
   *  return (queryable, pushed to SQL), the gate decides whether the caller may
   *  hit the endpoint at all.  Lowered in the bare context scope (currentUser
   *  only, no source row), so it may reference `currentUser` + constants but not
   *  aggregate fields — the projection twin of `FindIR.requires`.  Emitted as a
   *  403-before-query check in each backend's query-projection route. */
  requires?: ExprIR;
  /** `ignoring *` — bypass EVERY capability query-filter on the source
   *  aggregate for this query-time read (named-filter-bypass.md §11).  Mutually
   *  exclusive with `bypassCaps`.  Threaded into the synthesised source
   *  `FindIR`, so it rides the same bypass path as a repository `find … ignoring`.
   *  See `FindIR.bypassAll`. */
  bypassAll?: boolean;
  /** `ignoring A, B` — resolved capability names whose filters this read
   *  bypasses (named-filter-bypass.md §11).  See `FindIR.bypassCaps`. */
  bypassCaps?: string[];
}

/** One `join <Aggregate> as <alias> on <idRef>` follow. */
/** The whole-table (keyless) aggregation operators a singleton projection's
 *  `select` may use (read-path-architecture.md rev. 8).  Deliberately the same
 *  five names as the collection-op vocabulary in `docs/stdlib.md` — the author
 *  writes `count` / `sum(o.total)` in both places; the difference is only that
 *  here there is no collection receiver, so the whole source table is the
 *  receiver and the operator pushes down to SQL. */
export type ProjectionAggregateOp = "count" | "sum" | "avg" | "min" | "max";

/** A normalized whole-table aggregation in a projection `select` position. */
export interface ProjectionAggregateIR {
  op: ProjectionAggregateOp;
  /** The aggregated column expression, source-row-rooted (`this.total` for
   *  `sum(o.total)`).  Absent for `count`, which counts rows, not a column —
   *  the `COUNT(*)` / `count()` shape. */
  arg?: ExprIR;
}

export interface ProjectionJoinIR {
  /** The joined aggregate, by name. */
  aggregate: string;
  /** The alias the loaded aggregate binds to (`select`/`where` read from it). */
  alias: string;
  /** The id-typed reference the join resolves on — types to `<aggregate> id`;
   *  the join condition is always the aggregate's identity (`c.id == <idRef>`). */
  idRef: ExprIR;
}

/** True when the projection is MATERIALIZED (folded from events → needs a
 *  table).  Derived from clause presence — a fold `on(e)` handler present. */
export function isMaterializedProjection(p: ProjectionIR): boolean {
  return p.handlers.length > 0;
}

/** True when the projection is a SINGLETON (exactly one row).  Derived: no
 *  `keyed by` clause ⇒ no correlation field. */
export function isSingletonProjection(p: ProjectionIR): boolean {
  return p.correlationField === undefined;
}

/** True when the projection is QUERY-TIME (computed per read, always-current,
 *  no table).  Derived: a query source with no fold handlers. */
export function isQueryTimeProjection(p: ProjectionIR): boolean {
  return p.query?.source !== undefined && p.handlers.length === 0;
}

/** True when the projection is GROUPED (`group by` present): a query-time read
 *  returning MANY rows — one per distinct value of the grouping columns — with
 *  aggregate `select`s computed per group.  Its response is the LIST shape (an
 *  array of the declared row), like the per-row query-time read, NOT the
 *  singleton object.  Derived from clause presence — never stamped. */
export function isGroupedProjection(p: ProjectionIR): boolean {
  return (p.query?.groupBy?.length ?? 0) > 0;
}

/** True when the projection is the SHORTHAND form (the `view X = A where P`
 *  replacement): a query-time projection with a `from` source but NO declared
 *  row fields and NO `select` — its row shape IS the source's own wire shape,
 *  and the read returns the (filtered) source rows directly.  Derived from
 *  clause absence — never stamped. */
export function isShorthandProjection(p: ProjectionIR): boolean {
  return (
    isQueryTimeProjection(p) && p.stateFields.length === 0 && (p.query?.selects?.length ?? 0) === 0
  );
}

/** One `on(e: Event) [by <expr>] { … }` pure fold on a projection.  Shares the
 *  reactor SUBSCRIPTION surface with `OnIR` (foreign event + param + optional
 *  key-extraction expr) but the body is an apply-style PURE fold — `StmtIR`,
 *  not `WorkflowStmtIR` — against the pre-loaded projection row bound as `this`.
 *  Enforced pure by `loom.projection-fold-impure` (reuses the applier gate). */
export interface ProjectionOnIR {
  /** The foreign event type this handler folds, by name. */
  event: string;
  /** The parameter name the inbound event instance binds to in the body. */
  param: string;
  /** The `by <expr>` key-extraction expression, lowered in the event-binding
   *  scope (e.g. `e.orderId`).  Undefined when the source omits `by`; the
   *  runtime then routes by `e.<correlationField>` (the key field is required
   *  present on every subscribed event). */
  correlation?: ExprIR;
  /** The fold body — pure assignments / derivations against the row (`this`). */
  statements: StmtIR[];
}
