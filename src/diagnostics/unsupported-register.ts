// ---------------------------------------------------------------------------
// The `*-unsupported` register (M-T9.27).
//
// Every diagnostic code in `src/` carrying an `-unsupported` / `-backend`
// suffix is WORK — either now (`gap`) or later (`scope`).  That invariant is
// the point of this file.
//
//   gap    — a target hasn't implemented it yet.  A TODO.  DRAINS TO ZERO.
//   seam   — the gate's membership set already names EVERY shipping target
//            (or is empty), so it can fire only for a target that does not
//            exist yet, or for a deployable that hosts no backend at all.  Not
//            work on any shipping target; kept as the seam the NEXT
//            backend/frontend gates on until it ports (Wave C2's coordinator
//            commit, 2026-09-13 — see LATENT ROWS below).
//   scope  — a declared v1 limit with a named successor.  Owned by a mission;
//            becomes a `gap` when that mission starts, or is renamed out (as
//            below) if the limit is re-justified as permanent.
//
// WHAT DOES NOT BELONG HERE.  The suffix reads like one family — "this target
// can't do this yet" — which is exactly how a permanent-shaped artifact (a
// stable `loom.*` identity, documented beside real rules, matched in tests like
// real rules) comes to stand in for a temporary condition.  A code that is NOT
// work does not carry the suffix and does not get a row:
//
//   * semantically impossible or deliberately refused — `-invalid`
//     (`projection-groupby-join`: a join is a by-id load AFTER the query, so it
//     cannot compose with `group by`; `policy-write-global`, a documented
//     deliberate never);
//   * parses and does nothing — `-no-effect`;
//   * not in a closed vocabulary, or a plain misuse error — `-unknown`
//     (`auth-ui-on-backend` is a misuse error; `ui-handler-unsupported` a closed
//     statement vocabulary).
//
// Leaving those here would stall any drain sprint on rows nothing can close.
//
// The lasting lesson: NO NAMING CONVENTION separates these.  The classification
// is a reviewed field, not something derivable from the code name — which is
// why `kind` is written down per row.
//
// `verified` marks rows whose classification a human has confirmed against the
// emission site.  Rows land `false` and are promoted on review.
//
// LATENT ROWS — the `seam` kind.  Many gates' Sets (EVENT_SOURCING_BACKENDS,
// PROJECTION_*_SUPPORTED, SUPPORTED_UNION_BACKENDS, FIELD_MASK_BACKENDS,
// CHART_FRAMEWORKS, PROJECTION_READ_FRAMEWORKS, …) name every shipping target,
// so the gate fires for nothing that exists — or only for a context no backend
// deployable hosts at all.  Those gates are deliberately KEPT: they are the
// seam the NEXT backend/frontend gates on until it ports, the pattern
// CHART_FRAMEWORKS documents at system-checks.ts.  Their rows stay too,
// because the code IS still emitted in `src/` and that invariant demands a
// row — but they are `kind: "seam"`, not `gap`, so `openGaps()` (and the
// `MAX_OPEN_GAPS` pin) counts only rows a SHIPPING target has left undone.
// Until Wave C2 they sat under `gap` with "latent seam" / "dormant" /
// "unreachable backstop" in their `what` (24 of 51 rows); the plan's exit
// criterion is `MAX_OPEN_GAPS` = 0 LIVE rows, which the prose marker could
// not express.  A seam row drains only when the gate itself is deleted (a
// decision about the seam) or when a new target ports and the row becomes a
// live `gap` for it; `latentSeams()` lists them, pinned exactly in the test.
//
// GATED BY `test/system/unsupported-register.test.ts`: every suffixed code in
// `src/` must appear here and every row must still be emitted, so a new gap
// cannot be minted silently and a drained one cannot linger.  When a `gap`
// closes, DELETE ITS ROW in the same PR.
// ---------------------------------------------------------------------------

/** How a `*-unsupported` code relates to work — now or later.  See the header.
 *  A code that is NEITHER (impossible, refused, or a plain rule) does not
 *  belong in the suffix at all — rename it, per the header. */
export type UnsupportedKind = "gap" | "seam" | "scope";

export interface UnsupportedEntry {
  /** The `loom.*` diagnostic code. */
  code: string;
  kind: UnsupportedKind;
  /** `file:line` of the first emission site, for the reviewer. */
  site: string;
  /** One line: what the code refuses. */
  what: string;
  /** Owning mission, where one exists.  A `gap` without one is unowned work. */
  mission?: string;
  /** Classification confirmed against the emission site by a human. */
  verified?: boolean;
}

