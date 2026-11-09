import type { AggregateIR, TestIR } from "./aggregate.js";
import type { ExprIR } from "./expr.js";
import type { DerivedIR, FieldIR, FunctionIR, InvariantIR, ParamIR } from "./members.js";
import type { ProjectionIR } from "./projection.js";
import type { StmtIR } from "./stmt.js";
import type { GenericCtorName, Sourced, TypeIR } from "./types.js";
import type { CommandHandlerIR, QueryHandlerIR, WorkflowIR } from "./workflow.js";

export interface EnumIR extends Sourced {
  name: string;
  values: string[];
  /** Declared at the root of a file, outside every bounded context (the shared
   *  kernel).  Enrichment folds such an enum into every context's `enums`, so
   *  where it was DECLARED is an input fact this flag keeps: its model-text
   *  keys file under `_system` (`src/util/model-text-key.ts`), not under
   *  whichever context happens to render it. */
  systemLevel?: true;
}

export interface ValueObjectIR extends Sourced {
  name: string;
  fields: FieldIR[];
  /** Declared outside every bounded context — see {@link EnumIR.systemLevel}. */
  systemLevel?: true;
  derived: DerivedIR[];
  invariants: InvariantIR[];
  functions: FunctionIR[];
  /** Unit tests anchored to this value object (nested `test` member, or a
   *  hoisted `test … for <VO>`).  Same `TestIR` shape as `AggregateIR.tests`;
   *  emitted as a colocated unit file (test-placement.md). */
  tests: TestIR[];
}

export interface EventIR extends Sourced {
  name: string;
  fields: FieldIR[];
}

/** A channel — the publisher-side contract for how a context's events are
 *  transported (channels.md).  Declared as a context member; its
 *  `carries` list names events of the enclosing context, and the orthogonal
 *  `delivery` x `retention` knobs select pub/sub vs work-queue vs durable
 *  stream.  The contract is transport-neutral — a `ChannelSourceIR` binds it
 *  to a physical storage at system scope.  Defaults (when a knob is omitted)
 *  reproduce today's in-process broadcast/ephemeral behaviour. */
export interface ChannelIR {
  name: string;
  /** Carried event type names (resolved). */
  carries: string[];
  delivery: "broadcast" | "queue";
  retention: "ephemeral" | "log" | "work";
  /** Partition/ordering key — a field common to the carried events. */
  key?: string;
}

/** The payload-family discriminator (payload-transport-layer.md, P1).
 *  `payload` is the umbrella; `event` / `command` / `query` / `response`
 *  / `error` are sugar subtypes carrying the same structural-record wire
 *  contract.  `event` is the only one that also has its own legacy
 *  declaration surface (`EventDecl`) — it is projected into the unified
 *  `payloads` view at lowering time; the rest parse via `PayloadDecl`. */
export type PayloadKind = "payload" | "event" | "command" | "query" | "response" | "error";

/** A structured-data carrier crossing a boundary (payload-transport-layer.md,
 *  P1).  Either a **record** (structurally typed field list — the P1+P2 shape)
 *  or a **named discriminated union** (`payload Foo = A | B`, P4) when
 *  `variants` is set.  The two forms are mutually exclusive: a union payload
 *  carries `variants` and an empty `fields`. */
export interface PayloadIR {
  name: string;
  kind: PayloadKind;
  fields: FieldIR[];
  /** Set for a named union (`payload Foo = A | B | C`, P4) — the source-order
   *  variant types.  Absent on record payloads.  Identity is by the payload's
   *  name; the variant set is canonicalized for duplicate detection via
   *  `unionVariantKey`.  The anonymous `A or B` form produces a `union` TypeIR
   *  inline instead of a named `PayloadIR`. */
  variants?: TypeIR[];
  /** True for compiler-synthesized payloads (P2's per-aggregate
   *  `<Agg>Wire`), false for author-declared ones.  Lets later
   *  phases and the validator distinguish derived shapes from source. */
  synthesized: boolean;
  /** Set on a payload monomorphized from a generic carrier instantiation
   *  (P3b) — carries the originating `ctor` + carrier `arg` so backends can
   *  emit it as a DTO and resolve a `genericInstance` reference to this
   *  payload's name.  Absent on `<Agg>Wire` and author payloads. */
  generic?: { ctor: GenericCtorName; arg: TypeIR };
}

