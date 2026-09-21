// Shared fixture corpus — the declared feature × backend coverage matrix.
//
// One canonical `.ddd` per feature (platform-agnostic, `platform: __PLATFORM__`)
// lives beside this file; `backends` lists every backend the feature is
// declared to generate on.  `test/conformance/corpus-coverage.test.ts` enforces
// the matrix: every declared cell must generate cleanly in-memory (no docker),
// and a feature with no manifest row fails the completeness check.
//
// This is the machine-readable form of the matrix in
// `docs/old/plans/global-test-coverage-plan.md`.  Adding a feature = drop a
// `<feature>.ddd` here + one row below.  Widening a backend's support = add the
// key to that row (the gate proves it generates).  See the plan for the
// behavioural / compile tiers layered on top of this generation gate.

import { type Backend, BACKENDS } from "./backends.js";

/** All backends — the common case for platform-agnostic domain features. */
const ALL: readonly Backend[] = BACKENDS;

/** Every backend filters a `shape: document` aggregate IN-APP over the
 *  rehydrated instance (the jsonb blob is not per-field queryable), so the
 *  document × authorization crossing now runs on ALL five — this alias is kept
 *  as the NAME of that property, and as the place its history is recorded.
 *
 *  3 -> 4: `dotnet` joined.  It was excluded for a compile gap + a silent
 *  unfiltered read, and BOTH are closed — `src/generator/dotnet/emit/repository.ts`
 *  now hoists the AND-ed capability predicate into `_CapabilityVisible(...)` and
 *  applies it on all three document read paths (`GetByIdAsync`,
 *  `FindManyByIdsAsync`, every emitted find), and emits the
 *  `GetByIdForWriteAsync` write-scope member whose absence was the CS0535.
 *
 *  4 -> 5: `elixir` joined.  It was the LAST unwired (family, shape) cell in
 *  `supportsNonRelationalFilter`'s whole inventory — an honest, coded rejection
 *  (`loom.context-filter-no-principal`), not a silent gap, but a rejection all
 *  the same.  `renderDocRepository` now AND-s the capability predicate into
 *  every document read (`list`, `find_by_id`, `find_by_id_for_write`, and each
 *  custom find), evaluated over the rehydrated `%<Agg>.Data{}` embed with the
 *  `deep` sentinel rendered by `renderDeepScopeInApp`. */
const IN_APP_DOCUMENT_FILTER: readonly Backend[] = ALL;


/** The backends that can express a capability `filter` over a TPH
 *  (`sharedTable`) concrete — i.e. a predicate reading a column that exists on
 *  only ONE subtype of the shared table.
 *
 *  `dotnet` is absent, and this is the NAME of that exclusion.  EF Core applies
 *  a query filter to the ROOT entity type of a hierarchy only ("A filter may
 *  only be applied to the root entity type"), and a root-hosted filter must
 *  typecheck against the root for EVERY concrete — so a predicate over a
 *  sibling-only column is not expressible: a CLR downcast raises "No coercion
 *  operator is defined between types", and `EF.Property<T>(x, "…")` raises "the
 *  specified property does not exist on the entity type" (both reproduced
 *  against EF Core 10.0.10; see `nonRootFilterFields`, src/ir/util/inheritance.ts).
 *  Refused honestly by `loom.tph-filter-unsupported`, not silently dropped; the
 *  key returns the day that gate closes. */
const TPH_CAPABILITY_FILTER: readonly Backend[] = ALL.filter((b) => b !== "dotnet");

export interface CorpusFeature {
  /** Matches `<id>.ddd` in this directory. */
  readonly id: string;
  /** One-line description of the language feature exercised. */
  readonly title: string;
  /** Reference doc under `docs/` (without extension), or undefined. */
  readonly doc?: string;
  /** Backends declared to generate this feature cleanly (enforced by the gate). */
  readonly backends: readonly Backend[];
  /** Notes on any backend exclusions. */
  readonly note?: string;
  /**
   * Emitted project dirs the compile tiers build — one per `deployable` in the
   * `.ddd`.  Defaults to the single `d` (`CORPUS_DEPLOYABLE`) every ordinary
   * fixture declares, so only a MULTI-service fixture needs this key.
   *
   * It is declared here rather than discovered from the file map because the
   * compile harnesses must know what to build BEFORE they generate — and
   * because a fixture that quietly renames its deployable would otherwise turn
   * a compile gate into a no-op.  `corpus-coverage.test.ts` cross-checks this
   * list against the dirs actually emitted, so the two cannot drift.
   */
  readonly deployables?: readonly string[];
}

