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

/** The backends that correctly MATERIALISE a value object resolved from a SIBLING
 *  context — i.e. that emit every artifact the VO needs, not just the reference
 *  to it.
 *
 *  `python` and `elixir` are absent, and this is the NAME of that exclusion.  One
 *  root cause, two shapes: both emitters resolve a VO name through
 *  `ctx.valueObjects` only, so the CALL SITE (derived from the aggregate's wire
 *  shape, which spans contexts) is emitted while the DEFINITION (derived from the
 *  context's own VO list) is not.
 *
 *    python  `db/schema.py` and the migration create `ship_to_line1` /
 *            `ship_to_geo_lat` / `ship_to_geo_lng`, while `receipt_repository.py`
 *            binds `"ship_to": aggregate.ship_to` on insert, `root["ship_to"]` on
 *            upsert and reads `ship_to=row.ship_to` on hydrate — a column in
 *            NEITHER artifact, so every read and every write of the consuming
 *            context's aggregate fails.  `mypy --strict` sees only the hydrate
 *            site (the two bind sites are untyped dict literals), so the compile
 *            tier catches 1 of the 3.
 *    elixir  `receipt_controller.ex` calls `serialize_addr(record.ship_to)` and
 *            defines neither `serialize_addr/1` nor the nested `serialize_geo/1`,
 *            while the OWNING context's `person_controller.ex` defines both —
 *            `** (CompileError) undefined function serialize_addr/1`, so
 *            `mix compile --warnings-as-errors` fails outright.
 *
 *  This is the platform evaluation's F-008.  The fix on both is to resolve through
 *  the sibling pool (as `findValueObjectInScope` already does elsewhere); each key
 *  returns the day its emitter does.
 *
 *  NOTE FOR THE NEXT READER — elixir was first recorded here as FREE, on the
 *  reasoning that a VO is one `:map`/jsonb cell there so there is no flattening to
 *  get wrong.  That reasoning was sound and the conclusion was wrong: flattening
 *  is not the only artifact a VO needs, and the claim came from INSPECTING the
 *  emitted schema rather than compiling the project.  `mix compile` in CI found it
 *  in minutes.  Same correction the commons dev-experience audit had to make for
 *  the same reason (grading a target by inspection); see
 *  docs/audits/2026-09-29-fixture-shape-coverage.md. */
const SIBLING_VO_RESOLUTION: readonly Backend[] = ALL.filter(
  (b) => b !== "python" && b !== "vanilla",
);

/** The backends that emit a ROOT-LEVEL (shared-kernel) value object's declaration
 *  BEFORE the context-local one whose field is typed by it.
 *
 *  `node` and `python` are absent, and this is the NAME of that exclusion — one
 *  emission-order bug reached from one shape on two backends.  node's
 *  `http/<agg>.routes.ts` initialises `const OuterSchema` from `UnLocodeSchema`
 *  four lines before that `const` is declared (`TS2448` + `TS2454`), a temporal
 *  dead-zone read that is fatal at module evaluation — the generated API does not
 *  boot.  python's `app/domain/value_objects.py` and `app/http/wire_models.py`
 *  both emit `class Outer` ahead of `class UnLocode` (`ruff F821`, four times).
 *  This is the evaluation's F-007, whose FRONTEND half is already fixed
 *  (`web/src/api/<agg>.ts` orders correctly) while both backend halves are open.
 *  `orderValueObjectsByDependency` (src/ir/util/reachable-types.ts) exists for
 *  exactly this; both keys return when the emitters route through it. */
const ORDERED_ROOT_VO_EMISSION: readonly Backend[] = ALL.filter(
  (b) => b !== "node" && b !== "python",
);

/** The backends that import the regex machinery into EVERY file they lift a
 *  `.matches(<regex>)` value-object invariant into.
 *
 *  `python` is absent, and this is the NAME of that exclusion: `app/http/wire_models.py`
 *  emits `re.search(...)` and its import block has no `import re` (`ruff F821`),
 *  while the domain half (`app/domain/value_objects.py`) imports it correctly.
 *  That is the evaluation's F-013's defect class exactly — .NET's own instance of
 *  it (a FluentValidation request validator calling `Regex.IsMatch` with no
 *  `using`) is FIXED and verified under `dotnet build /warnaserror` on sdk:10.0.
 *  node is free (the regex is an inline literal), java imports
 *  `java.util.regex.Pattern`, elixir's `Regex`/`=~` live in Kernel.  One import in
 *  the python wire-model emitter returns the key. */