/** A read's `ignoring` stance (named-filter-bypass.md §11), shared by every
 *  IR node that carries one.  `bypassAll` is `ignoring *`: bypass EVERY
 *  capability query-filter on the aggregate for this read.  `bypassCaps` is
 *  `ignoring A, B`: the resolved capability NAMES whose query-filters this
 *  read bypasses; a backend maps each name to the predicate(s) it contributed
 *  via `AggregateIR.contextFilterOrigins`, and derives the per-backend filter
 *  identity (e.g. the EF `HasQueryFilter` name) in the emitter.  The two are
 *  mutually exclusive, and both are absent on a read with no `ignoring`
 *  clause — the common case. */
export type Bypassing = {
  bypassAll?: boolean;
  bypassCaps?: string[];
};

export interface FindIR extends Bypassing {
  name: string;
  params: ParamIR[];
  returnType: TypeIR;
  /** Authorization gate (D-AUTH-OIDC / default-deny) — the aggregate's
   *  `policy { read X requires <expr> }` gate, put on the find by enrichment
   *  (`applyPolicyReadGates`); a find declares no gate of its own.  A boolean
   *  evaluated against `currentUser` *before* the query runs; failure → 403.  Distinct from `filter`: the
   *  filter scopes which rows come back (queryable, pushed to SQL), the gate
   *  decides whether the caller may hit the endpoint at all.  Lowered in the
   *  bare context scope (currentUser only, no aggregate row / params), so it
   *  can reference `currentUser` + constants but not the source row's fields.
   *  `requires true` is the explicit intentionally-public escape (the
   *  read-side twin of the operation gate). */
  requires?: ExprIR;
  /** Optional `where ...` filter expression in IR form. */
  filter?: ExprIR;
  /** Set when the `where` filter is *exactly* one named `criterion`
   *  reference — its name + lowered args, for backends that consume the
   *  reified `Criterion`.  `filter` still carries the inlined predicate, so
   *  composed/anonymous filters and non-reifying backends are unaffected. */
  criterionRef?: { name: string; args: ExprIR[] };
  /** A single-row find that answers the FIRST row its filter matches, in id
   *  order, where more than one row may match — the widened
   *  `Repo.find(<Criterion>) ignoring …` read (`synthesizeBypassReadFinds`),
   *  which keeps `find(C)`'s first-match meaning.  Absent, a single-row find
   *  reads a key, and a backend may treat a second match as an error. */
  takeFirst?: boolean;
  /** Compiler-synthesized find — NOT author-declared and NOT auto-exposed as
   *  its own HTTP route.  Set by enrich when a paged `queryHandler` over
   *  `Repo.all(<Criterion>)` (paged-run) needs the #1904 paged FIND repo-method
   *  emitted for it to call; the exposure is the queryHandler's own route, so
   *  the aggregate router skips this find (route + query schema + paged DTO).
   *  The repository builder still emits the method. */
  synthesized?: boolean;
  /** The order a PAGED find's page is taken in when the caller's `sort` key
   *  names no whitelisted column — its route's `sort` then defaults to `""`
   *  (`pagedSortDefault`).  Absent: the `id` order every paged read falls back
   *  to.  Set on the paged find a `queryHandler` over `Repo.all(<Retrieval>)`
   *  synthesizes, from the retrieval's declared `sort:`. */
  defaultSort?: SortTermIR[];
  /** The compiler-synthesized per-entity history read (`docs/audit.md`) —
   *  `GET /<agg>/{id}/history`, served from the module's `audit_records` table
   *  rather than from the aggregate's own table.  Injected by enrichment onto
   *  every audited aggregate, the auto-`findAll` analog.
   *
   *  It rides `FindIR` (rather than a field of its own on `AggregateIR`) so it
   *  inherits the read pipeline wholesale: `requires` carries the aggregate's
   *  read gate, and `bypassAll` / `bypassCaps` carry its `ignoring` stance, so
   *  every capability query-filter scopes history exactly as it scopes the
   *  entity read.  The flag exists because the SOURCE diverges: the generic
   *  find-route + repository builders skip it and each backend's audit emitter
   *  serves it instead. */
  auditHistory?: boolean;
  /** `requires` is the DENY gate enrichment synthesised (a `false` literal),
   *  not one the author wrote (M-T3.19).  Set on the list read (`all`) — and
   *  on the by-id read `byIdRouteFind` synthesises — of a repository marked
   *  `readsDefaultDenied`, when the author declared no gate for it: under
   *  `denyByDefault` that read fails closed (403 before the load) on every
   *  backend, and the validator still reports it as ungated. */
  defaultDenied?: boolean;
}