export const CORPUS: readonly CorpusFeature[] = [
  { id: "core-domain", title: "enum/VO/event/containment/derived/invariant/operation/find", doc: "language", backends: ALL },
  { id: "state-gate", title: "`when` canCommand state gate + GET can-query companion", doc: "criterion", backends: ALL },
  { id: "operation-returns", title: "exception-less `T or Error` operation returns", doc: "payloads", backends: ALL },
  { id: "union-find-absence", title: "union-returning finds (`Order or NotFound`, `Order option`)", doc: "payloads", backends: ALL },
  { id: "paged", title: "pagination — `find ... paged` Paged<T> envelope", doc: "payloads", backends: ALL },
  {
    id: "envelope",
    title: "`find … : T envelope` — the single-row find carrier (M-T6.57)",
    doc: "payloads",
    backends: ALL,
    note: "Minted by audit F57.  NO `.ddd` in the repo instantiated `envelope` before this fixture, so every compile gate was blind to the carrier by construction — java emitted an UNDECLARED `Envelope<Order>` in three signatures (port, Spring-Data interface, impl) and dotnet returned a bare `Order` from a `Task<Envelope<Order>>` (CS0029), while elixir `Repo.all`-ed EVERY row and answered a JSON array against its own single-object OpenAPI.  The carrier is ratified as a single-row find, so the point of the fixture is that `T envelope` emits exactly what `T` emits.",
  },
  {
    id: "paged-nonrelational",
    title:
      "`find … paged` × a NON-RELATIONAL carrier — the paged contract over a `shape: document` and a `persistedAs: eventLog` repository, both of which page in memory",
    doc: "payloads",
    backends: ALL,
    note: "Minted by ledger row F2-CB-C1.  Pagination and the storage shapes each had a fixture; their CROSSING did not, and that is exactly where it broke.  The route, the repository port and the response model all derive their contract from `pagedReturn(returnType)` and declared the 5-argument `Paged<T>` shape, while the document / event-log repository builders — which rehydrate and filter in app — had no paged branch and kept emitting the 1-argument unpaged method: CS0535 + CS0029 on .NET, a 5-arg call into a 1-arg `async def` (then `result.items`) on python.  No diagnostic anywhere — all five backends reported OK.  node / java / elixir already paged both carriers, which is the other half of why it stayed invisible: a fixture on any ONE of them would have passed.  `shape: embedded` is deliberately absent — it reuses the relational row table, so its paged find was always correct and `embedded.ddd` owns that shape.",
  },
  { id: "single-containment", title: "single (non-collection) containment — hidden `_parent`", doc: "language", backends: ALL },
  { id: "value-collections", title: "value-object array (`Money[]`) stored inline", doc: "language", backends: ALL },
  { id: "document", title: "`shape: document` — whole aggregate in one jsonb column", doc: "language", backends: ALL },
  {
    id: "document-collection-read",
    title:
      "collection READS over a `shape: document` aggregate's own lists — `lines.sum(λ)` / `.count` / `.any(λ)` over the containment, `.contains` over a scalar array",
    doc: "language",
    backends: ALL,
    note: "Split from `document` because the ELIXIR half was validate-gated long after the emission became correct: Route A had already made the containment a real `embeds_many` and the scalar array an `{:array, _}` field, so the shared collection-op renderers worked verbatim, but `loom.vanilla-document-unsupported` still refused EVERY collection method.  A REFERENCE collection (`X id[]`) is deliberately absent — that one still needs the join table a jsonb blob has no equivalent for, and stays an honest error.",
  },
  {
    id: "vo-decimal-derived",
    title:
      "`derived` decimal/money arithmetic over a VALUE OBJECT's sub-fields — the embedded-jsonb read vs. the plain column",
    doc: "language",
    backends: ALL,
    note: "Minted by sweep F-029.  No fixture crossed `valueobject` with decimal arithmetic, so nothing emitted the expression whose operands come out of a jsonb map.  On Phoenix those load as FLOATS where a plain `decimal` column loads as `%Decimal{}`, and `Decimal.mult/2` refuses an implicit float — the project compiled green, booted green, took the POST, and 500-ed on every read.  The `topLevel` control field pins the other half: a column-backed decimal must NOT be coerced, or a genuine type error hides behind the coercion.",
  },
  { id: "embedded", title: "`shape: embedded` — containments fold into jsonb columns", doc: "language", backends: ALL },
  { id: "embedded-optional", title: "shape: embedded — optional single containment (nullable jsonb)", doc: "language", backends: ALL },
  { id: "inheritance", title: "aggregate inheritance — TPH (sharedTable) + TPC (ownTable)", doc: "inheritance", backends: ALL },
  { id: "tph", title: "TPH-only (sharedTable) hierarchy — Vehicle/Car/Truck canonical fixture", doc: "inheritance", backends: ALL },
  {
    id: "tph-crossings",
    title:
      "TPH (sharedTable) × a CAPABILITY — a `softDeletable` concrete whose filter reads a column the shared table made nullable",
    doc: "inheritance",
    backends: TPH_CAPABILITY_FILTER,
    note: "Minted by pairwise F15.  `tph.ddd`'s concretes carry no capability, so nothing in the curated corpus crossed inheritance with a capability `filter` — and the crossing is where it broke: sharing a table makes a subtype's OWN columns nullable, so `softDeletable`'s `is_deleted` types as `bool | None` and python's `not_(Row.is_deleted)` stopped being a `ColumnElement[bool]` (4 × `mypy --strict` arg-type, once per emitted read).  The sibling crossing `shape: embedded` × TPH (pairwise F13) belongs in this fixture too and is named in its header: it waits on pairwise F11 (the drizzle repository targets the concrete's own, non-existent table), since adding it here would turn `corpus-tsc-build` red on a defect this fixture is not about.",
  },
  { id: "event-sourcing", title: "`persistedAs: eventLog` — append-only stream + appliers", doc: "workflow", backends: ALL },
  { id: "eventsourced-workflow", title: "event-sourced saga folding its own emitted events", doc: "workflow", backends: ALL },
  { id: "saga", title: "in-process dispatch / saga with persisted correlation", doc: "workflow", backends: ALL },
  {
    id: "workflow-enum-state",
    title: "workflow whose persisted state field is an enum — the instance-response DTO names <Enum>Schema",
    doc: "workflow",
    backends: ALL,
    note: "No corpus .ddd carried an enum-typed workflow STATE field before this one, so the compile tier never reached the emitters that name <Enum>Schema off instanceWireShape: node emitted 'claimState: ClaimStateSchema' with that name bound nowhere in the tree (TS2304), and react/vue/svelte imported it from whichever aggregate happened to be declared first (#2864 D4/T3).",
  },
  {
    id: "workflow-command-payload",
    title:
      "explicit-command workflow starter — `create(c: FileClaim)` over a declared `command` payload, whose wire record + wire→domain coercion every backend must emit",
    doc: "payloads",
    backends: ALL,
    note: "Added with #2864 D7/T2: no corpus fixture reached a payload-typed workflow param, and all five backends emitted a request record naming a wire type none of them declared.",
  },
  {
    id: "workflow-create-state",
    title:
      "COMMAND-triggered `create(params)` on a STATE-BEARING workflow — the create writes saga state, an `on(...)` reactor routes back onto the row it persisted",
    doc: "workflow",
    backends: ALL,
    note: "minted by the 2026-09-09 verification fleet (F58 / M-T6.62, P0): the corpus had event-triggered creates (`saga`) and stateless command creates, but NOTHING paired a command `create(params)` with workflow `Property` state — so the command route rendered its body against the default `this` receiver on all five backends and never loaded or saved the correlation row.  Four of the five emitted projects did not compile (`this.status` in a Hono module-scope arrow = TS2683; `this.Status` on a .NET handler with no such member; `this.setStatus(...)` on a Java service without it; an unbound `state` in the Elixir `with`-chain), python's `self._status` in a module-level `async def` was the silent one — and the missing row meant the reactor logged `event_unrouted` forever.  The COMPILE tier is what sees this class, which is what the fixture is for.  No `test e2e`: driving the command → event → reactor cascade over the wire reads the saga row back through the workflow-instance route, and minting that five-way golden is a behavioural-tier change of its own (same posture as `numeric-operands` / `collection-op-shapes`); the domain `test` block rides every backend's unit tier",
  },
  { id: "projection", title: "folded projection — read model folded from aggregate events (keyed row + on() folds)", backends: ALL },
  {
    id: "projection-fold-statements",
    title:
      "folded-projection fold body — the FULL pure statement vocabulary (`let` read by a later assign, scalar `+=`/`-=` over int and money, collection `+=`/`-=`)",
    backends: ALL,
    note: "Minted by ledger row F2-XB-4.  Every corpus fold was `:=`-only, so the other THREE kinds `foldImpurity` admits were unexercised on every backend — and four of five mis-emitted them, silently: .NET / java / elixir filtered the body to `kind === \"assign\"` (a `let` vanished while its uses survived → CS0103 / 'cannot find symbol' / 'undefined variable'; `+=` was dropped outright, so the column never accumulated), and python delegated to the EVENT-SOURCED applier renderer, whose list-only `.append` spelling is wrong on a projection row (every non-key column is nullable, and a scalar `+=` is not a list at all).  The money `+=` arm is deliberate: three backends have no `+` operator on their money representation (`Decimal.add` / `BigDecimal.add` / decimal.js), so a fold that reached the generic integer spelling would not compile.",
  },
  {
    id: "projection-implicit-sub",
    title:
      "implicit in-process subscription — a folded projection AND a workflow reactor whose events NO `channel` carries",
    doc: "channels",
    backends: ALL,
    note: "**D-PROJECTION-IMPLICIT-SUB**.  `deriveEventSubscriptions` used to open with `if (!channels || channels.length === 0) return []` and then keep only events some channel `carries:`, so an uncarried `on(e: E)` produced NO subscription on ANY backend — python emitted no `dispatch.py`, java/.NET/elixir no fold or reactor, node's route tee nothing to tee — and the read model it folds was never written.  The audit that found it had to construct the shape by DELETING the `channel` block from `projection.ddd`; this fixture is that shape, so the compile tier can finally see it.  No `test e2e`: the carried twin (`projection.ddd`) already runs the fold at runtime on the behavioural tier through the same dispatch path",
  },
  { id: "projection-aggregation", title: "whole-table aggregation — singleton query-time projection (count/sum/avg/min/max pushed to SQL)", doc: "language", backends: ALL },
  { id: "projection-groupby", title: "group by — grouped query-time projection (one row per group, key selects + per-group aggregates, GROUP BY/ORDER BY pushed to SQL)", doc: "language", backends: ALL },
  {
    id: "projection-agg-filters",
    title:
      "aggregation × capability filters — tenantOwned + softDeletable source, whole-table and grouped aggregations scoped by the SAME predicates the row read applies (plus an `ignoring` witness)",
    doc: "tenancy",
    backends: ALL,
    note: "minted by audit A1: the aggregation shapes read the source table DIRECTLY, so four backends applied only the projection's own `where` — a cross-tenant COUNT/SUM leak no fixture crossed",
  },
  {
    id: "part-rules-private-op",
    title:
      "part-level `check` / `invariant`, a GUARDED single-field invariant (messaged and not), and a private-operation call from a sibling operation — three domain rules with one enforcement site each",
    doc: "language",
    backends: ALL,
    note: "minted by M-T6.55 (F14/F15/F24).  All three shipped on node/.NET/java/python and were SILENT on Phoenix: the part changeset only `cast`, a guarded rule fell between the native `validate_*` path (which refuses a guard) and the residual carrier (which asked the native classifier and got null), and a bare private-op call rendered `_ = nil  # vanilla: bare call to 'recompute' (no callable target); record unchanged` — a comment in emitted output, not a diagnostic.  `Invoice.total` is assigned ONLY by the private operation, so a half-fix that emits the call but leaves `persistPutBodies` walking the caller's own statements still ships a row whose `total` never changes.  UNIT-TIER: a domain `test` block (no `test e2e`) is the runtime oracle for that write on all five — the `numeric-operands` shape.  NOT `with crudish`: that plus a relational entity part emits an `UpdateInvoiceRequest(… List<LineResponse>)` against an `Invoice.update(String, List<Line>)` and javac rejects the project — an older, separate java gap this fixture found and does not own (handed off in wave-c1-1f).",
  },
  {
    id: "find-bypass",
    title:
      "repository `find … ignoring <Cap>` / `ignoring *` — the capability-filter bypass on the ROW-shaped read path, crossed with a principal (`tenantOwned`) and a non-principal (`softDeletable`) filter, on a relational AND a `shape: document` aggregate",
    doc: "tenancy",
    backends: ALL,
    note: "minted by M-T6.54 F18.  `projection-agg-filters` witnesses `ignoring` on a query-time PROJECTION and the tenancy fixtures witness the filters with no bypass anywhere, so `find … ignoring` over a PRINCIPAL filter had no fixture at all — and java kept the tenant conjunct on both of its read surfaces (relational @Query JPQL and the document `findAll()`) while `loom.filter-bypass-unsupported`'s family list certified it as honouring the clause.  Every assertion over it is paired presence + ABSENCE: the failure mode is a RETAINED conjunct, invisible to a presence-only check.  Also pins the fail-OPEN direction — the root `findAll`/by-id reads carry no `ignoring` clause, so no OTHER find's bypass may widen them.",
  },
  {
    id: "projection-document-aggregation",
    title:
      "whole-table aggregation over a `shape: document` source — the row count (`count(*)` over the `(id, data, version)` triple), beside the per-row arm over the same source",
    doc: "language",
    backends: ALL,
    note: "minted by audit A1: `loom.projection-columnless-source` deliberately allows `count()` over a document source, and NOTHING pinned that the allowed cell still emits — while java's cell was broken outright.  Java JOINED the row 2026-09-13 (M-T4.2, wave C2 packet 2d): its aggregation over a document source runs the same query NATIVE (`createNativeQuery`, `select count(*) from <schema>.<table> e`) instead of as JPQL over an `@Entity` a document aggregate does not have, so the per-backend gate and its two `#document` message variants are deleted.  Proved on a BOOTED Spring Boot app against Postgres 18: the singleton arm answers `{\"articles\":0}` then `{\"articles\":3}` after three creates, and the grouped arm answers one row per id — numbers from the database, not from the emitter.  The filtered crossing is still refused universally (`loom.projection-document-source-capability-filtered`); that negative lives in `test/ir/projection-document-aggregation.test.ts`.",
  },
  {
    id: "projection-join",
    title:
      "projection join — the by-id follow (`join <Agg> as <alias> on <idRef>`), carrying the referenced row's fields onto each projection row",
    doc: "language",
    backends: ALL,
    note: "minted by the clause census: `ProjectionJoin` was at ZERO authored uses while four backend emitters, the lowering pass and two validator files all read `proj.joins`",
  },
  { id: "auth-oidc", title: "OIDC authentication — provider config + requires-guard", doc: "auth", backends: ALL },
  { id: "auth-simple", title: "dev-stub auth — user shape + requires-guard", doc: "auth", backends: ALL },
  {
    id: "auth-id-claim",
    title: "id-typed user claim — `customerId: Customer id?` in the `user { … }` block",
    doc: "auth",
    backends: ALL,
    note: "D6/P2 of docs/audits/2026-09-10-eshop-dev-experience.md — a claim naming a generated domain symbol broke four of five backends at once (doubled optional marker: `Ids.CustomerId | null | null` / `CustomerId | None | None` / a .NET `CustomerId??` that does not parse; plus a missing id import on node, java and python's OIDC verifier, where it is a per-call NameError rather than a type error).  The compile tier is the point of this fixture: java's leg is one line and catches the missing import outright.",
  },
  {
    id: "auth-id-claim-stub",
    title:
      "NON-optional id-typed user claim — `customerId: Customer id` with no `auth { … }` block, so every backend emits its DEV-STUB principal",
    doc: "auth",
    backends: ALL,
    note: "the sibling `auth-id-claim` covers the OPTIONAL spelling under `auth { oidc }`, and structurally cannot reach this: an optional claim short-circuits to null/None/nil in every stub table before the type is consulted, and on node/python/elixir the OIDC verifier REPLACES the dev stub rather than joining it.  So the `id` arm of the five stub value tables was corpus-unreachable — and four of the five wrote a raw scalar against a nominal id type (node TS2322 against the `__brand`, dotnet CS0029 against `readonly record struct CustomerId(Guid)`, java a null strong id where the others carry the zero id, elixir right by construction but decided alone).  Fixed once in `src/generator/_auth/dev-stub-id.ts`; the compile tier is the oracle, two of the four symptoms being hard compile errors.",
  },
  { id: "read-gates", title: "read-side requires gates — gated list read + folded and query-time projections", doc: "auth", backends: ALL },
  { id: "outbox", title: "durable channel / transactional outbox + relay", doc: "workflow", backends: ALL },
  {
    id: "workflow-primitive-params",
    title: "a command workflow's PRIMITIVE params at the wire boundary (RS-26) — every param kind in one create",
    doc: "workflow",
    backends: ALL,
    note: "the shape no fixture carried: a scalar request component cannot express absence, so java's `TopUpRequest(int qty, …)` bound a missing key to `0` while its own RequiredSet published the field as required",
  },
  {
    id: "channels-broker",
    title: "broker-bound channel — channelSource binds `queue/work` to rabbitmq, real driver code emitted",
    doc: "channels",
    backends: ALL,
  },
  { id: "tenancy-filter", title: "principal-referencing (tenancy) capability filter", doc: "capabilities", backends: ALL },
  { id: "tenancy-owned", title: "first-class tenancy — `tenancy by` + tenantOwned + crossTenant", doc: "tenancy", backends: ALL },
  { id: "tenancy-hierarchy", title: "tenancy hierarchy — `implements tenantRegistry` + `policy` deep/global/local read ladder", doc: "tenancy", backends: ALL },
  { id: "tenancy-claim-name", title: "tenancy claim not named `tenantId` — the declared claim binds the tenantOwned stamp/filter", doc: "tenancy", backends: ALL },
  { id: "policy-deny", title: "`policy { deny [write] on <Agg> }` — the deny-wins carve-out on both the read-filter and write-scope seams", doc: "auth", backends: ALL },
  { id: "policy-document", title: "`policy { allow deep / deny }` on a `shape: document` aggregate — the authz ladder applied IN-APP, where it cannot be a column predicate", doc: "auth", backends: IN_APP_DOCUMENT_FILTER },
  { id: "stamps", title: "lifecycle stamps (audit timestamps via stamp blocks)", doc: "capabilities", backends: ALL },
  { id: "field-defaults", title: "field `= default` — omittable create input, declared value applied", doc: "language", backends: ALL },
  {
    id: "reserved-words",
    title:
      "field names that are POSTGRES RESERVED WORDS (`order` / `group` / `limit`) — every SQL writer has to quote its identifiers",
    doc: "language",
    backends: ALL,
    note: "Minted by M-T6.42.  The class was unexercised: no fixture named a reserved word, so the Dapper adapter's bare identifiers (DDL *and* DML) were invisible to every gate — the C# compiles because the SQL is a string literal, and `schema-load` covered only the MIGRATION chain, which that adapter does not use.  Covers four clause positions a partial fix would miss: CREATE TABLE, the SELECT/INSERT column lists, a `find` WHERE, a retrieval ORDER BY, and CREATE INDEX.  Deliberately NOT a host-language-keyword test (`is` / `default` / `class` break the generated DTO, a different class no backend claims).  JAVA WAS EXCLUDED HERE UNTIL M-T6.43 — a gap, not a rejection: it generated and COMPILED, then 500d on the first insert, because the JPA entity emitted `@Column(name = \"order\")` bare and Hibernate derived `insert into ... (order, group, limit, ...)` from it.  Found by running this fixture's behavioural leg on a real booted Spring Boot + Postgres while landing M-T6.42.  Fixed by backtick-quoting the mapping annotations (Hibernate's portable quoting) off the SHARED word list in `src/generator/sql-reserved.ts`, and this row widening back to ALL is that mission's ratchet.",
  },
  {
    id: "java-reserved-words",
    title:
      "field / parameter / enum-value names that are HOST-LANGUAGE reserved words (`final`, `native`, `synchronized`, `transient`, `throws`, `strictfp`, `boolean`) — the java-identifier class `reserved-words.ddd` deliberately excludes",
    doc: "language",
    backends: ALL,
    note: "Minted by M-T6.36 (wave C2 packet 2d).  `reserved-words.ddd`'s closing note names this class and declines it: a host-language keyword breaks the generated DTO / entity, not the SQL, and no backend claimed it.  Java was the one that could not simply escape — C# has verbatim identifiers, TS allows any property name, python/elixir escape locals only — because a Java record component name IS the Jackson property, the springdoc schema key and the Spring binding path, so a rename moves the wire on java alone.  That is why the shape was REFUSED (`loom.java-reserved-identifier-unsupported`) rather than emitted.  The fix pairs a mangled host identifier with an explicit wire annotation at every such site, and this fixture is the ratchet on the pairing: the names are reserved in JAVA ONLY and are not Postgres reserved words, so the other four backends must keep emitting them bare (that is the `ALL` row, not a java-only one) and the SQL-quoting concern stays with `reserved-words.ddd`.",
  },
  {
    id: "vo-field-default",
    title:
      "VALUE-OBJECT-typed field default — the wire boundary renders a non-scalar default differently from a scalar one",
    doc: "language",
    backends: ALL,
    note: "compile-tier by necessity: hono COMPILES the defect by structural typing, so only the strict backends (python mypy --strict, .NET) can see it",
  },
  {
    id: "nested-valueobject",
    title:
      "a value object whose OWN field is a value object (`Addr.geo: Geo`) — the flattening RECURSES to leaf columns, and nothing named `home_geo` exists",
    doc: "language",
    backends: ALL,
    note: "minted by the e-shop dev-experience audit (P11): the corpus had no VO inside a VO, and python's repository flattening stopped one level short of its own schema's.  app/db/schema.py and the migration both created `home_geo_lat`/`home_geo_lng` while person_repository.py bound `\"home_geo\": aggregate.home.geo` and read `Addr(row.home_line1, row.home_geo)` — a column in NEITHER, so every read and every write of the aggregate failed at runtime, on the plain REQUIRED case and invisibly to every type checker.  dotnet rode here to SETTLE a second, unproven reading — `ownedVoLines` recurses with the builder lambda parameter hard-coded to `o`, so the nested VO emits `o.OwnsOne<Geo>(x => x.Geo, o => { … })`, which the audit read as CS0136 with no .NET SDK available to check.  It is NOT: this fixture builds clean under `dotnet build /warnaserror` on sdk:10.0, so the emitter was left alone and the leg now gates the nested column NAMES (`home_geo_lat`/`home_geo_lng`, the accumulated prefix) instead.  node/java/elixir were already correct and are carried as the contrast.",
  },
  {
    id: "optional-valueobject",
    title:
      "an OPTIONAL value-object field (`office: Addr?`) beside a REQUIRED one — the same flattened leaf columns, merely nullable",
    doc: "language",
    backends: ALL,
    note: "minted by the e-shop dev-experience audit (D5/P3): NOTHING in the corpus carried an optional VO, and two backends had left the required path behind.  node narrowed only the ONE leaf column its `== null` probe touched, leaving every other leaf `string | null` against a constructor wanting `string` (TS2345 per subfield per read path); dotnet did not take the owned path at all, emitting `Property(x => x.Office).HasColumnName(\"office\")` for a column the migration never creates — a complex type EF cannot map as a scalar, so the MODEL failed to build and every read and write of the aggregate died.  java/python/elixir were already correct and are carried here as the contrast.",
  },
  {
    id: "temporal",
    title:
      "duration arithmetic in both positions — in-app `dt − dt` against composed units, and an interval added to a datetime COLUMN inside a `find … where` (pushed to SQL)",
    doc: "language",
    backends: ALL,
    note: "Promoted from five per-backend string tests (M-T9.42, 813 LOC) that asserted the RENDERED arithmetic — `((this._gracePeriod) * 86400000) + ((30) * 60000)` on node, `make_interval(days => 30)` in the repository, a `java.time.Duration` spelling on java.  Each pinned one emitter's spelling of a unit conversion and none could tell whether the conversion was CORRECT.  Every value the e2e asserts is chosen to FLIP when a unit is wrong, and none depends on the datetime wire format (no corpus e2e pins a datetime read-back; that shape is a separate contract with its own RS rules).  IT IMMEDIATELY EARNED ITS KEEP, on FIVE emitters: the VALUE-side arm (`this.dueDate < q + days(2)`) 500s on node and elixir, because the bound datetime reaches Postgres untyped and `unknown + interval` resolves it to `interval` — and the deleted node test asserted that exact broken spelling, character for character, and passed.  It also found that BOTH alternate-persistence adapters (mikroorm, dapper) emitted a runtime-throwing stub for every `datetime \u00b1 duration` predicate while `find-predicate-capability.ts` declared both shapes lowerable \u2014 a silent gap nothing had driven, now closed on both.  The six arms the e2e drives are: column-side interval, value-side interval, the same predicate through a reified criterion, `dt − dt` vs composed units, duration × int, `datetime − duration`, and the commuted `duration + datetime`.  What did NOT survive the deletion, named rather than dropped silently: the phase-⑦ rejection gate (kept, deduplicated, as `test/ir/temporal-queryable-gate.test.ts` — a behavioural test cannot observe a program the compiler refuses); .NET's `not.toContain(\"TimeSpan.From\")` (an EF-translatability claim, which EF Core now enforces by THROWING on an untranslatable `Where`, so the elixir/dotnet behavioural legs make it); and python's `not.toContain(\"python-dateutil\")` (a dependency-manifest claim, not a temporal one — and one whose failure mode is a deliberate act, not a regression).",
  },
  { id: "extern", title: "extern operations — preconditions gate a user handler", doc: "extern", backends: ALL },
  { id: "extern-handlers", title: "extern commandHandler / queryHandler — bodyless, scaffold-once user impl", backends: ALL },
  {
    id: "handler-resource-ops",
    title:
      "resource-op inside a commandHandler / queryHandler body — the second legal site for outbound I/O",
    doc: "resources",
    backends: ALL,
    note: "Four of five emitters could not render this LEGAL site: node / python emitted the helper call with no import (TS2304 / F821), .NET and java THREW 'reached the renderer without a resource class mapping' at generate time; only elixir was correct (it fully-qualifies the module). The handler loads via a declared FIND rather than `byId`, so the fixture isolates the resource-op leg from the unrelated `Agg id` path-param coercion.",
  },
  {
    id: "handler-triad",
    title:
      "handler-body shapes the emitters mishandled — an aggregate-less handler, a declared `byId` find called with an already-typed `Agg id`, and a dereferenced (non-optional) find",
    doc: "language",
    backends: ALL,
    note: "The three defects #2652 measured and left unfixed. .NET DROPPED the aggregate-less handler and its route entirely (`if (!primaryAgg(h)) continue`); java renamed a declared `byId` find to `getById` and re-wrapped its already-typed argument (`getById(new OrderId(orderId))`, javac `incompatible types`). The third — an OPTIONAL find bound in a handler body, dereferenced unguarded (TS18047 / CS8602) — is now refused at phase ⑦ (`loom.handler-load-nullable-unsupported`), so this fixture carries the non-optional spelling and the refusal is pinned separately.",
  },
  { id: "seeding", title: "seed datasets — default / demo / wired-raw", doc: "language", backends: ALL },
  {
    id: "seed-values",
    title: "seed data read back — the seeder's rows through a collection read, and the opt-in dataset gate",
    doc: "language",
    backends: ALL,
    note: "Split from `seeding` so the two halves can have different BEHAVIOURAL reach: this one reads a collection (the only route class that can see seed rows, and therefore the only one whose body differs on a leg that starts empty), so it was held off the elixir behavioural leg — which emitted no seeder at all (B19) — via BEHAVIOURAL_SKIP, while `seeding` kept its CRUD/FK/404 round-trip armed on all five. M-T6.37 landed the Ecto seeder and that skip is deleted, so this case now runs on all five legs too; the split stays because it is what kept the five-backend coverage armed while one leg was odd.",
  },
  { id: "resources", title: "external resources — objectStore / queue / http api / mailer (smtp) clients", doc: "resources", backends: ALL },
  {
    id: "file-download",
    title:
      "a `File` field over an objectStore — the root `POST /files` + `GET /files/{key}` pair, and the absent-object 404",
    doc: "resources",
    backends: ALL,
    note: "Split from `resources` (which binds an objectStore but declares no `File` field, so no backend emits the /files routes for it): the download route had NO golden on any backend, which is how its absent-object 404 stayed a fourth envelope shape on all five at once (M-T6.39). The 404 itself is not expressible in the `test e2e` DSL, so it rides the behavioral tier's absent-file probe in wire-differential.mjs.",
  },
  {
    id: "api-call",
    title: "typed in-system api call — `resource { kind: api, use: <Api> }` a sibling deployable serves",
    doc: "resources",
    backends: ALL,
    note: "Two deployables: the caller's client is DERIVED from the callee's served operation set, so a single-deployable fixture cannot exercise it.",
    // The emitted DIR names, which are snake_cased from the deployable names
    // (`ordersSvc` → `orders_svc`) — the coverage gate cross-checks these
    // against what actually lands on disk.
    deployables: ["orders_svc", "shipping_svc"],
  },
  { id: "provenance", title: "provenanced stored fields — per-write-site rule snapshots", doc: "provenance", backends: ALL },
  {
    id: "audited",
    title: "command audit — aggregate-wide `audited` + per-command `audited`, transactional audit_records rows",
    doc: "audit",
    backends: ALL,
  },
  {
    id: "audit-history",
    title: "entity history — the derived `GET /<agg>/{id}/history` read over audit_records",
    doc: "audit",
    // ALL FIVE now serve the endpoint (M-T3.9 read path complete).  Each
    // backend's behavioral leg diffs its booted responses against the wire
    // golden minted from node — A≡golden ∧ B≡golden ⇒ A≡B, so this row being
    // ALL is a proven cross-backend equality, not five self-assertions.
    backends: ALL,
  },
  {
    id: "field-mask",
    title:
      "field read-redaction — `mask unless` crossed with `audited` (two masked fields + a masked contained part, projected twice in one scope)",
    doc: "auth",
    backends: ALL,
    note: "the CROSSING is the point: an audited op renders the masked projection twice into one method body, which is where a fixed principal-variable name collides (.NET CS0128)",
  },
  {
    id: "lifecycle-guard",
    title:
      "lifecycle authorization gate — `requires` in the canonical `create` (principal-only, pre-construction) and `destroy` (principal + `this`, post-load)",
    doc: "auth",
    backends: ALL,
    note: "the two halves render in DIFFERENT places — a create guard has no `this` yet, a destroy guard reads the row the caller already loaded; `Crate` carries the OTHER two shapes (an ungated create as the control, and a principal-ONLY destroy guard that leaves the loaded row unread)",
  },
  {
    id: "criterion-filter",
    title: "reusable criterion (criterion.md) used as `filter <Criterion>`",
    doc: "criterion",
    backends: ALL,
  },
  {
    id: "prefix-filter",
    title: "`startsWith` prefix-match filter operator — inline find + criterion filter",
    doc: "stdlib",
    backends: ALL,
    note: "the first bool-returning QUERYABLE intrinsic: it stands alone in predicate position, where a scalar intrinsic only ever appears as a comparison operand",
  },
  {
    id: "domain-services",
    title: "domainService — cross-aggregate pure/reading/mutating ops orchestrated by workflows",
    doc: "domain-services",
    backends: ALL,
  },
  {
    id: "scaffold-macros",
    title: "stdlib macros — crudish (create/update/destroy) + softDeletable capability + softDelete ops",
    doc: "scaffold-macros",
    backends: ALL,
  },
  {
    id: "collection-op-shapes",
    title:
      "collection-op / operator shapes no other fixture witnesses — arithmetic-λ `sum`, `distinct` over money, argless `any()`, DESCENDING `sortBy`, unary `-` on money, `-=` over an `int[]`",
    doc: "stdlib",
    backends: ALL,
    note: "minted by the 2026-08-17 generator code review (A5/A10–A14): every one of these rendered wrong on at least one backend — java's descending sortBy did not COMPILE, node/elixir/python's money fold was broken by a missing `binary` arm in `bodyTypeOf`, elixir's argless `any()` was always false — and none appeared anywhere in the corpus, examples or journey/, so no compile gate could see them.  Writing it also surfaced an UNFILED .NET sibling of A13 (scalar-array mutation routed through a `_codes` backing field that does not exist → CS0103), fixed in the same change.  No `test e2e` block: this is a compile-tier witness, and adding one would mint recorded wire cases whose goldens cannot be captured from the fixture PR",
  },
  {
    id: "numeric-operands",
    title:
      "RIGHT-HAND money/decimal operands — `int * money` (commutative product), `int + decimal`, `int < decimal`, `int == decimal`, plus a decimal-on-the-right repository filter",
    doc: "stdlib",
    backends: ALL,
    note: "minted by the 2026-08-23 numeric-types audit (F7 / M-T6.44): the validator admits every one of these, but the TS and Elixir binary renderers gated money/decimal dispatch on `leftType` ALONE — node emitted native `*` on a decimal.js Decimal (TS2363, uncompilable), elixir emitted native arithmetic on a %Decimal{} (runtime ArithmeticError) and native `<` (Erlang TERM ordering: number < map is ALWAYS true, silently).  No corpus fixture had a right-hand money/decimal operand, so no compile gate could reach the arms.  The `test` block is the runtime value proof on every backend's unit tier; no `test e2e` — the derived decimal values sit inside the un-ruled F11/M-T5.22 cross-backend arithmetic divergence, so a wire golden here would pre-empt that owner ruling (literals are binary-exact so the unit assertions agree everywhere regardless)",
  },
  {
    id: "absent-optional",
    title:
      "a null-guard rule over an OPTIONAL field (`estimate == null || estimate >= 0`) + a create body that OMITS the field",
    doc: "language",
    backends: ALL,
    note: "minted by the Fable field test (A1): node's zod refine rendered `==` as JS `===`, so an omitted optional key — `undefined`, the wire's OTHER spelling of absent — failed the guard and `POST /api/tasks` answered 422 where .NET and Python answered 201.  No corpus fixture omitted an optional field a rule then referenced, so the five-way wire golden could not see the divergence at all.  The aggregate is `Ticket`, not the `Task` the field test used: an aggregate named `Task` shadows `System.Threading.Tasks.Task` inside the generated .NET repository, so `ITaskRepository` and `TaskRepository` disagree on `SaveAsync(Task, CancellationToken)` and the project does not compile (CS0535/CS0738, reproduced on the behavioral-dotnet leg).  That BCL-name collision is real and unfixed — `loom.dotnet-name-collision` (#2737) refuses a member colliding with a SIBLING type, not an aggregate colliding with a type the emitter itself uses — but it is not what this fixture is for, and pinning it here would make the absent-optional row unreachable on .NET",
  },
  {
    id: "optional-reference",
    title:
      "an OPTIONAL cross-aggregate reference (`lastKnownLocation: Location id?`) beside a required one — a nullable cross-aggregate FK",
    doc: "language",
    backends: ALL,
    note: "minted by audit #2864 finding T4 (M-T1.33): every `X id` in the corpus was REQUIRED, so no fixture ever generated a page that had to render a reference which might not be there — and the reference-LINK path was the one place the frontends' null guard had never been applied.  Unguarded it broke all six frontends at once, two of them fatally (vue-tsc TS2345 on `:title`, an F# `string` + `string option` on Feliz); the other four compiled and linked to the literal path `/locations/null`.  The `origin` field is required deliberately: the guard applies to the optional reference ONLY, so a regression that guards every reference is caught by the same generation.  Backend-side this is an ordinary nullable FK, which is why the row is ALL — the fixture's value is the SHAPE, not a backend gap.  It carries NO `ui`: the corpus is a backend matrix (`clause-census.test.ts` states that), so the frontend half of the defect is gated by `test/generator/_walker/id-link-optional-cross-target.test.ts` plus the vue and feliz `scaffold` build cases, which now carry an optional reference each.",
  },
  {
    id: "validation-messages",
    title:
      "authored `message \"…\"` on invariant / field check / precondition / VO invariant + the per-backend message CATALOG the wire `code` resolves against",
    doc: "language",
    backends: ALL,
    note: "the FIRST corpus fixture with a `message` clause at all — before it, every backend's messaged-rule carrier AND the M-T1.11 catalog emission were uncompiled by the corpus tier (retro §78: a conditional emission needs a fixture that satisfies its condition)",
  },
] as const;

/** Lookup by id. */
export function corpusFeature(id: string): CorpusFeature | undefined {
  return CORPUS.find((f) => f.id === id);
}