const WIRE_REGEX_IMPORT: readonly Backend[] = ALL.filter((b) => b !== "python");

/** `projection-valueobject-row` — a `valueobject` field on a FOLDED PROJECTION's
 *  read model.  The shared `MigrationsIR` spreads it into one column per leaf
 *  (`stamp_at_time` / `stamp_who`) while every response DTO declares it NESTED,
 *  so a read model has to bridge the two halves: the fold writes the leaves, the
 *  read route rebuilds the nest.
 *
 *  **node** does, as of the PR that mints this fixture.  The other four are
 *  excluded — an honest, named exclusion rather than a red gate, and each key
 *  returns with its own fix:
 *
 *  - **java** almost certainly belongs here already: it is the one backend whose
 *    emission bridges both halves — `@Embedded` + `@AttributeOverride` onto
 *    exactly the migration's flat columns (`emit/projection-state.ts`), then
 *    `new OrderBoardResponse(…, StampResponse.from(x.stamp()), x.seen() == null ?
 *    null : StampResponse.from(x.seen()), AuditResponse.from(x.audit()))` with
 *    both response records emitted (`emit/projection-reads.ts`).  It is held out
 *    only because it was not COMPILED: `gradle testClasses bootJar` in
 *    `gradle:9-jdk25` could not resolve its dependencies (Maven Central answered
 *    429 through the sandbox proxy, twice).  Adding `"java"` here is a one-line
 *    change for whoever can run that gate.  One behavioural caveat to check when
 *    they do: JPA hands back a non-null `@Embedded` instance with null fields
 *    when every column is null, so java's `x.seen() == null` arm may answer an
 *    object of nulls where node answers `null`.
 *
 *  - **dotnet**: `OrderBoardRowConfiguration` maps the value object as a SCALAR
 *    property to one column (`builder.Property(x => x.St).HasColumnName("st")`)
 *    that the migration never creates, so EF fails at model build.  The
 *    controller half is already right (it projects a nested `StampResponse`).
 *  - **python**: the route returns `{"st": row.st}` against a SQLAlchemy model
 *    whose only attributes are `st_at_time` / `st_who` — `AttributeError`.
 *  - **elixir** (`vanilla`): the row schema types the field `field :st, :map`
 *    over a table with no `st` column.  Its fix is entangled with #3082, which
 *    makes elixir's state-table migration COLLAPSE value-object leaves into one
 *    `:map` column — i.e. elixir is moving to a different column shape than the
 *    other four read.  That fork wants settling before a key is minted here. */