/** A natural-key read's key (`Repo.getBy(sku: s)` / `Repo.findBy(…)`,
 *  D-REPO-KEY-LOOKUP): the declared `unique (…)` tuple it names, in declared
 *  column order, and the read's `ignoring` stance.  The read is emitted as a
 *  repository method named by `keyLookupMethodName`, which enrichment
 *  synthesises (`synthesizeKeyLookupFinds`) as a `synthesized` find — one
 *  `WHERE` equality per column, capability filters applied as on any read. */
export interface KeyLookupIR extends Bypassing {
  columns: string[];
}

/** A single-row read that widens its capability filters —
 *  `Repo.find(<Criterion>) ignoring …` or `Repo.find(id) ignoring …`.
 *  The plain reads share a method with every other caller (the criterion's
 *  `findAllBy<C>` retrieval, the by-id load), so the widened read is emitted
 *  as a method of its own, named by `bypassReadMethodName`, which enrichment
 *  synthesises (`synthesizeBypassReadFinds`) as a `synthesized` find: the
 *  criterion's predicate (or `this.id == id`) with the read's stance as
 *  `bypassAll` / `bypassCaps`. */
export interface BypassReadIR extends Bypassing {
  source: { kind: "criterion"; name: string } | { kind: "id" };
}

export interface RepositoryIR extends Sourced {
  name: string;
  aggregateName: string;
  finds: FindIR[];
  /** The compiler-synthesized per-entity history read (`docs/audit.md`), set by
   *  enrichment on every audited aggregate — the auto-`findAll` analog, derived
   *  in the same pure pass.
   *
   *  It is a real `FindIR` (so it carries the read gate and `ignoring` stance
   *  in the same vocabulary every other read uses) but deliberately sits BESIDE
   *  `finds` rather than inside it.  `finds` has ~120 generic consumers across
   *  the five backends — route emitters, repository builders, OpenAPI, the
   *  frontend API clients — and every one of them assumes a find reads the
   *  AGGREGATE's table at `/<name-snake>`.  History reads `audit_records` at
   *  `/{id}/history`, so each of those sites would need a skip-guard, and a
   *  site that forgot one would silently emit a broken route rather than fail.
   *  That is the same "flag read at ~30 uncoordinated sites" hazard M-T3.9
   *  resolved for `op.audited`; a separate field makes consumption OPT-IN, so
   *  a backend that has not ported history emits nothing instead of garbage. */
  historyFind?: FindIR;
  /** Set by enrichment (M-T3.19) when the aggregate is served by an
   *  `auth: required` backend under `enforcement: denyByDefault`: its two
   *  compiler-derived reads (list, by-id) fail CLOSED unless the author
   *  declares `policy { read X requires <expr> }`.  A system-composition fact the
   *  per-context backends cannot re-derive (they never see the deployables),
   *  hence stored.  Consumed through `read-gates.ts`. */
  readsDefaultDenied?: boolean;
}

/** A named, parameterised, pure boolean predicate over a candidate
 *  type — the Specification Pattern (Evans / Spring-Data style).  See
 *  docs/criterion.md.
 *
 *  A criterion is *inlined* wherever it is referenced from a boolean
 *  expression position (repository `find ... where`,
 *  an `invariant`, an operation guard): the use-site re-lowers the
 *  predicate body with its parameters substituted and the candidate
 *  rebound to the host receiver, so no backend consumes `CriterionIR`
 *  directly today.  The IR record is retained for tooling, traceability
 *  and the forthcoming `Repo.all(criterion, …)` surface. */
export interface CriterionIR {
  name: string;
  params: ParamIR[];
  /** The `of <T>` candidate type.  `kind: "entity"` for an aggregate
   *  candidate; `kind: "primitive", name: "bool"` for a pure ambient
   *  predicate with no candidate. */
  targetType: TypeIR;
  /** The lowered predicate body, lowered in the criterion's own scope
   *  (parameters as `param` refs, candidate fields as `this-prop`).
   *  Use-sites inline a freshly-substituted copy rather than reading
   *  this; it exists for tooling / traceability / future query
   *  emission. */
  body: ExprIR;
}