export const UNSUPPORTED_REGISTER: readonly UnsupportedEntry[] = [
  // -------------------------------------------------------------------------
  // gap — real parity TODOs.  This is the sprint backlog.  Drains to zero.
  // -------------------------------------------------------------------------
  {
    code: "loom.workflow-handle-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/workflow-checks.ts:388",
    what:
      "`handle name(…) { … }`, the multi-command saga continuation, is emitted by NO backend — " +
      "not a route, not a handler, not a method.  It was silent before M-T5.34 (audit #2864 D5): " +
      "a saga could be started and read and never advanced.  A genuine five-backend gap, not a " +
      "latent seam — the emitter is the deferred half of decision D-1(c)",
    mission: "M-T6.58",
    verified: true,
  },
  {
    code: "loom.audited-backend-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:537",
    what:
      "audit-record emission (`operation … audited`, `audited create|destroy`) ships on all five " +
      "backends (AUDIT_OP_BACKENDS / AUDIT_LIFECYCLE_BACKENDS) — fires only when NO backend " +
      "deployable hosts the context",
    mission: "M-T6.32",
  },
  {
    code: "loom.auth-ui-unsupported-framework",
    kind: "seam",
    site: "src/ir/validate/checks/ui-framework-checks.ts:425",
    what: "`auth: ui` ships on every frontend; the seam a NEW one gates on",
    mission: "M-T1.20",
  },
  {
    code: "loom.chart-unsupported-target",
    kind: "seam",
    site: "src/ir/validate/checks/ui-framework-checks.ts:311",
    what:
      "`Chart` renders on every shipping frontend (CHART_FRAMEWORKS names all seven) — latent " +
      "seam a NEW framework gates on until it ports",
    mission: "M-T1.3",
  },
  {
    code: "loom.context-test-unsupported",
    kind: "seam",
    site: "src/language/validators/test-placement.ts:104",
    what:
      "context-level `test` whose target context no INTEGRATION_BACKENDS deployable hosts — all " +
      "five backends render context integration tests, so only a frontend-only host warns",
    mission: "M-T5.19",
  },
  {
    code: "loom.dapper-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/orm-adapter-checks.ts:51",
    what:
      "the .NET Dapper residue after full EF parity: an AGGREGATING query-time projection over a " +
      "document/event-sourced source, and the two self-provisioning limits — declared migration " +
      "steps (`#migrations`, owned by M-T2.17 per D-DAPPER-ALTER: it closes when the " +
      "`test:migration-evolution-dapper` leg is green, NOT when the gate widens) and Postgres " +
      "schema placement (`#schema-split` / `#schema-ignored`, the twin limit of the same " +
      "boot-time schema owner — also M-T2.17) (migration-checks.ts, " +
      "`validateMigrationAdapterSupport` / `validateSelfProvisioningSchemaSupport`).  The " +
      "hierarchical (deep/global) tenancy `#deep-scope` clause DRAINED in wave C2 packet 2b: " +
      "`authzFilterToSql` renders the descendant-or-self fragment as raw Postgres and " +
      "`collectFilterPrincipalRefs` (now on `walkExprDeep`) binds its four params, proven on a " +
      "booted Dapper backend by `test/e2e/tenancy-hierarchy-dapper.test.ts`",
    mission: "M-T6.35",
  },
  {
    code: "loom.component-children-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/ui-framework-checks.ts:695",
    what:
      "an EXTERN user component invoked WITH CHILDREN on angular.  The WALKED half DRAINED in " +
      "wave C2 packet 2h: Loom emits that class and stamps its selector, so its call site is " +
      "`<app-x [p]='…'>children</app-x>` with the class in the page's standalone `imports: []`, " +
      "and the children land in the body's `Slot { }` (`<ng-content>`).  What is left is the " +
      "`extern` flavour, and it is a LANGUAGE limit rather than an Angular TODO: an extern " +
      "component is a hand-written Angular class whose `@Component({ selector })` is the " +
      "author's, so Loom cannot spell a tag for it and must invoke it through `<ng-container " +
      "[ngComponentOutlet]=…>`, which has no content-projection channel (`ngComponentOutletContent` " +
      "takes pre-built DOM nodes, TS-side only).  Addressing it by tag needs a SURFACE — a " +
      "selector clause on `extern from` — which is D-ANGULAR-EXTERN-CHILDREN's successor, " +
      "M-T1.33.  Raised as a WARNING, not an error: #2734 made the same drop visible at the call " +
      "site with a degradation comment in the emitted Angular, so the comment documents the loss " +
      "in the output while this diagnostic tells the author at compile time — and neither half " +
      "refuses a model that has always generated.",
    mission: "M-T1.33",
    verified: true,
  },
  {
    code: "loom.page-form-locals-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-framework-checks.ts:730",
    what:
      "two forms on ONE page whose generated page-local bindings collide.  Every JS frontend " +
      "splices a form's mutation hook + form handle in as page-scope consts named by the design " +
      "pack's `form-of-decls`/`form-op-decls` templates, and react/svelte/vue name them BARE " +
      "(`create`, `form`, `register`, `handleSubmit`), so a second form redeclares them — react " +
      "and svelte fail the generated build (TS2300), vue DEDUPES and silently submits the first " +
      "form's mutation with the first form's schema.  ANGULAR IS NOT COVERED — it emits the " +
      "shape correctly: its locals are aggregate-scoped, and #2734 gave a second same-aggregate " +
      "form an ordinal suffix (`itemCreate2`, `onSubmitItem2`), so every declaration appears " +
      "exactly once.  Drained by threading that same per-FORM ordinal through the ~68 " +
      "react/vue/svelte pack templates that hardcode those names; that PR deletes this gate, " +
      "this row, and lowers the pin.",
    mission: "M-T1.1",
  },
  {
    code: "loom.datagrid-unsupported-target",
    kind: "seam",
    site: "src/ir/validate/checks/ui-framework-checks.ts:63",
    what:
      "`DataGrid` (a TanStack row model) outside DATA_GRID_FRAMEWORKS.  LATENT seam for a NEW " +
      "frontend: both non-members are settled nevers under D-DATAGRID-TARGETS' one rule (ships " +
      "iff it can run TanStack itself) — flutter because its native build has no JS runtime, " +
      "phoenixLiveView because both roads open to it (a hand-rolled Elixir row model, or a " +
      "phx-hook island LiveView must not patch) FORK the semantics the renderDataGridChild seam " +
      "shares.  It was carried as 'the open leg' until the pin was re-examined; the blocker that " +
      "framing rested on (multi-column ORDER BY in `list/4`) was never on DataGrid's path — it " +
      "drives no server read on any target",
    mission: "M-T1.1",
    verified: true,
  },
  {
    code: "loom.heex-component-host-state-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-framework-checks.ts:105",
    what:
      "a form / QueryView / Table / FileUpload / Chart inside a `component` on phoenixLiveView — " +
      "#2646 lifted a component's `state` and `action`s into the host LiveView but not the " +
      "walker's form / query / upload / table-control accumulators, so the markup emitted " +
      "against an assign the host never makes (compiles clean, then raises at render time)",
    mission: "M-T1.27",
    verified: true,
  },
  {
    code: "loom.event-sourced-workflow-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:233",
    what:
      "`workflow … eventSourced` runtime ships on all five backends " +
      "(EVENT_SOURCING_WORKFLOW_BACKENDS) — latent seam for a NEW backend",
    mission: "M-T6.34",
  },
  {
    code: "loom.event-sourcing-backend-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:191",
    what:
      "`persistedAs: eventLog` storage ships on all five backends (EVENT_SOURCING_BACKENDS) — " +
      "fires only when no backend deployable hosts the context",
    mission: "M-T6.34",
  },
  {
    code: "loom.elixir-if-stmt-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/if-stmt-checks.ts:265",
    what:
      "FOUR narrow sub-shapes of the `if` STATEMENT in a domain body an elixir deployable emits.  " +
      "The statement ITSELF now renders (M-T6.59, wave C2 2a): `vanilla/if-stmt-emit.ts` makes it " +
      "value-producing (`record = if … do … record else record end`) and `opBodyStmtsDeep` makes " +
      "every persist/containment probe deep-walk the branches, so a branch assignment survives " +
      "`Repo.update` (boot-proved on real Postgres).  What is left: `#return-in-branch` (an EARLY " +
      "EXIT — the linear body renderers would have to restructure the statements FOLLOWING the " +
      "`if` into a `case` arm, a list-level transform that also breaks the same-length " +
      "`statementSubRegions` sourcemap zip; allowed already in a TAIL-VALUE body, where every " +
      "`return` is already tail-position), `#guard-in-branch` (the op path hoists top-level " +
      "`requires`/`precondition` into a `with :ok <- ensure(…)` chain answering 403/422; a nested " +
      "one would raise → 500, a wire divergence worse than the refusal), and `#event-sourced` (an " +
      "ES command body is sorted into `with`-clauses / `let`s / one `events = […]` list, not " +
      "rendered as a statement sequence, so a conditional `emit` has nowhere to go), and " +
      "`#branch-statement` (the CLOSED branch vocabulary — an `emit`, an effect-form `match` or a " +
      "PROVENANCED write in a branch: each RENDERS, but the emitters decide an operation's " +
      "supporting machinery by scanning its TOP-LEVEL statements, so a conditional `emit` gets no " +
      "`require Logger` and cannot be hoisted past the commit by the S5a restructure, and a nested " +
      "provenanced write captures lineage in an op the route layer never put in flush mode)",
    mission: "M-T6.59",
    verified: true,
  },
  {
    // The TARGET-AGNOSTIC half, promoted out of the Feliz row below in wave C2
    // packet 2i (audit F66).  Every frontend resolves a `match await` subject to
    // an aggregate instance op and renders nothing else — the four JS walkers
    // emitted `await Promise.reject(…)` from a clean `.ddd`, LiveView threw at
    // codegen, and only Feliz / Flutter said so, behind a platform check.
    code: "loom.async-effect-subject-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/store-checks.ts:527",
    what:
      "`match await <subject>` whose subject is not an aggregate INSTANCE operation — a " +
      "workflow, a collection read or a plain state field.  Awaiting a WORKFLOW is the real " +
      "work behind this row (a different route shape, `POST /workflows/<wf>`, and its own " +
      "result projection on each of the seven frontend emitters); the other subjects are " +
      "nonsense the statement form could not otherwise refuse, because a " +
      "`StmtIR.variant-match`'s `subjectType` comes from `inferExprType` (catch-all `string`) " +
      "and so cannot reach `loom.match-non-union-subject`",
    mission: "M-T1.20",
  },
  {
    code: "loom.feliz-async-effect-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/store-checks.ts:462",
    what:
      "`match await` on Feliz in a COMPONENT host — the Feliz generator projects async effects " +
      "only on pages (the trigger id comes from the host page's route `:id`), so a component " +
      "action's effect would be silently dropped.  The SUBJECT half moved to the " +
      "target-agnostic `loom.async-effect-subject-unsupported` (F66)",
    mission: "M-T1.20",
  },
  {
    code: "loom.field-mask-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:426",
    what:
      "`mask unless` read redaction ships on all five backends (FIELD_MASK_BACKENDS) — fires " +
      "only when no backend deployable hosts the context",
    mission: "M-T3.2",
  },
  {
    code: "loom.filter-bypass-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/context-filter-checks.ts:268",
    what:
      "`ignoring` is honored by every backend family (FILTER_BYPASS_FAMILIES) — latent: it can " +
      "only fire for a backend deployable with no DB read path, which carries no `ignoring`",
    mission: "M-T6.32",
  },
  {
    code: "loom.find-predicate-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/orm-adapter-checks.ts:284",
    what:
      "NO NAMED SHAPE is left on any adapter.  EF Core + Drizzle were always the full-subset " +
      "baseline; `DAPPER_SUBSET = FULL_SUBSET` (wave C2 packet 2b); and mikroorm's last " +
      "narrowing — a reference-collection membership whose ARGUMENT is a column rather than a " +
      "bindable value — was never adapter-specific: the join-table subquery binds its target as " +
      "a parameter on EVERY adapter, so packet 2f moved the refusal to a target-neutral rule in " +
      "`firstNonQueryableNode` and deleted the descriptor arm (which is also what stopped the " +
      "identical shape CRASHING drizzle codegen: the adapter gate keys on `dep.persistence`, " +
      "which a DEFAULT-adapter deployable does not carry).  The row is KEPT rather than drained " +
      "because the descriptors still carry fall-through arms and nobody has PROVED them " +
      "unreachable — a spot probe (arithmetic in a predicate position) was preempted by " +
      "`loom.find-where-not-queryable` upstream, which is suggestive, not a proof over the whole " +
      "queryable subset.  Drain condition for M-T6.35: show the descriptors cannot fire, or " +
      "delete them",
    mission: "M-T6.35",
  },
  {
    code: "loom.flutter-async-effect-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/store-checks.ts:590",
    what:
      "`match await` in a COMPONENT action.  RE-CLASSED `gap` -> `scope` under " +
      "**D-FLUTTER-COMPONENT-BINDINGS**: `match await <api>.<Agg>.<op>()` on an INSTANCE " +
      "operation posts to `/<coll>/$id/<op>`, so it needs the ROUTE `id` — and a component " +
      "has no route by construction.  The only candidate binding (a component param spelled " +
      "`id` inherits its caller's route arg) makes `id` a magic parameter NAME whose meaning " +
      "depends on where the caller happens to sit, so the decision refuses it.  Measured on " +
      "this tree by bypassing the filter: the component path has no `variant-match` arm at " +
      "all and reaches `renderNotifierStmt`'s internal floor THROW (the page path intercepts " +
      "the kind one level up), so this row guards a codegen crash rather than a degradation.  " +
      "M-T1.34 closes the `ref`-backed half of the same family (a component holding a " +
      "Riverpod `WidgetRef` — stores, `currentUser`, reads) and re-narrows this gate's " +
      "message to name the `id` as the only remaining cause",
    mission: "M-T1.34",
  },
  {
    code: "loom.flutter-primitive-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/ui-framework-checks.ts:638",
    what:
      "every page primitive now renders on Flutter — FLUTTER_UNRENDERED_PRIMITIVES " +
      "(src/util/flutter-deferred-primitives.ts) is EMPTY, so the gate is a dormant re-arm net",
    mission: "M-T1.20",
  },
  {
    code: "loom.flutter-action-body-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-framework-checks.ts:822",
    what:
      "two Flutter action-body shapes every other frontend renders: a `toast(…)` view " +
      "effect (a Riverpod Notifier holds no BuildContext, so it reaches no ScaffoldMessenger; " +
      "`navigate(…)` reaches the router through the generated lib/nav.dart bridge since " +
      "Wave C1 packet 1e-ii) and a `match await` on one of the five " +
      "STANDARD aggregate ops (the async-effect emitter resolves its op through " +
      "`agg.operations`, which holds only DECLARED ones). Both emitted a " +
      "`// TODO(flutter full-parity)` comment into the Dart before Wave C1 1d-ii — the " +
      "action was wired and silently did nothing",
    mission: "M-T1.32",
  },
  {
    code: "loom.frontend-prop-type-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-framework-checks.ts:160",
    what:
      "a declared `component` param / `extern` function signature type the shared TypeScript " +
      "prop layer has no spelling for — `money`, `File` and a `valueobject`, each of which " +
      "HAS a wire shape (a decimal string re-parsed to Decimal, a fixed FileRef object, a " +
      "VO DTO) and is therefore portable work rather than an impossibility. Before Wave C1 " +
      "1d-ii these were the `default: throw` arms in `_frontend/component-prop-type.ts` / " +
      "`extern-functions.ts`: a raw stack trace on `.ddd` that validated clean",
    mission: "M-T1.20",
  },
  {
    code: "loom.frontend-collection-op-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-collection-display-checks.ts:575",
    what:
      "EIGHT of the seventeen stdlib collection ops over a collection receiver in a " +
      "walker-rendered page/component/store expression. The nine that RESHAPE a collection " +
      "(count / where / any / all / map / sortBy / take / skip / join) render on all six " +
      "frontends AND on the HEEx parallel walker. The eight refused are the ones the " +
      "frontends genuinely disagree about, all on REPRESENTATION: `sum`/`min`/`max`/`avg` " +
      "fold arithmetic and money is a decimal.js/Elixir `Decimal` object on JS+HEEx but a " +
      "native scalar on feliz/flutter; `first`/`firstOrNull` differ on partiality and on the " +
      "optional type (`undefined` vs a raising `List.head`; `T | null` vs `'T option`); " +
      "`distinct`/`contains` need value equality, which flutter's wire models have no " +
      "`operator ==` for. Target-agnostic — no per-framework carve-out remains",
    mission: "M-T1.20",
  },
  {
    code: "loom.generic-carrier-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/structural-checks.ts:344",
    what:
      "`paged`/`envelope` generic carriers ship on all five backends " +
      "(SUPPORTED_PAGED_BACKENDS) — latent seam for a NEW backend",
    mission: "M-T5.3",
  },
  {
    code: "loom.if-stmt-page-body-unsupported",
    kind: "scope",
    // Owner: **D-PAGE-BODY-EXPRESSION** ruled the limit permanent in substance —
    // a page body is an expression tree on all six frontends and the ternary /
    // value-`match` spellings already render everywhere — and pointed the row at
    // M-T1.20, which already IS the register of frontend refusals accepted in
    // `.ddd`.  Unlike its neighbours there, this one is not per-target: all six
    // refuse it, which is what makes it a surface decision rather than a port.
    site: "src/ir/validate/checks/if-stmt-checks.ts:333",
    what:
      "the `if` STATEMENT in a `ui` page / component / store body, on EVERY frontend.  A page body " +
      "is an expression tree — a condition is a VALUE there (`cond ? a : b`, `match`) — and no " +
      "frontend emitter (JS walker / Feliz update / Flutter notifier / HEEx handler) has a " +
      "statement-position conditional.  A declared limit of the page surface, not a per-target gap: " +
      "it would be lifted by a decision to give page bodies statement-form control flow " +
      "(**D-PAGE-BODY-EXPRESSION** declined to)",
    mission: "M-T1.20",
    verified: true,
  },
  {
    code: "loom.mikroorm-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/migration-checks.ts:257",
    what:
      "on MikroORM: the two self-provisioning limits — declared migration steps and Postgres " +
      "schema placement (migration-checks.ts, `#migrations` / `#schema-split` / " +
      "`#schema-ignored`) — this adapter's boot-time `orm.schema.updateSchema()` schema owner " +
      "does not express today.  BOTH are OWNER-RULED as builds, not as permanent limits: " +
      "`#migrations` by D-DAPPER-ALTER (its mikroorm twin is ruled the same way there) — " +
      "render the MigrationsIR chain behind a `__loom_migrations` ledger and flip " +
      "`!usingMikro` at `src/platform/hono/v4/emit.ts`, a named T2 mission, with the widened " +
      "refusal landing first as the interim), and `#schema-*` by measurement (C2 packet 2c): " +
      "a MikroORM `EntitySchema` takes a `schema:` key and `updateSchema` provisions it, so " +
      "the gap is that `renderMikroEntities` is never handed the per-aggregate " +
      "`resolveDataSourceConfig` the drizzle `renderSchema` already receives at the same call " +
      "site (`emit.ts:705`).  Two prior residents drained: the root SCALAR/ENUM " +
      "scalar-array shape (`#scalar-array` — `columnsForType` grew a native-Postgres-array " +
      "column arm mirroring drizzle's; `validateMikroOrmSupport` and the reject itself are " +
      "gone) and the abstract-inheritance-base-with-`contains` shape (promoted to the " +
      "target-neutral `loom.abstract-aggregate-contains`, impossible on every backend, not " +
      "adapter-specific).  All five ONCE-gated non-persistence features (query-time " +
      "projections, SSE, outbox, timers, brokers) closed",
    mission: "M-T6.23",
  },
  {
    code: "loom.operation-return-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/structural-checks.ts:628",
    what:
      "`or`-union operation returns ship on all five backends (SUPPORTED_RETURN_BACKENDS) — " +
      "latent seam for a NEW backend",
    mission: "M-T5.1",
  },
  {
    code: "loom.paged-query-handler-unsupported-backend",
    kind: "seam",
    site: "src/ir/validate/checks/projection-backend-checks.ts:247",
    what:
      "a `paged` queryHandler return ships on all five backends (PAGED_QH_SUPPORTED) — latent " +
      "seam for a NEW backend",
    mission: "M-T2.6",
  },
  {
    code: "loom.polymorphic-id-ref-unsupported",
    kind: "gap",
    site: "src/language/validators/inheritance.ts:275",
    what:
      "a `<Base> id` reference to a TPC (`ownTable`) abstract base — no single table to key the " +
      "FK against; an all-shared TPH base IS allowed (mixed strategy has its own code)",
    mission: "M-T5.7",
  },
  {
    code: "loom.projection-groupby-unsupported-backend",
    kind: "seam",
    site: "src/ir/validate/checks/projection-backend-checks.ts:108",
    what:
      "`group by` grouped read models ship on all five backends (PROJECTION_GROUPBY_SUPPORTED) " +
      "— latent seam for a NEW backend",
    mission: "M-T4.2",
  },
  {
    code: "loom.projection-query-time-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/projection-backend-checks.ts:274",
    what:
      "query-time projections ship on all five backends (PROJECTION_QT_SUPPORTED) — latent seam " +
      "for a NEW backend",
    mission: "M-T4.2",
  },
  {
    code: "loom.projection-source-unsupported-backend",
    kind: "seam",
    site: "src/ir/validate/checks/projection-backend-checks.ts:360",
    what:
      "a projection sourced from another projection's rows ships on all five backends " +
      "(PROJECTION_PROJ_SOURCE_SUPPORTED) — latent seam for a NEW backend",
    mission: "M-T4.2",
  },
  {
    code: "loom.projection-whole-table-aggregation-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/projection-backend-checks.ts:72",
    what:
      "whole-table `select f = agg(…)` SQL push-down ships on all five backends " +
      "(PROJECTION_AGG_SUPPORTED) — latent seam for a NEW backend",
    mission: "M-T4.2",
  },
  {
    code: "loom.projection-workflow-source-unsupported-backend",
    kind: "seam",
    site: "src/ir/validate/checks/projection-backend-checks.ts:317",
    what:
      "a projection sourced from a workflow's instance rows ships on all five backends " +
      "(PROJECTION_WF_SOURCE_SUPPORTED) — latent seam for a NEW backend",
    mission: "M-T4.2",
  },
  {
    code: "loom.provenanced-backend-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:267",
    what:
      "the provenance runtime (lineage column + history flush) ships on all five backends " +
      "(PROVENANCE_BACKENDS) — fires only when no backend deployable hosts the context",
    mission: "M-T6.32",
  },
  {
    code: "loom.remote-api-op-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/resource-capability-checks.ts:118",
    what:
      "every backend emits the typed in-system api client — REMOTE_API_OP_UNSUPPORTED is an " +
      "EMPTY set, kept as the honest-gap net for a sixth backend added before its client",
    mission: "M-T4.8",
  },
  {
    code: "loom.saving-shape-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/datasource-checks.ts:214",
    what:
      "re-classified from a live latent seam to a dormant one: every platform key already in " +
      "PLATFORM_SAVING_SHAPES (dotnet/node/python/java, plus elixir widened to `document` in " +
      "this check) lists all three SavingShape values, so `supported.includes(shape)` cannot " +
      "fail for any of them — and a platform NOT yet in the map is SKIPPED " +
      "(`if (!base) continue`), not flagged, so this isn't even the seam a brand-new backend " +
      "gates on the way CHART_FRAMEWORKS-shaped rows are.  An unreachable backstop for the day " +
      "a platform is registered with a genuinely partial shape list",
    mission: "M-T6.35",
  },
  {
    code: "loom.scaffold-filter-param-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-page-structure-checks.ts:305",
    what:
      "a scaffolded list page's filter bar drops a repository `find` whose param it cannot " +
      "render an input for.  M-T1.15 landed `string`/`guid`/`datetime`/`int`/`long`/`bool`/`<X> id`; " +
      "`enum` waits on the " +
      "frontend state emitters (an enum `state {}` field is typed as bare `string` while the " +
      "query param is the zod enum union) and `decimal`/`money` on a per-target zero-literal " +
      "seam (Feliz types the bar's `0` sentinel as `decimal <> int`)",
    mission: "M-T1.15",
  },
  {
    code: "loom.store-lifetime-target-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/store-checks.ts:364",
    what:
      "a persisted store field with no total F# (feliz) or Dart (flutter) codec.  BOTH halves " +
      "narrowed in wave C2 (feliz in packet 2i, flutter in packet 2j) to exactly the cells that " +
      "would need a RECORD codec the store path does not emit — `File`, `valueobject`, `entity` " +
      "and arrays of them.  Feliz: `datetime`/`guid` grew `System.DateTime.TryParse`/`System.Guid.TryParse` " +
      "arms, an enum rides F# as `string`, list elements cover every scalar.  Flutter: a nullable " +
      "scalar and a `json` cell now persist; a nullable cell is still refused at the `url` tier for " +
      "a measured reason (no null-distinguishing `copyWith` sentinel in the shared state class).  " +
      "The two codec tables' remaining divergences are pinned by test/ir/util/persist-codec-divergence.test.ts",
    mission: "M-T1.20",
  },
  {
    code: "loom.table-filter-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-collection-display-checks.ts:326",
    what:
      "`Table { filter: <state> }` on a framework with no filter seam.  The six `walkBody` " +
      "targets all declare `renderFilteredRows` + `renderFilterInput`; phoenixLiveView runs the " +
      "parallel HEEx engine, whose `renderTable` `else if` chain handles rows/testid/sort/page " +
      "and lets `filter:` fall through into nothing.  Drains when the generated `list/4` takes a " +
      "filter param and the LiveView grows the matching `handle_event` + `<.input>`",
    mission: "M-T1.1",
  },
  {
    code: "loom.modal-controlled-op-form-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-collection-display-checks.ts:400",
    what:
      "`Modal { open: <stateBool>, OperationForm { … } }` on react / vue / svelte / flutter, " +
      "where `emitModal` only reaches the state-controlled path when there is NO form child and " +
      "otherwise degrades the WHOLE modal to a comment.  Angular and Feliz fork the primitive " +
      "and render the form, and HEEx's `renderModal` handles it, so this is a per-target gap, " +
      "not a rejected shape.  Drains when the four render the controlled shell around the " +
      "recorded OperationFormState",
    mission: "M-T1.6",
  },
  {
    code: "loom.toast-message-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-action-body-checks.ts:858",
    what:
      "an `on <chan>.<Event> { toast(<expr>) }` message outside the subset all FOUR realtime " +
      "renderers implement.  NARROWED 2026-09-02: a member access CHAIN of any depth off the " +
      "event binding (`e.order.id`) now renders on all four, so what remains refused is a " +
      "conversion (`string(e.at)`), a method call (`e.name.toUpper()`), a ternary, and a chain " +
      "rooted at anything but the binding (`currentUser.email`).  Not latent and not " +
      "per-target: the four `switch`es are arm-for-arm identical (`_frontend/realtime.ts`, " +
      "`feliz/realtime.ts`, `elixir/realtime-liveview.ts`, `flutter/realtime.ts`) and each " +
      "still THROWS on the remainder, so the gate replaces a codegen abort.  Drains when the " +
      "renderers grow the general expression path (they would then share the walker's " +
      "expression emitter rather than four hand-written subsets)",
    mission: "M-T1.10",
  },
  {
    code: "loom.tph-backend-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:98",
    what:
      "sharedTable (TPH) storage ships on all five backends (TPH_CAPABLE) — fires only when no " +
      "backend deployable hosts the context",
    mission: "M-T5.7",
  },
  {
    code: "loom.tph-filter-unsupported",
    // `gap` -> `scope` (D-TPH-SUBTYPE-FILTER, wave C2 packet 2b).  Not
    // half-built work on a shipping target: the refusal is true and narrow (the
    // EF adapter only — Dapper generates the identical model), and the drain is
    // a read-path rewrite whose failure mode is a silent leak of a declared read
    // restriction across ~30 emitter sites with no compiler help.  Commissioned
    // as M-T6.72 with a booted-app acceptance instead of swept up in a drain.
    kind: "scope",
    site: "src/ir/validate/checks/storage-inheritance-checks.ts:148",
    what:
      "a TPH SUBTYPE's capability `filter` reading a column the hierarchy ROOT does not declare, " +
      "on the .NET EF adapter only — Dapper splices the same predicate into raw SQL, where a " +
      "subtype column is just a column, so it is NOT gated.  EF Core registers every query " +
      "filter in an inheritance hierarchy on the " +
      "root entity type, and a root-hosted filter cannot reach a subtype-only column (verified " +
      'against EF Core 10.0.10: a CLR downcast raises "No coercion operator is defined between ' +
      "types 'Truck' and 'Car'\" and EF.Property raises \"the specified property does not exist " +
      'on the entity type" as soon as the query source is a SIBLING subtype).  Filters reading ' +
      "ROOT columns — the common `tenantOwned`-on-the-base case — are emitted, discriminator-" +
      "guarded, and are NOT gated.  Replaces a silent drop (`tph ? [] :`, F2-CB-C2).  Drains if " +
      "the .NET read path moves capability filters off HasQueryFilter onto the per-read LINQ " +
      "`.Where(...)`, which is per-DbSet and therefore subtype-typed",
    mission: "M-T6.72",
  },
  {
    code: "loom.ui-projection-read-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/ui-framework-checks.ts:379",
    what:
      "a KEYED or FOLDED projection read from a page/component — not ui-consumable on ANY target " +
      "(ui-checks.ts:1538).  The per-framework half is fully ported: PROJECTION_READ_FRAMEWORKS " +
      "names all seven frontends, so that arm is latent",
    mission: "M-T1.3",
  },
  {
    code: "loom.ui-realtime-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/ui-framework-checks.ts:577",
    what:
      "an `on <channel>.<Event>` handler on a ui whose FRAMEWORK has no realtime consumption — " +
      "latent: `SSE_REALTIME_FRONTENDS` names react/vue/svelte/angular/feliz/flutter/static and " +
      "`NATIVE_REALTIME_FRONTENDS` the two Phoenix spellings, i.e. every shipping frontend, so " +
      "this fires only for a frontend that does not exist yet.  Its former second arm " +
      "(`#backend-serves-no-sse`) was deleted in wave C2 packet 2f as unreachable: every " +
      "shipping backend serves realtime, and the two ways to reach a non-serving target are " +
      "already phase-④ errors in `validators/deployable.ts` (no `targets:`, or a frontend target)",
    mission: "M-T1.20",
    verified: true,
  },
  {
    code: "loom.union-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/structural-checks.ts:517",
    what:
      "discriminated-union tagged wire ships on all five backends (SUPPORTED_UNION_BACKENDS) — " +
      "latent seam for a NEW backend",
    mission: "M-T5.3",
  },
  {
    code: "loom.vanilla-document-unsupported",
    kind: "gap",
    site: "src/ir/validate/checks/datasource-checks.ts:552",
    what:
      "elixir `shape: document`, the residue after CRUD + scalar finds/ops landed: a PROVENANCED " +
      "op, or a body/find predicate reading a dereferenced cross-aggregate entity, a " +
      "value-object/private/service/resource call, or a REFERENCE collection (`X id[]`).  The " +
      "DERIVED-read clause drained in wave C2 packet 2a: a `this-derived` read has no stored " +
      "`data` key, which is what the refusal reasoned from, but `render-expr.ts` INLINES the " +
      "derived's defining expression (an Elixir struct carries no computed field either — #1765), " +
      "so the read is emittable exactly when the referenced derived's OWN expression is — the gate " +
      "now recurses into it (cycle-guarded) instead of refusing outright",
    mission: "M-T6.35",
  },
  {
    code: "loom.when-unsupported",
    kind: "seam",
    site: "src/ir/validate/checks/structural-checks.ts:587",
    what:
      "the `when` canCommand gate ships on all five backends (SUPPORTED_WHEN_BACKENDS) — latent " +
      "seam for a NEW backend, as the check's own docstring says",
    mission: "M-T5.8",
  },

  // -------------------------------------------------------------------------
  // scope — a declared v1 limit with a named successor.  Mission-owned; not
  // sprint work until its mission starts.
  // -------------------------------------------------------------------------
  {
    code: "loom.entity-part-param-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/entity-part-param-checks.ts:73",
    what:
      "an entity-PART-typed parameter on a public action.  A declared limit, not a per-target " +
      "gap: materializing one means ruling on whether client-supplied parts REPLACE the " +
      "collection (new ids, history orphaned) or MERGE by id, which the DSL has never answered.  " +
      "Decision D-2 of the freight-audit fleet plan refuses it and defers that question to a " +
      "proposal; the value-object spelling is emitted correctly today and is what the message " +
      "points at.  Lifted by the proposal, or re-justified as permanent and renamed to -invalid",
    verified: true,
  },
  {
    code: "loom.criterion-unsupported-target",
    kind: "scope",
    site: "src/language/validators/criterion.ts:87",
    what: "criteria over primitives/VOs/enums reserved for `from <Criterion>(args)`",
    mission: "M-T5.4",
    verified: true,
  },
  {
    // NOTE ON THE SIBLING CODE.  The OTHER half of this refusal —
    // `toThrow(<kind>)` in a `test e2e` body — is `loom.e2e-throw-kind-INVALID`
    // and deliberately has no row.  Over HTTP both rungs are a 422 whose only
    // discriminator is the RFC 7807 `detail` sentence, which an authored
    // `message` overwrites; that is a permanent semantic refusal, not work, so
    // per this file's header it carries `-invalid` (like its sibling
    // `loom.e2e-ui-throw-invalid` on the same matcher) and stays out of the
    // drain backlog.  THIS row is the half that IS work.
    code: "loom.throw-kind-integration-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/test-checks.ts:206",
    what:
      "`toThrow(precondition|invariant)` is refused in a CONTEXT-INTEGRATION test.  Unlike the " +
      "e2e half this is not a semantic limit — that rung runs in-process against a real DB and " +
      "throws the same domain error the unit tier reads.  It is refused because the rung ships " +
      "on the five UNIT emitters only, and each backend's separate `integration-tests.ts` would " +
      "silently DROP the argument (measured: the node leg emitted a bare `.rejects.toThrow()`). " +
      "Drains when the rung is carried through the five integration emitters too",
    mission: "M-T5.36",
    verified: true,
  },
  {
    code: "loom.e2e-unsupported-statement",
    kind: "scope",
    site: "src/ir/validate/checks/test-checks.ts:302",
    what: "e2e bodies accept a closed statement set (expect/let/expression/…)",
    mission: "M-T5.19",
    verified: true,
  },
  {
    code: "loom.migration-expr-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/migration-checks.ts:74",
    what: "backfill exprs are a narrow validated ExprIR subset by design",
    mission: "M-T2.3",
    verified: true,
  },
  {
    code: "loom.retrieval-loads-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/query-checks.ts:290",
    what: "explicit `loads:` deferred — retrievals load the whole aggregate",
    mission: "M-T5.4",
    verified: true,
  },
  {
    code: "loom.tph-own-override-unsupported",
    kind: "scope",
    site: "src/language/validators/inheritance.ts:180",
    what: "per-concrete ownTable override inside a TPH hierarchy",
    mission: "M-T5.7",
    verified: true,
  },
  {
    code: "loom.union-find-shape-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/structural-checks.ts:485",
    what: "repository finds returning a union — v1 shape only",
    mission: "M-T5.3",
    verified: true,
  },
  {
    code: "loom.handler-load-nullable-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/api-checks.ts:116",
    what: "command/query handler load of a nullable result — v1 is single non-nullable",
    mission: "M-T5.36",
    verified: true,
  },
  {
    code: "loom.workflow-load-array-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/workflow-checks.ts:1214",
    what: "workflow load of an array result — v1 is single non-nullable",
    mission: "M-T5.36",
    verified: true,
  },
  {
    // Same SHAPE bound as the two rows above, on the third body kind: the
    // `reading` tier recognises a repository read only when it is the WHOLE
    // expression (`matchRepoRead` requires `suffixes.length === 1`).  A read in
    // MEMBER-RECEIVER position (`Accounts.byHolder(h).balance`) therefore never
    // becomes a `repo-read`: the service is typed `pure`, no read port is
    // threaded, and every backend emits the bare repository name.  Widening the
    // detector (and re-applying the remaining suffixes in
    // `lower-domain-service.ts`) retires this row.
    code: "loom.domain-service-read-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/domain-service-checks.ts:233",
    what: "a repository read used as a MEMBER RECEIVER in a domainService body — v1 binds it first",
    mission: "M-T5.14",
    verified: true,
  },
  {
    code: "loom.workflow-load-nullable-unsupported",
    kind: "scope",
    site: "src/ir/validate/checks/workflow-checks.ts:1227",
    what: "workflow load of a nullable result — v1 is single non-nullable",
    mission: "M-T5.36",
    verified: true,
  },
  {
    code: "loom.sensitive-wire-unsupported",
    // `scope`, not `gap`, since **D-SENSITIVE-INSPECT-ONLY** (wave C2 packet 2f).
    // Live and true on every backend — NO backend masks on the wire.
    // `sensitive(...)` reaches exactly one consequence, the synthesized `inspect`
    // printing `<redacted>` (enrichments.ts), while the response DTO carries the
    // value in cleartext on all five.  What the re-class says is that this is a
    // DECLARED limit with a named successor rather than a row a drain sprint can
    // close: M-T3.8's three phases are a type-system change, a masking arm in
    // five DTO emitters, and a sink census with no chokepoint — and the failure
    // mode of doing four fifths of that is indistinguishable from success in any
    // test that asserts by shape.  The warning already names the surface that
    // redacts TODAY (`mask unless`), so the author is not surprised.  Drains when
    // M-T3.8 lands; delete this row and the check module in that PR.
    kind: "scope",
    site: "src/ir/validate/checks/sensitivity-checks.ts:86",
    what:
      "a `sensitive(...)` field that a caller actually receives — no backend masks it on the " +
      "wire, and none classifies it at a log / event / resource sink; only the debug " +
      "`inspect` redaction ships",
    mission: "M-T3.8",
    verified: true,
  },
];

/** Rows that are actual work.  The sprint backlog; empty is the target state. */
export function openGaps(): readonly UnsupportedEntry[] {
  return UNSUPPORTED_REGISTER.filter((e) => e.kind === "gap");
}

/** Latent seams: gates whose membership set already names every shipping
 *  target.  Not work; they become `gap` rows for a NEW target the day it is
 *  registered, and drain only when the gate itself is deleted. */
export function latentSeams(): readonly UnsupportedEntry[] {
  return UNSUPPORTED_REGISTER.filter((e) => e.kind === "seam");
}