const PROJECTION_VO_ROW: readonly Backend[] = ["node"];

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
  {
    id: "enum-collection",
    title: "an enum COLLECTION field (`skills: Skill[]`) — the enum × array crossing",
    doc: "language",
    backends: ALL,
    note: "Minted by audit F-014 (S1).  The corpus carried scalar enums and scalar/VO arrays, but never the two CROSSED, so every compile gate was blind to it by construction — and elixir's Ecto mapper folded the enum's `values:` (an option of `field/3`) into the array TYPE tuple: `field :skills, {:array, Ecto.Enum, values: [...]}` → `** (ArgumentError) invalid type … for field :skills`, i.e. `mix compile` fails on the emitted project.  A SCALAR enum sits on the same aggregate so a fix that simply stopped emitting `values:` for arrays cannot pass.",
  },
  {
    id: "vo-id-reference",
    title:
      "a value object holding a CROSS-AGGREGATE REFERENCE (`ship: Ship id`) — in a field, a `derived` type and a `function` parameter",
    doc: "language",
    backends: ALL,
    note: "compile-tier by necessity: the defect it pins is a MISSING IMPORT, which emits cleanly and only fails the type-checker. The corpus had no value object holding an id at all — every one was scalar-only — which is how node shipped `domain/value-objects.ts` with zero import statements (TS2503). The other four backends already imported the id type, so this row is what keeps all five honest.",
  },
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
    note: "Minted by pairwise F15.  `tph.ddd`'s concretes carry no capability, so nothing in the curated corpus crossed inheritance with a capability `filter` — and the crossing is where it broke: sharing a table makes a subtype's OWN columns nullable, so `softDeletable`'s `is_deleted` types as `bool | None` and python's `not_(Row.is_deleted)` stopped being a `ColumnElement[bool]` (4 × `mypy --strict` arg-type, once per emitted read).  The sibling crossing `shape: embedded` × TPH (pairwise F13) is deliberately NOT here, as the fixture's header says: under D-EMBEDDED-TPH an `embedded` concrete of a `sharedTable` base is refused at phase ④ (`loom.es-tph-forced-own-table`, src/language/validators/inheritance.ts), so the crossing no longer validates and has nothing to compile.",
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
    note: "minted by the 2026-09-09 verification fleet (F58 / M-T6.62, P0): the corpus had event-triggered creates (`saga`) and stateless command creates, but NOTHING paired a command `create(params)` with workflow `Property` state — so the command route rendered its body against the default `this` receiver on all five backends and never loaded or saved the correlation row.  Four of the five emitted projects did not compile (`this.status` in a Hono module-scope arrow = TS2683; `this.Status` on a .NET handler with no such member; `this.setStatus(...)` on a Java service without it; an unbound `state` in the Elixir `with`-chain), python's `self._status` in a module-level `async def` was the silent one — and the missing row meant the reactor logged `event_unrouted` forever.  The COMPILE tier is what sees this class, which is what the fixture is for.  M-T5.36 P9 (F5) added the BEHAVIOURAL half: driving the command → event → reactor cascade over the wire reads the saga row back through the workflow-instance route, and the `test e2e` DSL had no verb for that — `api.fulfillment.run(…)` was refused as an unknown AGGREGATE — so the note here used to defer it.  `api.<wf>.run(…)` / `.instances()` / `.instance(key)` are that verb set, and this fixture is their runtime proof: the folded `status` / `attempts` scalars are asserted on the very row the command create must have persisted, which is the half of F58 no compile gate can see",
  },
  { id: "projection", title: "folded projection — read model folded from aggregate events (keyed row + on() folds)", backends: ALL },
  {
    id: "projection-valueobject-row",
    title:
      "value object on a folded read model — leaf columns folded, nested object served (plus an absent optional one and a value object inside a value object)",
    backends: PROJECTION_VO_ROW,
    note: "Minted by the PR that fixed node (`backends` is node-only — see `PROJECTION_VO_ROW` for why each of the other four is held out, java included).  The shape validated `0 error(s)` and emitted on all five backends while FOUR of them produced a read model that cannot run — node with two compile errors in the generated project (`state.stamp = e.stamp` against a row that holds `stamp_atTime` / `stamp_who`, TS2339; `stamp: StampSchema.nullish()` with `StampSchema` declared nowhere, TS2304), dotnet with an EF model-build failure, python with an `AttributeError`, elixir naming a column the migration does not create.  Only java bridged the flat-column / nested-wire halves.  Nothing caught it because no corpus fixture carried a value object on a folded projection, so no tier ever compiled or booted one.  The optional field is never folded on purpose (the wire `null` arm) and `Audit` holds a `Stamp` on purpose (two levels of flattening, which a one-level implementation gets wrong silently).",
  },
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
    note: "minted by M-T6.54 F18.  `projection-agg-filters` witnesses `ignoring` on a query-time PROJECTION and the tenancy fixtures witness the filters with no bypass anywhere, so `find … ignoring` over a PRINCIPAL filter had no fixture at all — and java kept the tenant conjunct on both of its read surfaces (relational @Query JPQL and the document `findAll()`) while `loom.filter-bypass-unsupported`'s family list certified it as honouring the clause.  Every assertion over it is paired presence + ABSENCE: the failure mode is a RETAINED conjunct, invisible to a presence-only check.  Also pins the fail-OPEN direction — the root `findAll`/by-id reads carry no `ignoring` clause, so no OTHER find's bypass may widen them.  Since F-005 this fixture is also the corpus' only source of `loom.tenancy-filter-bypass` — four warnings, one per `ignoring`-bearing find over a `tenantOwned` aggregate, all TRUE positives (that crossing is the fixture's subject), and the only trips a full-corpus `ddd parse` sweep reports for that code.",
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
    id: "channels-broker-workflow",
    title: "durable broker channel + a workflow + NO reactor — the producer-only saga service",
    doc: "channels",
    backends: ALL,
    note: "the axis pair `channels-broker` misses: it is the same producer WITHOUT a workflow, so it takes the workflow-less emission path and emits the outbox machinery fine.  Owning one workflow leaves that path, and the with-workflows path emitted the machinery only from inside the subscription block — which a producer-only context never enters.  Neither ran, while index.ts/http/index.ts referenced all three factories unconditionally: TS2304 + three TS2305 on a model that validated 0 error(s).  Only the compile tier can see it.",
  },
  {
    id: "projection-split-deployables",
    title: "a query-time projection on a deployable that does not host every context",
    // `language`, like its `projection-aggregation` / `projection-groupby`
    // siblings: there is no `docs/projection.md`, and the query-time surface
    // is documented in the language reference.
    doc: "language",
    backends: ALL,
    // Two services on purpose — the defect is only reachable when the
    // projection's deployable does NOT host the sibling context.
    deployables: ["billing", "reports"],
    note: "the projection routes file imported `valueObjectPool(ctx)` (own UNION sibling-context) while `domain/value-objects.ts` emits only the hosted contexts' — so on a split system it named a type the module never exports (TS2306 'not a module').  Every projection fixture before this was single-deployable, which is why the pool and the emitted file agreed by accident.",
  },
  {
    id: "workflow-primitive-params",
    title: "a command workflow's PRIMITIVE params at the wire boundary (RS-26) — every param kind in one create",
    doc: "workflow",
    backends: ALL,
    note: "the shape no fixture carried: a scalar request component cannot express absence, so java's `TopUpRequest(int qty, …)` bound a missing key to `0` while its own RequiredSet published the field as required.  Since F-113 this fixture is the corpus' only source of `loom.workflow-param-unused` — five warnings (`serial`/`ratio`/`at`/`amount`/`memo`), all TRUE positives: the body reads four of its nine params on purpose, because the subject is how each param kind crosses the WIRE, not what the body does with it.  Leave them unread; reading them would change the emitted body on all five compile legs for no gain.",
  },
  {
    id: "channels-broker",
    title: "broker-bound channel — channelSource binds `queue/work` to rabbitmq, real driver code emitted",
    doc: "channels",
    backends: ALL,
  },
  { id: "tenancy-filter", title: "principal-referencing (tenancy) capability filter", doc: "capabilities", backends: ALL },
  {
    id: "principal-read-filter",
    title:
      "an AUTHOR-WRITTEN `currentUser` predicate in a `find` / `retrieval` `where` — the row-level \"my own records\" query, as opposed to a DERIVED tenancy filter",
    doc: "auth",
    backends: ALL,
    note: "Minted by audit F-013 (S1).  `currentUser` appeared in the corpus only inside GATES (`requires …`) and inside the tenancy filters the ENRICHMENT synthesises — never inside a predicate an author wrote on a query, which is a different emitter path on every backend.  Elixir broke twice on that path: the principal was interpolated UNPINNED into the Ecto `where:` (`Ecto.Query.CompileError: unbound variable current_user in query` — the fail-closed `^(current_user && …)` pin came from a post-pass that only saw the derived filters, so the compiler-generated tenancy filter on the NEXT emitted line pinned while the author's did not), and the actor was never THREADED into the find/retrieval head, since the \"needs the principal\" predicate read the aggregate's capability `filter`s only.  Both are hard `mix compile` failures.  The fixture carries NO tenancy capability on purpose — with one, the derived filter threads the actor and MASKS the author-written half, which is exactly why this survived.",
  },
  { id: "tenancy-owned", title: "first-class tenancy — `tenancy by` + tenantOwned + crossTenant", doc: "tenancy", backends: ALL },
  { id: "tenancy-hierarchy", title: "tenancy hierarchy — `implements tenantRegistry` + `policy` deep/global/local read ladder", doc: "tenancy", backends: ALL },
  {
    id: "org-context",
    title:
      "`organizationContext` — the operating-scope accessor re-rooting the tenantOwned write stamp, behind every backend's fail-closed `x-org-context` switch gate",
    doc: "tenancy",
    backends: ALL,
    note: "M-T3.6 items 3+5.  The accessor lands only with its gate, so this fixture is what puts BOTH in front of all five compile tiers: the stamp (`dataKey := organizationContext.orgPath`) and an operation body read lower to the derived principal member `currentUser.orgContextPath`, and every backend's auth layer emits the gate that sets it.  No `test e2e` block and no wire golden: no wire shape is new (the accessor never reaches the wire), and the runtime proof — in-scope switch stamps + deep-read visibility, out-of-scope switch 403 with no write, forged header on an orgPath-less token 403, reads principal-anchored — is the booted `tenancy-org-context*` leg of tenancy-e2e.",
  },
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
    id: "dotnet-bcl-type-collision",
    title:
      "a domain type whose name is also a BCL type the .NET `using` set brings into scope (`aggregate Task` vs `System.Threading.Tasks.Task`, `aggregate Queue` vs `System.Collections.Generic.Queue`)",
    doc: "language",
    backends: ALL,
    note: "Minted by #3024.  `ddd new --platform dotnet --template crud` emits an aggregate named `Task`, and the generated project did not build AT ALL: `generate system` reported `0 error(s), 0 warning(s)` and `dotnet build` then produced 17 errors — CS0104 in every file that wildcard-imports the domain namespace, plus CS0535/CS0738 because the repository INTERFACE *declares* that namespace, so its bare `Task SaveAsync` return silently meant the DOMAIN type and disagreed with its own impl.  Repaired rather than refused (a file-scoped `using Task = <ns>.Domain.Tasks.Task;` outranks the wildcard import and, being non-generic, leaves `Task<…>` alone; only NON-GENERIC async returns are additionally qualified, and only for the name `Task`).  `Queue` is the second aggregate on purpose — it proves the alias is general, not `Task`-special-cased: aliasing only `Task` left `aggregate Type` failing with the identical triple against `System.Type`.  The row is ALL because the other four backends have no such ambiguity and must stay byte-identical — verified across 84 corpus/example models, where this shape is the only one whose output moves.",
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
    id: "vo-regex-invariant",
    title:
      "a value-object invariant calling `.matches(<regex>)` — the regex is lifted into the WIRE/request validator beside the domain class, so two emitted files' import lists must agree",
    doc: "language",
    backends: WIRE_REGEX_IMPORT,
    note: "Minted by the fixture-shape audit (docs/audits/2026-09-29-fixture-shape-coverage.md): the corpus had NO regex invariant at all (0 of 89), and only four models in the whole repo used `.matches(` anywhere (one elixir-vanilla-build fixture, three `examples/`), so no compile gate on any backend had ever seen a regex leave the DOMAIN emitter.  That is precisely the evaluation's F-013 — `Domain/ValueObjects/UnLocode.cs` emitted `using System.Text.RegularExpressions;` while the FluentValidation request validator called `Regex.IsMatch` with no using, failing `dotnet build` on ordinary modelling.  dotnet is now FIXED (verified with `dotnet build /warnaserror` on sdk:10.0); node is free (inline `/re/.test(...)`, no import to forget); java is correct (`import java.util.regex.Pattern` + a hoisted `Pattern.compile`); elixir is free (`Regex`/`=~` live in Kernel).  PYTHON IS BROKEN and this fixture is how we know: `app/http/wire_models.py` emits `re.search(...)` with no `import re` (`ruff F821 Undefined name 're'`) while the domain half imports it correctly — F-013's defect class exactly, on a second backend, surfaced the moment the shape existed.  python is therefore excluded from `backends:` here via the named `WIRE_REGEX_IMPORT` set above (a reasoned exclusion, not a compile-skip: `gate-ledger.test.ts` refuses a cell that only generates, and asserts every corpus COMPILE_SKIP map stays drained).  The invariant is the plainest possible on purpose: the bug class is a missing import in a second file, so nothing more elaborate reaches it and anything more elaborate blurs which emitter is under test.",
  },
  {
    id: "vo-root-kernel",
    title:
      "a ROOT-LEVEL (ambient / shared-kernel) value object nested inside a CONTEXT-LOCAL one — the third VO lookup pool, and the emission ORDER it forces",
    doc: "language",
    backends: ORDERED_ROOT_VO_EMISSION,
    note: "Minted by the fixture-shape audit (docs/audits/2026-09-29-fixture-shape-coverage.md).  A root-level VO is the documented shared kernel and the third pool a name resolves through (`ctx.valueObjects`, `siblingValueObjects`, then `rootValueObjects` folded in at enrichment).  Only FOUR models in the repo declared one, all under `web/src/examples/`, and all four are MULTI-FILE — while `react-build-cases.ts` is single-file-only by construction, so NO compile gate on any backend or frontend had ever seen a shared kernel, and the corpus had none.  Carries both nesting directions because different code emits them: root VO -> aggregate field (`Shipment.tag`, the direction the examples had) and root VO -> CONTEXT-LOCAL VO field (`Outer.origin`, which nothing had, and which is the ordering-sensitive one).  This is the evaluation's F-007, whose halves have since diverged: react/vue/svelte are FIXED (the frontend api module emits the root VO's schema first), while NODE IS STILL BROKEN — `http/shipment.routes.ts` emits the context-local `OuterSchema` before the root-level `UnLocodeSchema` it initialises from, a temporal-dead-zone read (`TS2448` + `TS2454`).  Same defect the evaluation reported on the frontends, surviving on the backend after the frontend half was fixed, which is why the SHAPE and not the symptom is what a fixture must carry.  PYTHON IS BROKEN THE SAME WAY, in two more files: `app/domain/value_objects.py` and `app/http/wire_models.py` both emit `class Outer` (annotating `origin: UnLocode`) before `class UnLocode`, so ruff reports `F821 Undefined name 'UnLocode'` four times.  ONE emission-order bug, TWO backends — which is the argument for carrying the shape in the shared corpus rather than per-backend.  node and python are therefore excluded from `backends:` here via the named `ORDERED_ROOT_VO_EMISSION` set above (a reasoned exclusion, not a compile-skip — see `gate-ledger.test.ts`); `orderValueObjectsByDependency` (src/ir/util/reachable-types.ts) already exists to fix both, and both keys return with it.  dotnet/java are free (declarations hoist — a record/class has no initialisation order) and elixir is free (a VO is one `:map` cell, no schema const); all three ride as the contrast.",
  },
  {
    id: "vo-cross-context",
    title:
      "a value object referenced ACROSS a context boundary (`Billing.Receipt.shipTo` → `valueobject Addr` in sibling context `Directory`) — the flattening must produce the same leaf columns from the sibling pool as from the local one",
    doc: "language",
    backends: SIBLING_VO_RESOLUTION,
    note: "Minted by the fixture-shape audit (docs/audits/2026-09-29-fixture-shape-coverage.md): NO model in the repo referenced a value object across a context boundary — not one of the 406 models under test/, examples/, web/src/examples/, journey/ and docs/audits/models/ — although `BoundedContextIR.siblingValueObjects` exists precisely to serve it and a type shared between two contexts is the ordinary DDD move.  So every emitter that materialises a referenced VO had two lookup paths (`ctx.valueObjects` for a local declaration, the sibling pool for a foreign one) and only the first was ever exercised.  The evaluation's F-008 is what that cost: the consuming context emitted ONE column under the UNFLATTENED name while the owning context flattened correctly, so migration and ORM disagreed on column name AND type, observable only against a live database.  node/dotnet/java are correct (`ship_to_line1`/`ship_to_geo_lat`/`ship_to_geo_lng` in the drizzle schema + DDL, `OwnsOne` column names, nested `@AttributeOverride`) and ride as the contrast.  PYTHON IS BROKEN and this fixture is how we know: `db/schema.py` and the migration create the three flattened columns while `receipt_repository.py` binds `\"ship_to\": aggregate.ship_to` on insert, `root[\"ship_to\"]` on upsert and reads `ship_to=row.ship_to` on hydrate — a column in NEITHER.  Only the hydrate site type-errors, so `mypy --strict` catches 1 of the 3 sites and a live request fails on all 3.  TWO backends fail it, for ONE root cause — the call site comes from the aggregate's wire shape (which spans contexts) and the definition from the context's own VO list (which does not). python's is the column mismatch above; ELIXIR's is a `** (CompileError) undefined function serialize_addr/1`: `receipt_controller.ex` calls the serializer and defines neither it nor the nested `serialize_geo/1`, while the owning context's `person_controller.ex` defines both. Both are excluded from `backends:` here via the named `SIBLING_VO_RESOLUTION` set above (a reasoned exclusion, not a compile-skip — see `gate-ledger.test.ts`); each key returns when its emitter resolves through the sibling pool. Elixir was first recorded as FREE on the reasoning that a VO is one `:map` cell there — sound reasoning, wrong conclusion, reached by INSPECTING the emitted schema instead of compiling it, and corrected by `mix compile` in CI within minutes.  `Addr.geo: Geo` keeps the NESTING in play, because a cross-context lookup that succeeds at the first level and fails at the second is the likelier bug.",
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
    id: "decimal-exact",
    title:
      "FLOAT-ERROR-VISIBLE `decimal` arithmetic — `0.1 + 0.2`, a chained multiply, a division over binary-inexact operands, a mixed chain, `round(2)` on a binary-inexact tie, a `sum` fold, and an operation writing a computed value to a stored column",
    doc: "language",
    backends: ALL,
    note: "the M-T5.22 / D-DECIMAL-EXACT-MOMENT witness (RS-37).  node and python computed `decimal` in binary floating point while .NET/Java/Elixir computed it exactly, so `0.1 + 0.2` shipped — and PERSISTED — `0.30000000000000004` from two backends and `0.3` from three.  Every literal is binary-INEXACT on purpose (the inverse of `numeric-operands`, whose literals are binary-exact so they agree regardless): each derived value differs between double and exact arithmetic AFTER the RS-24 narrowing to a float64 wire number, so the fixture goes red on node and python with the fix reverted.  The `test` block is the unit-tier proof on all five; the `test e2e` block is the wire + storage proof and carries this fixture's golden",
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
  {
    id: "vo-invariant-in-body",
    title:
      "a value object BUILT by a domain body whose invariant refuses the value — 422 with an RFC 7807 `errors[]` entry; plus the `getById` miss on every load path",
    doc: "payloads",
    backends: ALL,
    note: "M-T5.1 (VO→422 + A4).  Every other VO invariant in the corpus is exercised at the WIRE, where the request schema carries the rule; a value object constructed from a scalar parameter inside an operation reaches the constructor instead.  Before M-T5.1 that answered the domain-floor 422 with no `errors[]` on node/.NET/java/python — and on elixir the in-body construction was not checked at all (`resize(0)` persisted `{\"value\": 0}` and answered 204).  Carries a messaged and a message-less rule, and both body routers (aggregate operation, workflow step).",
  },
  {
    id: "domain-floor-messages",
    title:
      "M-T1.11 (c) — a messaged invariant / precondition tripped at the DOMAIN FLOOR answers 422 with an `errors[]` entry carrying the rule's `msg.<hash>` code",
    doc: "language",
    backends: ALL,
    note: "the domain-floor half of the message ladder: every rule reads aggregate STATE, so no wire validator sees it.  Before item (c) node/.NET/java/python answered `detail` only (no `errors[]`, no code) and elixir answered the wire rung's shape for invariants and the bare floor for preconditions.  One case per pointer shape (state-vs-param precondition \"\", single-field invariant \"/balance\", cross-field invariant \"\") plus the message-less control.",
  },
  {
    id: "datetime-wire",
    title:
      "RS-38 — the `datetime` wire form is milliseconds: three digits when a fraction is present, none on a whole second, sub-millisecond input truncated; an absent joined datetime is `null`",
    doc: "language",
    backends: ALL,
    note: "ledger F2-W-06 / D-ABSENT-JOIN-DATETIME-WIRE.  Every value is asserted as a STRING because the spelling is the contract: node trimmed `.120` to `.12Z`, python printed `.120000Z`, elixir stored the column at SECOND precision and lost the fraction, and the differential tier collapsed all four spellings to one `<timestamp>` token.  The `.9996Z` input separates truncation from rounding (rounding carries into the next second); the soft-deleted join target is RS-34's value-typed arm.",
  },
] as const;

/** Lookup by id. */
export function corpusFeature(id: string): CorpusFeature | undefined {
  return CORPUS.find((f) => f.id === id);
}