/** A stateless, named, context-level container of NON-mutating
 *  operations — the pure-calculator floor (domain-services.md, v1 Shape
 *  A).  Operations take aggregates / value objects / primitives by
 *  value and return a value or an `or`-union error; they may `throw`
 *  for the bug regime but never touch infrastructure (a phase-⑦
 *  validator rejects repo / extern / api / workflow-start / emit /
 *  this-write).  Unlike a `criterion`, a domain service is NOT
 *  queryable (it does not inline to SQL `where`); a member call
 *  `Pricing.quote(...)` lowers to a Call with `callKind:
 *  "domain-service"`, so each backend emits a real call into the
 *  generated service module — no re-resolution. */
export interface DomainServiceIR {
  name: string;
  operations: DomainServiceOperationIR[];
  /** Unit tests anchored to this domain service (nested `test` member, or a
   *  hoisted `test … for <Service>`).  Same `TestIR` shape as
   *  `AggregateIR.tests`; emitted as a colocated unit file
   *  (test-placement.md). */
  tests: TestIR[];
}

/** One operation of a `domainService` (domain-services.md).  Mirrors the
 *  param/return/body shape of an aggregate `OperationIR`, but is always
 *  non-mutating (no `this`) — there is no `mutating` field to stamp; the
 *  no-infra contract is derived by the validator from the body. */
export interface DomainServiceOperationIR {
  name: string;
  params: ParamIR[];
  /** Declared `or`-union (or plain) return type; absent ⇒ no `: T` clause. */
  returnType?: TypeIR;
  body: StmtIR[];
}

/** One `sort` term of a retrieval — a structural path through the
 *  candidate aggregate plus an ordering direction. */
export interface SortTermIR {
  /** Dotted path segments, candidate-rooted (`this` stripped).  A
   *  segment flagged `collection` carried a `[]` marker. */
  path: LoadSegmentIR[];
  direction: "asc" | "desc";
}

/** One segment of a structural `loads` / `sort` path. */
export interface LoadSegmentIR {
  name: string;
  /** True when the segment carried a `[]` collection marker. */
  collection: boolean;
}

/** The fetch shape for a retrieval (load-specifications.md /
 *  reified-criteria.md §"The internal seam").  `kind: "whole"` is the
 *  default-whole load (full owned aggregate tree, cross-aggregate refs
 *  as ids) — structural, no analysis.  `kind: "explicit"` carries the
 *  author's `loads:` paths, which restrict or expand the default. */
export type LoadPlanIR = { kind: "whole" } | { kind: "explicit"; paths: LoadSegmentIR[][] };

/** A named query *bundle* (retrieval.md): a composed predicate plus the
 *  shaping a real query carries — ordering and a load shape.  Lowered
 *  from a `retrieval` declaration; the source-level realisation of the
 *  RetrievalIR bundle node (reified-criteria.md).
 *
 *  No `page` field — pagination is a call-site argument on
 *  `Repo.all(R(args), page?)`, never part of the declaration.
 *
 *  Its `ignoring` stance is set only on the retrievals enrichment derives
 *  for a widened `Repo.all(…) ignoring …` read (`widenedRetrievalName`);
 *  a declared retrieval never carries one. */
export interface RetrievalIR extends Sourced, Bypassing {
  name: string;
  params: ParamIR[];
  /** The `of <T>` candidate type (entity aggregate). */
  targetType: TypeIR;
  /** The lowered `where` predicate, in the retrieval's own scope
   *  (parameters as `param` refs, candidate fields as `this-prop`).
   *  Composes criteria + bare predicates like a `find … where`. */
  where: ExprIR;
  /** Set when the `where` is *exactly* one named `criterion` reference
   *  (`where: NamedLike(needle)`) — the criterion name + its lowered
   *  argument expressions, for backends that consume the reified
   *  `Criterion`/Specification (the `.where` body is still the inlined
   *  predicate, so non-reifying backends are unaffected).  Omitted when
   *  the `where` is composed or an anonymous expression. */
  criterionRef?: { name: string; args: ExprIR[] };
  /** Ordering terms, in declaration order.  Empty when no `sort:`. */
  sort: SortTermIR[];
  /** Fetch shape; `{ kind: "whole" }` when no `loads:` clause. */
  loadPlan: LoadPlanIR;
}

export interface BoundedContextIR extends Sourced {
  name: string;
  enums: EnumIR[];
  valueObjects: ValueObjectIR[];
  events: EventIR[];
  /** Unified payload-family view (payload-transport-layer.md, P1+P2):
   *  author-declared `PayloadDecl`s (payload/command/query/response/error),
   *  the context's `event`s projected in with `kind: "event"`, and the
   *  P2 synthesized per-aggregate `<Agg>Wire` payloads.  `events` stays
   *  populated independently so existing event emission is untouched. */
  payloads: PayloadIR[];
  aggregates: AggregateIR[];
  repositories: RepositoryIR[];
  workflows: WorkflowIR[];
  /** Top-level `commandHandler` application-layer members
   *  (unfoldable-api-derivation.md, Layer 3).  Present when the context declares
   *  any; they ride alongside the IR, unread by any backend. */
  commandHandlers: CommandHandlerIR[];
  /** Top-level `queryHandler` application-layer members
   *  (unfoldable-api-derivation.md, Layer 3). */
  queryHandlers: QueryHandlerIR[];
  /** Named predicate specifications declared in this context. */
  criteria: CriterionIR[];
  /** Stateless pure-calculator domain services declared in this context
   *  (domain-services.md, v1 Shape A). */
  domainServices: DomainServiceIR[];
  /** Channel declarations in this context (channels.md) — the
   *  publisher-side transport contracts over this context's events. */
  channels: ChannelIR[];
  /** Projection read models declared in this context (projection.md) — read
   *  models folded from foreign events.  Populated by lowering; empty when the
   *  context declares none. */
  projections: ProjectionIR[];
  /** Named query bundles declared in this context (retrieval.md). */
  retrievals: RetrievalIR[];
  /** First-boot seed datasets declared in this context (database-seeding.md).
   *  Platform-neutral; the system-level seed builder (phase ⑨) groups these
   *  per (module, dataset) and the backends emit native seeders. */
  seeds: SeedIR[];
  /** Context-scoped INTEGRATION tests (test-placement.md) — a `test`
   *  nested in the `context` (no `for`) or hoisted with `for <Ctx>`.  Same
   *  `TestIR` shape as the per-subject unit tests, but lowered under the context
   *  env (every aggregate/service in scope) so it exercises cross-aggregate
   *  behaviour.  No backend emits these yet — gated by
   *  `loom.context-test-unsupported`. */
  tests: TestIR[];
  /** Per-error HTTP status overrides reaching this context, merged from the
   *  `httpStatus <Error> -> <Code>` clauses of every api over its subdomain
   *  (exception-less.md A1).  Populated by `enrichLoomModel`; the route
   *  translator reads `errorStatusOverrides?.[name] ?? defaultErrorStatus(name)`.
   *  Undefined in single-context (no-api) lowering — defaults apply. */
  errorStatusOverrides?: Record<string, number>;
  /** Router slots (`routeSlot` form, `"get /api/orders/{}"`) occupied by the
   *  explicit `route`s of the apis surfacing this subdomain.  The auto-derived
   *  REST surface YIELDS any of its operations whose slot is listed
   *  (D-EXPLICIT-ROUTE-WINS): the derivation flags it `claimedByExplicitRoute`,
   *  the route + OpenAPI emitters skip it, and the explicit handler alone
   *  serves the slot.  Populated by `enrichLoomModel`; undefined when those
   *  apis declare no explicit route. */
  explicitRouteSlots?: string[];
  /** App-wide resolved HTTP status for each structural-conflict built-in
   *  (`UniquenessConflict` / `ConcurrencyConflict` / `Disallowed` /
   *  `ReferencedInUse` — expressible-builtins.md §3 / M-T3.4a). Folded across
   *  every api (first-declared `httpStatus` wins), defaulting each to 409.
   *  The backend runtime arms + OpenAPI declarations for the hardcoded 409s read
   *  `structuralErrorStatuses?.[name] ?? 409` so the two cannot drift and
   *  `httpStatus UniquenessConflict -> 422` retargets both. Populated by
   *  `enrichLoomModel`; undefined in single-context (no-api) lowering. */
  structuralErrorStatuses?: Record<string, number>;
  /** Value objects declared in the OTHER contexts of the same system — the
   *  pool an emitter needs to look up a `valueobject` this context merely
   *  REFERENCES.  A cross-context VO reference is legal and resolves at
   *  lowering (`aggregate Payment { paid: Money }` in context Beta against
   *  `valueobject Money` in context Alpha — the README's own Quick Example
   *  shape), but the declaration stays in its own context, so
   *  `ctx.valueObjects` alone cannot answer "what does this file have to
   *  declare".  Emitters that materialise a per-file copy of each referenced
   *  VO (the .NET request/response DTO records, the JSX frontends'
   *  per-aggregate api modules) resolve the name through
   *  `ctx.valueObjects` ∪ this, then keep only what the aggregate's wire
   *  shape actually reaches.  Own names shadow; first declaration wins on a
   *  cross-context collision (the validator owns the ambiguity diagnostic).
   *  Populated by `enrichLoomModel`; undefined when the model has a single
   *  context. */
  siblingValueObjects?: ValueObjectIR[];
  /** Enums declared in the OTHER contexts of the same system — the enum twin
   *  of `siblingValueObjects`, and populated the same way.  An emitter that
   *  must MATERIALISE a referenced enum (a route file's
   *  `const <E>Schema = z.enum([...])`, a migration's `CHECK (<col> IN (...))`)
   *  resolves the name through `enumPool(ctx)`; without this it saw only
   *  `ctx.enums` and a cross-context enum silently resolved to nothing.  Own
   *  names shadow.  Undefined when the model has a single context. */
  siblingEnums?: EnumIR[];
  /** Per-aggregate read reachability levels declared by `policy {}` blocks in
   *  this context (authorization.md §3; tenancy.md).  Each
   *  entry names a tenant-owned aggregate and its directional read level
   *  (`local`/`deep`/`global`).  Consumed by `enrichLoomModel`
   *  (`applyPolicyReadLevels`), which rewrites the aggregate's `tenantOwned`
   *  capability filter (`contextFilters`) to the level-appropriate predicate.
   *  Undefined / empty when the context declares no policy. */
  policyReadLevels?: PolicyReadLevelIR[];
  /** Per-aggregate WRITE reachability levels declared by `policy { allow write
   *  <level> on X }` blocks in this context
   *  (`https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/authorization-phase3.md`).  A write level gates INSTANCE
   *  mutations (update-style ops, destroy, applier dispatch) on the target
   *  row's write scope; `local` is the flat `tenantId ==` floor (the default),
   *  `deep` the caller's org + descendants.  Consumed by `enrichLoomModel`,
   *  which derives each tenant-owned aggregate's `writeScopeFilter` from the
   *  read + write levels.  Undefined / empty when the context declares no
   *  `allow write` rule. */
  policyWriteLevels?: PolicyWriteLevelIR[];
  /** Per-aggregate DENY carve-outs declared by `policy { deny [write] on X }`
   *  blocks in this context
   *  (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/authorization-phase4-deny.md).  Each entry names an aggregate
   *  and the access it denies (`read` = total carve-out, the aggregate becomes
   *  invisible; `write` = read-only carve-out).  Consumed by `enrichLoomModel`
   *  (`applyPolicyDenies`), which — AFTER the allow read/write-level passes, so
   *  DENY WINS — appends an always-false predicate to the aggregate's read
   *  `contextFilters` (deny read) or overwrites its `writeScopeFilter` (deny
   *  write) with `buildDenyFilter`.  Undefined / empty when the context declares
   *  no `deny` rule. */
  policyDenies?: PolicyDenyIR[];
  /** Per-aggregate READ gates declared by `policy { read X requires <expr> }`
   *  in this context — who may read the aggregate at all.  Consumed by
   *  enrichment (`applyPolicyReadGates`), which puts the gate on every
   *  author-declared find of X and on the compiler-injected list read `all`;
   *  the by-id route and the audit history read take it from `all`
   *  (`read-gates.ts`, `ensureHistoryFind`).  Undefined / empty when the
   *  context declares no read gate. */
  policyReadGates?: PolicyReadGateIR[];
}

/** One `read <Aggregate> requires <expr>` rule lowered from a `policy {}`
 *  block.  The gate is lowered in the bare context scope (no row, no params),
 *  exactly like a projection gate, so it can reference `currentUser` and
 *  constants only — anything else is `loom.policy-read-gate-not-current-user`
 *  in phase ⑦. */
export interface PolicyReadGateIR extends Sourced {
  /** The aggregate the gate applies to (by name, in this context).  Resolution
   *  is validated in phase ⑦ (`loom.policy-unknown-aggregate`). */
  aggregate: string;
  /** The gate, evaluated before the load; failure → 403. */
  gate: ExprIR;
  /** Source span text for diagnostics (`read Order requires …`). */
  source: string;
}

/** One `allow <level> on <Aggregate>` rule lowered from a `policy {}` block —
 *  a tenant-owned aggregate's directional read reachability level
 *  (tenancy.md).  `local` is the flat `tenantId ==` tenant
 *  floor (and the default when no policy names an aggregate); `deep` widens to
 *  the caller's org + all descendants (a `dataKey` materialized-path prefix
 *  match); `global` is all rows in the caller's tenant (tenant-root-floored). */
export interface PolicyReadLevelIR {
  /** The tenant-owned aggregate this level applies to (by name, in this
   *  context).  Resolution + tenant-owned-ness is validated in phase ⑦. */
  aggregate: string;
  /** The directional read level. */
  level: "local" | "deep" | "global";
  /** Source span text for diagnostics (`allow deep on Invoice`). */
  source: string;
}

/** One `allow write <level> on <Aggregate>` rule lowered from a `policy {}`
 *  block (authorization.md).  `local` is the flat `tenantId ==`
 *  tenant floor (and the default write scope when no rule names an aggregate);
 *  `deep` widens to the caller's org + all descendants (a `dataKey`
 *  materialized-path prefix).  `global` parses but is rejected
 *  (`loom.policy-write-global-invalid`). */
export interface PolicyWriteLevelIR {
  /** The tenant-owned aggregate this write level applies to (by name, in this
   *  context).  Resolution + tenant-owned-ness is validated in phase ⑦. */
  aggregate: string;
  /** The directional write level. */
  level: "local" | "deep" | "global";
  /** Source span text for diagnostics (`allow write deep on Invoice`). */
  source: string;
}

/** One `deny [write] on <Aggregate>` carve-out lowered from a `policy {}` block
 *  (deny-wins — https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/authorization-phase4-deny.md).
 *  Deny is all-or-nothing at the aggregate (no level word).  `read` denies reads
 *  (the aggregate becomes invisible; because the write command load reuses the
 *  read filter, writes fail too); `write` denies only mutations (reads stay).
 *  Unlike the allow ladder, deny is NOT restricted to tenant-owned aggregates —
 *  it composes through `contextFilters` / `writeScopeFilter`, which every
 *  aggregate carries. */
export interface PolicyDenyIR {
  /** The aggregate this carve-out denies (by name, in this context).  Resolution
   *  is validated in phase ⑦ (`loom.policy-deny-unknown-aggregate`). */
  aggregate: string;
  /** Which access the rule denies. */
  access: "read" | "write";
  /** Source span text for diagnostics (`deny write on Order`). */
  source: string;
}

/** A first-boot seed dataset for a context's aggregates
 *  (database-seeding.md).  Declarative form only: each row is
 *  the create-parameter shape of one aggregate, lowered through the domain
 *  `create` by default (D-SEED-PATH).  `module` is attached later by the
 *  system-level builder; at context-lowering time only `dataset`/`path`/`rows`
 *  are known. */
export interface SeedIR {
  /** Dataset name; `"default"` runs unconditionally, others gate on
   *  `LOOM_SEED` / the test harness.  Defaults to `"default"` when the
   *  source omits it. */
  dataset: string;
  /** Through the domain `create` (default) or straight to tables (`raw`). */
  path: "domain" | "raw";
  /** Ordered records, in source order.  (Topological reorder by `@handle`
   *  cross-row refs is a later slice.) */
  rows: SeedRowIR[];
}

/** One seeded aggregate instance — the create-parameter shape, no `id`. */
export interface SeedRowIR {
  /** Target aggregate name. */
  aggregate: string;
  /** Field initialisers, fully-resolved to `ExprIR`. */
  fields: { name: string; value: ExprIR }[];
}
