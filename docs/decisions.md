# Loom decisions log

Pinned decisions referenced by the design corpus in
[`docs/old/proposals/`](old/proposals/) and the implementation plans. Each
entry has a stable **D-tag** that proposals cite when their grammar
or semantics depends on the outcome. Tag scope:

- **PINNED** — decided; downstream proposals may rely on it.
- **OPEN** — recommended answer recorded in the proposal/plan, not
  ratified by the maintainer.

When a proposal's body conflicts with a PINNED decision here, the
decision wins; the proposal text needs a rewrite (tracked per entry
under "Affects").

Decision tags were introduced by the original
[`proposals/global-implementation-plan.md`](old/proposals/global-implementation-plan.md)
("Decisions to pin before any grammar edit"; that plan was rewritten
2026-06-10 — this log is now the sole home of the tags) and are
elaborated in the per-proposal docs.

---

## D-STORAGE-SPLIT — split the overloaded `storage` keyword

**Status:** PINNED.

**Problem.** `storage-and-platform-config.md` §3.1/§3.2 use one
`storage` rule for two unrelated concerns — a physical instance
(`storage pg { type: postgres }`) vs. a logical aggregate-to-physical
binding with rich per-binding config (`storage orderEvents { use: pg,
for: Sales.Order, kind: eventLog, schema: "sales" }`). The two forms
share nothing beyond the word — the physical form carries
`type`/`instance`/`connection`/`outbox`/`follows`; the logical form
carries `schema`/`tablePrefix`/`kind`/`ttl`/`every`/`retain`/etc.
Disambiguation by "presence of `for:`" is an accident, not a design.

**Decision.** Three distinct keywords, one job each:

| Keyword | Role | Carries |
|---|---|---|
| `storage` | Physical infrastructure instance | `type`, `instance`, `connection`, `outbox`, `follows` |
| `dataSource` | Logical (context, kind) → storage binding | `for: <Context>`, `kind: <state\|eventLog\|snapshot\|cache\|replica>`, `use: <storage>`, plus per-`kind` config (`schema`/`ttl`/`every`/`retain`/`keyPrefix`/…) |
| `deployable` | Process/runtime unit | `contexts: [...]`, `dataSources: [...]`, platform config |

Worked example:

```ddd
storage pg     { type: postgres }
storage kafka  { type: kafka }
storage redis  { type: redis }

dataSource ordersState    { for: Orders, kind: state,    use: pg }
dataSource ordersEvents   { for: Orders, kind: eventLog, use: kafka }
dataSource ordersCache    { for: Orders, kind: cache,    use: redis, ttl: 60 }
dataSource ordersSnapshot { for: Orders, kind: snapshot, use: redis,
                            every: 100, retain: 5 }

deployable api {
  contexts:    [Orders]
  dataSources: [ordersState, ordersEvents, ordersCache, ordersSnapshot]
}
```

**Rationale.**

- The two forms are *not* synonyms with shared structure; they are
  separate concepts that happen to live in the same domain. A naming
  rule that makes them parse identically and rely on a sentinel field
  (`for:`) is fragile.
- `dataSource` reads naturally for "a configured source/sink of data
  for one purpose within one context."
- Keeping `storage` for the physical form preserves the most-typed
  surface (every project has physical stores; only some need rich
  per-context data-source config).
- `deployable.dataSources:` is the new clause; it pairs with the
  existing `contexts:` clause.

**Validator rules implied.**

- `dataSource` requires both `for:` (a context) and `kind:`. Missing
  either → parse / validate error.
- For each `(context, kind)` actually needed by aggregates in the
  context, exactly one `dataSource` must exist with matching `for:`
  and `kind:`. State-based aggregate → `kind: state` required;
  ES aggregate → `kind: eventLog` required; `cache`-annotated
  aggregate → `kind: cache` required; etc.
- A deployable's `dataSources:` must include exactly the dataSources
  `for:` the contexts it hosts (one per needed kind) — validator
  rejects under-listing (missing binding for a needed kind) and
  over-listing (a dataSource `for:` a context the deployable does
  not host).
- Per-`kind:` config keys validated against the resolved physical
  store's `type` (e.g., `ttl:` only on Redis kinds).

**Affects (proposal rewrites needed).**

- `storage-and-platform-config.md` — §2.1 invariant 4 (which
  asserted "no storage homogeneity per BC") conflicts with
  D-GRANULARITY below and needs rewriting; §3.2 ("Logical storage")
  becomes the `dataSource` section; §3.9 ("Module bindings — bare
  form") replaced by deployable's `dataSources:` clause; §3.8
  ("Per-deployable `overrides`") deferred under D-ENV-SWAP.
- `bounded-context-model.md` — the deployable-side
  `storage: { Orders: pg, Subscriptions: pg }` shorthand becomes
  `dataSources:` instead; framework choice on `context` is
  unchanged.
- `storage-and-platform-config-plan.md` and
  `storage-and-platform-config-micro-plan.md` — F1 sub-PRs that
  introduce the logical form ship `dataSource` from day one;
  per-aggregate `for:` does not land in v1 (see D-GRANULARITY).

---

## D-GRANULARITY — storage bindings are per-context, not per-aggregate

**Status:** PINNED.

**Problem.** Two proposals disagree:

- `storage-and-platform-config.md` §3.3 + §3.2 commits to **per-aggregate**
  binding (`for: Sales.Order`), and §2.1 invariant 4 explicitly
  declares "BC = semantic boundary only … no storage homogeneity."
- `bounded-context-model.md` reframes the BC as the unit that owns
  framework + storage, with per-aggregate binding deferred to v2 as
  override-only.

**Decision.** **Per-context for v1, all kinds.** A `dataSource`
binds at granularity `(context, kind)`. All aggregates in a context
share the same primary store (state or eventLog), the same derived
stores (cache, snapshot, replica), and the same per-kind config
(snapshot policy, cache TTL, …) for that context.

Per-aggregate binding is **deferred to v2** as an override mechanism
for the rare cross-infra-within-one-context case. The storage
proposal's per-aggregate `for: <Aggregate>` syntax does not land in
v1; if reintroduced later it lands as a deferred override (not the
primary form).

**Rationale.**

- Transactional feasibility (the "which writes can co-commit?"
  chain) is naturally per-context — see `bounded-context-model.md`
  §"Transactional workflow feasibility" link 3.
- Real-world v1 cases overwhelmingly have one primary store per
  context; cross-aggregate-within-one-context infra splits are rare.
- Per-context-per-kind preserves the storage proposal's most
  valuable insight (different kinds *do* live in different physical
  engines — eventLog in Kafka, snapshot in Redis), without
  multiplying the binding surface.
- v2 per-aggregate override remains compatible: it lifts the
  granularity inside one context without changing the rest of the
  model. The storage proposal's grammar work survives there.

**Validator rules implied.**

- `dataSource.for:` references a context, never an aggregate.
  Parser/validator rejects an aggregate-qualified `for:` in v1 with
  a diagnostic that links to this decision.
- "Two aggregates in the same context bind to different physical
  stores" is unrepresentable in v1.
- ES + state-based aggregates may coexist in one context, each
  resolving to the context's `kind: eventLog` or `kind: state`
  dataSource respectively.

**Affects.**

- `storage-and-platform-config.md` — §2.1 invariant 4 ("BC = semantic
  boundary only") rewritten to "BC = transactional-feasibility unit;
  storage homogeneity per BC is the v1 default"; §3.3 ("`for:`
  reference syntax") rewritten to context-only.
- `bounded-context-model.md` — §"Per-aggregate storage" still
  accurately frames v1 + v2; this decision pins it.

---

## D-ENV-SWAP — per-environment storage swap mechanism

**Status:** OPEN (deferred — out of scope for F1).

**Context.** Storage proposal §2.1 invariant 5: *"Storage is
swappable per deployable."* The test deployable swaps Postgres for
in-memory without the domain noticing. Two shapes were considered:

- **Option ①** — alternate dataSources per environment, deployable
  picks: `dataSource ordersStateTest { … use: memTest }` listed in
  `deployable apiTest { dataSources: [ordersStateTest, …] }`.
  Verbose if many context × kind combinations, but needs no new
  grammar.
- **Option ②** — deployable `overrides { storage pg { type:
  inMemory } }` block (existing storage proposal §3.8). Terse;
  preserves one dataSource set across environments.

**Decision (deferred).** Option ① is the implicit fallback for
v1 — it works with no new grammar beyond what D-STORAGE-SPLIT lands.
Option ② is the cleaner long-term shape but not in scope for the
initial F1 grammar; revisit after F1 lands and we have empirical
pressure on the verbosity.

**Affects.** Storage proposal §3.8 (`overrides`) does not land in
the F1 micro-plan PRs; reopens after F1.

---

## D-DOCUMENT-AXIS — document storage as two orthogonal header axes

**Status:** PINNED (core axes, syntax, validation contract); the
numbered **Open sub-questions** below remain OPEN.

**Implementation: SHIPPED.** `json` primitive (#703);
`persistedAs: eventLog|state` (#711); the saving-shape axis —
originally drafted as the boolean `normalised(true | false)` (#713),
**reworked to the 3-valued `shape: relational|embedded|document`**
(#724) once it was clear the axis is a spectrum, not a boolean — with
emission across the backends: **`embedded`** on all of dotnet/hono/
phoenixLiveView (EF owned `.ToJson()` / Drizzle jsonb / Ash embedded
resources, #724/#735/#750), **`document`** on dotnet/hono (STJ /
jsonb blob, #724), and a **`supportedShapes` capability validator**
(#738) that errors on a `shape: …` the target backend can't emit. No
new Marten backend. Remaining (deferred): Ash `document` (non-idiomatic
single-`:map`, allowed-but-warned) and `eventLog` + snapshot
rehydration (gated behind the appliers feature). See
`document-and-json-hierarchies.md` §9.

**Problem.** Loom models internal hierarchies but the
relational-vs-document storage choice is implicit and unselectable
(value objects → inline JSONB; entity parts → child tables); there is
no open-shape JSON field; and a document/event-store backend (Marten)
has nowhere to attach. The shipped `persistenceStrategy:` clause also
conflates the event-sourcing *body contract* with *persistence* and
sits anomalously inside the aggregate body. Full analysis in
[`proposals/document-and-json-hierarchies.md`](old/proposals/document-and-json-hierarchies.md).

**Decision.** Two orthogonal **per-aggregate header modifiers**, plus a
`json` field type. "Document" is a field type **and** a saving choice —
**not** a new declaration kind.

| Modifier | Axis | Values | Default |
|---|---|---|---|
| `persistedAs: ...` | primary truth kind | `eventLog` \| `state` | `state` |
| `shape: ...` | saving shape of the materialised read model / snapshot | `relational` \| `embedded` \| `document` | `relational` |

(`shape: ...` superseded the original boolean `normalised(true\|false)`
in #724 — `shape: relational` == old `normalised(true)`, `shape: document`
== old `normalised(false)`, with `embedded` added as the queryable middle.)

- `persistedAs` values align to the D-STORAGE-SPLIT `kind` set, so
  `resolve-datasource.ts`'s `eventSourced→eventLog` /
  `stateBased→state` mapping becomes an **identity**.
- `persistedAs` **renames + relocates** the shipped body
  `persistenceStrategy: stateBased | eventSourced` → header
  `persistedAs: eventLog|state`. Breaking change; **hard cutover** —
  `persistenceStrategy:` is removed (not accepted in parallel);
  existing `.ddd` sources migrate in one step (codemod offered).
- **All** aggregate-level config lives on the **header**
  (`with`, `extends`, `persistedAs: …`,
  `shape: …`, `inheritanceUsing: …`; bare `abstract`/`crossTenant`).
  **Nothing configures in the body** — the body holds members only.
  (The enum-axis modifiers were drafted as *paren* calls
  `persistedAs(eventLog)`; **M-T5.17 phase 2 cut them over to colon
  clauses** — order-independent — and hoisted `crossTenant` to lead
  beside `abstract`. The paren form and the trailing `crossTenant` no
  longer parse; the `ids` clause was removed outright.)
- New `json` **primitive field type** — opaque JSONB; a leaf in
  `wireShape` (never expanded/diffed).
- **Rejected:** `document` as an aggregate peer. **Deferred:** a
  dedicated `document` value-type. **Dropped:** a per-containment
  `as document/table` hint.
- ES + document needs **no new `kind`**: a `kind: eventLog` binding +
  a `kind: snapshot` (or `state`) binding carrying `shape: document`.
- **No dedicated Marten backend.** "Store as a document" is *the
  aggregate read model in one JSONB column*, which every backend's ORM
  already supports — so the `document` shape is a **mode added to the
  existing adapters** (EF Core `.ToJson()`, Drizzle `jsonb`, Ash
  embedded/`:map`), advertised via a new **`supportedShapes`** companion
  to `supportedStrategies` on the existing `PersistenceAdapter` seam. A
  separate `martenPersistenceAdapter` was considered and rejected: its
  document half *is* EF `.ToJson()`, and its event-store half (stream +
  document-snapshot rehydration) needs appliers
  (`workflow-and-applier.md`) regardless of backend. So Slice D's
  achievable target is **`persistedAs: state` + `shape: document`**;
  the `eventLog` + document case is deferred behind appliers.

**Validator rules implied.**

- `persistedAs: eventLog` is the **declaration** of event-sourcing (the
  rename of `persistenceStrategy: eventSourced`); there is no separate
  `eventSourced` body marker.
- The **body-discipline enforcement** — operations change state only by
  emitting events, an `apply` exists per event, no direct `:=` mutation
  — is **owned by the event-sourcing behavioral feature (appliers,
  `workflow-and-applier.md`)** and is *gated on* `persistedAs: eventLog`.
  It is **not** implemented by the `persistedAs` rename itself, and
  cannot land before `apply` exists in the grammar. So the rename slice
  ships no body-contract validator; that enforcement arrives with the
  applier feature.
- `persistedAs: state` (default / absent): operations mutate state
  directly; no `apply`.
- `persistedAs` is **explicit**, default `state` (omitted entirely
  for state-based aggregates). **No inference and no suggestion lint.**
- `shape: document` requires the context to resolve a
  document-capable store/adapter; it constrains the `snapshot` binding
  under `persistedAs: eventLog`, the `state` binding under
  `persistedAs: state`.
- Interaction (D-ES-TPH, generalised): a `persistedAs: eventLog`
  concrete subtype of a `sharedTable` base is forced to `ownTable`
  regardless of `shape`.

**Sub-questions.**

1. **`persistedAs` inference** — **RESOLVED: explicit, default `state`,
   no inference, no lint.**
2. **`json` shape-hint** — **RESOLVED: plain `json` for v1**; `json<T>`
   out of scope.
3. **Snapshot cadence for `eventLog` + document** — **RESOLVED: reuse
   the `snapshot` `dataSource`'s `every:` knob** (already in
   D-STORAGE-SPLIT). Cadence is binding/infra config; no aggregate-header
   arg.
4. **Per-projection vs per-aggregate `shape`** — **RESOLVED:
   per-projection.** The shape is settable per read-model: the
   per-binding `dataSource shape:` knob (on the `state` / `snapshot`
   / `replica` binding) governs that projection's shape; the
   aggregate-header `shape: …` is the default. This stays within
   D-GRANULARITY (per `(context, kind)` binding, not per-aggregate). Richer
   *named* projections (multiple read models of one ES aggregate, each a
   different shape) depend on future read-model modelling and are out of
   v1 scope.
5. **Real document DB** — **RESOLVED: Postgres-JSONB only in v1**
   (Marten's own bet); `shape: document` resolves to JSONB / Marten
   docs on Postgres. `StorageType += mongo` deferred.

**Affects.**

- `document-and-json-hierarchies.md` — this is its decision record.
- `aggregate-inheritance.md` — its `storage: shared|own` header clause
  is renamed by D-RENAME (below) to the `inheritanceUsing: …`
  header modifier; same header line.
- Shipped grammar — `persistenceStrategy:` (body) **removed** in favour
  of `persistedAs: …` (header); hard cutover, one-step source migration
  (codemod).
- `resolve-datasource.ts` — mode→kind mapping collapses to identity.

---

## D-BACKEND-PKG — per-version backend packages are canonical

**Status:** PINNED.

**Problem.** Two layout docs disagree about where framework-coupled
backend code lives. `platform-directory-layout.md` recommends
**Option A** — reverse the `src/platform/hono/v4/` hoist back down
into `src/generator/<platform>/frameworks/…`, shrinking `src/platform/`
to thin surface records. Separately, `docs/old/plans/packaging-split.md`
(P0–P4, partly shipped) drives toward the opposite: each backend
becomes a **separately-installable per-version npm package**
(`@loom/backend-hono-v4`, `@loom/backend-dotnet-v8`, `-v10`, …)
discovered via its `loom` package.json key, so old + new majors coexist
and `@loom/core` never statically bundles a backend.
`src/platform/hono/v4/` is the staging shape for that relocation
(P3-slice-5), currently blocked only on browser-side backend discovery.

**Decision.** The packaging-split end-state is **canonical**. Backends
are per-version packages; `@loom/core` keeps the framework-neutral emit
(`render-expr`/`render-stmt`, DTO/VO/id/event templates) + the
`PlatformSurface` contract + the resolver. The `package → shared`
layering invariant — *shared code under `src/generator/` must never
import from `src/platform/<family>/<vN>/`*, guarded by
`test/platform/backend-packages-layering.test.ts` — is load-bearing.

`platform-directory-layout.md` **Option A is rejected**: it would
re-pin shared core to one framework version (blocking `hono@v5`) and is
forbidden by the live invariant. The *direction* that survives is
per-`<family>/v<N>/` homes that map 1:1 to packages; the existing hono
hoist is correct, not to be reversed.

**Mechanism / sequencing.**

- No speculative scaffolding — no `v5/`, `express/`, `nestjs/`, adapter
  sub-version dirs, or publish wrappers until a real consumer exists.
- The dotnet (then phoenix) core↔backend split — mirroring hono's P2 —
  is sanctioned now that F6d proved the boundary, but is sequenced
  **after** the storage F-series' remaining persistence-dispatch slices
  land (they still edit `src/generator/dotnet` / `phoenix-live-view`).
- Physical relocation into `packages/` (P3-slice-5) stays gated on
  browser-side backend discovery; until then the in-`src` staging dirs
  + thin re-export wrappers are the reachable shape.

**Affects.**

- `platform-directory-layout.md` — the "Recommendation" section and the
  V1 row (recommending Option A) are superseded; the doc carries a
  "Pinned decisions affecting this proposal" banner pointing here.
- `per-package-output-tree.md` — the *output-side* twin of this decision
  (per-layer output packages). Right direction, **deferred** on one-time
  cost + playground-workspace prerequisite, not rejected; expressible as
  a `LayoutAdapter` extension.
- `docs/old/plans/packaging-split.md` / `backend-packages.md` — promoted
  from "plan" to the pinned target for backend layout.

---

## D-ADAPTER-HOME — persistence/style/layout adapters live on the backend surface

**Status:** PINNED.

**Problem.** The storage F-series introduced a persistence/style/layout
adapter taxonomy with the contracts correctly in core
(`src/generator/_adapters/`), but a **central** registry
`src/platform/adapter-registry.ts` that statically imports every
backend's adapter implementations. That central fan-in (a) becomes a
`core → package` edge — the direction `backend-packages-layering.test.ts`
forbids — the moment a backend relocates into `packages/`, and (b)
already causes a load-time import cycle (`adapter-registry ← cqrs-style
← … ← platform/registry ← platform/dotnet`), which forced F5d/F6d to
bind each orchestrator's **own local sibling adapters** instead of
resolving through it.

**Decision.** Adapter **implementations** belong to the backend, exposed
through its `PlatformSurface` (an additive contract field carrying the
adapter menu + defaults). `@loom/core` owns only the **contracts**
(`src/generator/_adapters/`) + the `resolve*` helpers, which read
menu/defaults off the *discovered* surface. The central
`src/platform/adapter-registry.ts` is **interim** and does **not**
survive the alignment pass.

**Mechanism / status.**

- The *emit* half is already decentralised (F5d/F6d orchestrators
  dispatch through local adapters). Remaining work: source the menu +
  defaults from the surface, then delete the central registry's static
  fan-in.
- Version-divergent adapters (efcore8 vs efcore10, Ash 3 vs 4) ship
  inside the version's backend package — that divergence *is* the
  package's reason to exist. No shared cross-framework adapter layer
  (e.g. a `node`-shared drizzle) until ≥2 real consumers exist
  ("consolidate the present, don't design for the future").

**Affects.**

- `storage-and-platform-config*.md` — the adapter-registry shape they
  describe is interim per this decision.
- Depends on D-BACKEND-PKG (the surface is the discovery unit).

---

## D-RENAME — aggregate-inheritance layout modifier

**Status:** PINNED.

**Decision.** Inheritance table layout is a **header colon modifier**
`inheritanceUsing: sharedTable|ownTable` (was the body clause
`inheritanceStrategy: shareTable | ownTable`). Amended by
D-DOCUMENT-AXIS §4 — all aggregate config moves to the header;
nothing in the body. (Drafted as the paren call
`inheritanceUsing(ownTable)`; recolonized by M-T5.17 phase 2 — the
paren form no longer parses.) Values stay **table-baked**, spelled
`sharedTable | ownTable` (refines the earlier `shareTable`, reads as
"shared table"); the medium-neutral `shared | own` spelling is
rejected (the choice is specifically about table layout, and naming it
so keeps it honest when document/JSON saving enters via `shape`).

**Validator rules implied.**

- `inheritanceUsing: …` is only valid on an aggregate that participates
  in inheritance (`abstract` base or `extends` subtype).
- `sharedTable` = TPH (single table + discriminator column);
  `ownTable` = TPC/TPT (table per concrete). The exact TPC-vs-TPT
  choice is a backend detail, not surfaced in the modifier.

**Affects.** `aggregate-inheritance.md` (its `storage: shared|own`
clause is this modifier); `document-and-json-hierarchies.md` §4a (same
header line). Interacts with D-ES-TPH below.

---

## D-ES-TPH — event-sourced concrete subtype of a TPH abstract

**Status:** PINNED.

**Decision.** A `persistedAs: eventLog` concrete subtype of a
`sharedTable` (TPH) abstract base is **forced to
`inheritanceUsing: ownTable`** — an event-sourced stream cannot share a
state table with its siblings. Generalises across `shape` per
D-DOCUMENT-AXIS: a `shape: document` (document) concrete of a
`sharedTable` base is likewise forced to `ownTable`. The validator
raises an error (not a silent coercion) so the author writes the
forced modifier explicitly.

**Affects.** `aggregate-inheritance.md`; the persistence adapter's
table-layout resolution.

---

## D1–D4, D14–D15 — type-system grammar names + ML syntax

**Status:** PINNED (the six grammar-shaping tags). The remaining
type-system decisions D5–D37 keep their **recommended** answers in
[`proposals/implementation-plan.md`](old/proposals/implementation-plan.md)
and may be taken per-phase without separate ratification (per that
doc's workflow note); only D1–D4 + D14–D15 are pinned here because they
fix the grammar surface before P3.

| Tag | Question | **Pinned answer** |
|---|---|---|
| D1 | Carrier bound name | **`carrier`** (over `value`/`data`) |
| D2 | Union discriminator field name | **`kind`** (over `type`/`_type`) |
| D3 | Union identity | **Variant-name-tagged** (not structural) |
| D4 | Aggregate-in-carrier semantics | **Handle-in-process, wire-at-boundary** |
| D14 | Parameterised-payload use-site syntax | **Postfix ML** (`customer page`); consistent with `Customer id`; **no angle brackets anywhere** |
| D15 | Anonymous `or` precedence vs postfix constructors | **Postfix binds tighter than `or`** (`string or int option` parses as `string or (int option)`; parens for the other reading) |

**Rationale.** D14's postfix ML choice is the load-bearing one — it
keeps `customer page`, `customer id`, `customer option` all reading as
"a page/id/option *of* customer", with zero generics syntax (`<>`) in
the language. D1/D2 pick the least-surprising names; D3/D4 were already
pinned in the implementation plan and are restated here for one
authoritative location.

**Affects.** `payload-transport-layer.md` (P3/P4 grammar);
`exception-less.md` (D15 governs `or` precedence); `ddd.langium`
`TypeRef` + payload rules.

---

## D-POLICY-STYLE — authorization grammar shape

**Status:** PINNED.

**Decision.** Authorization is expressed in dedicated **`policy { }`
blocks** with three sub-sections — `data { reachable when … }`
(row-set reachability filter, paramless), `operations { <op> when … }`
(point gates, params from the operation), and `fields { mask … }`
(field masking) — **over** the function-style policy DSL alternative.
Reuses `function`, `currentUser`, and `permissions {}` as building
blocks inside the block.

**Rationale.** The block form keeps authorization as visibly-separate
*infrastructure* (one place to read "what governs this aggregate"),
makes the reachability-vs-gate distinction structural (different
sub-sections, different binding scopes), and reads as declarative
configuration rather than scattered guard functions. `currentUser`
member accesses (`.permissions`, `.dataKey`, `.id`) resolve against the
shape pinned in
[`architecture/request-context.md`](./architecture/request-context.md).

**Affects.** `authorization.md` (its central grammar);
`policies-supplementary-note.md` stays superseded background;
`ddd.langium` gains the `policy` rule (Phase 3.2).

---

## D-LIFECYCLE-VERB — lifecycle URL style default

**Status:** PINNED.

**Decision.** The api surface carries `urlStyle: literal | resource`,
**default `literal`**. `literal` uses the operation/create/destroy name
verbatim as the URL slug (`operation cancel()` → `POST
/orders/:id/cancel`); `resource` pluralises it via `src/util/naming.ts`
(`operation cancellation()` → `POST /orders/:id/cancellations`). Loom
rejects the Restful Objects two-tree URL idiom outright (`POST
/services/Customers/actions/createNewCustomer/invoke`) in favour of
conventional REST that hand-written clients already understand.

**Affects.** `lifecycle-operations.md`; the per-backend route emitters
(slug derivation reads `urlStyle`).

---

## D-I18N-KEY — i18n key stability

**Status:** PINNED.

**Decision.** **Option B as default, Option C as escape hatch.**

- **Inline user-visible literals** are keyed by a content hash —
  `page.<page>.<role>.<sha-6>` (6-char base64 of `sha512(source)`).
  Placeholders are **normalised to positional for hashing** (`"Order
  {0}"`) but **rendered named** at use (`{orderNumber}`). Effect: a
  placeholder *rename* leaves the hash stable; `ddd i18n sync` rewrites
  the placeholder name in the catalog without re-keying (Option B).
- **Named `text { }` entries** get true stable keys
  (`text.<Namespace>.<name>`) with author-chosen placeholder names —
  the escape hatch (Option C) for strings that must survive *content*
  edits, not just renames.

Option A (live with churn) is rejected; positional-only hashing without
named render is rejected (leaks DSL/source structure to the client).
The unnamed-placeholder fallback warns (`loom.unnamed-placeholder`).

**Affects.** `i18n.md`, `i18n-strings.md`; the `ddd i18n sync`
three-way merge; the generated catalog key shape.

---

## D-I18N-ATTR — who resolves an attribute-position string

**Status:** PINNED.

**Decision.** **The a11y/i18n helper emits an already-TRANSLATED value; a
design pack never resolves a key.** A user-visible string in ATTRIBUTE
position (`Button`'s aria-label, `Toolbar`'s aria-label, `Alert`/`Modal`
title, `Divider` label) reaches a pack in exactly one of two spellings,
both produced by `src/generator/_walker/i18n-emit.ts` from the same
`messageKey()` the extraction pass uses:

- an HTML-ish attribute **FRAGMENT** (`localizedAriaLabelAttr`,
  `localizedNamedAttr`) — spliced verbatim by the four JSX/markup
  frontends, whose packs are `.hbs` templates that can only interpolate
  text;
- a target-native **VALUE** (`localizedNamedValue`, via the optional
  `WalkerTarget.renderStringLiteral` seam) — for the packs that build
  props procedurally rather than markup: Feliz (F# `prop.ariaLabel …`)
  and Flutter (Dart `Semantics(label: …)`).

Phoenix/HEEx is a third spelling of the SAME rule rather than an
exception: its markup is HTML-ish, but its runtime is gettext, so
`localizedHeexAttr` emits HEEx's `{…}` expression form
(`aria-label={pgettext("<key>", "<English>")}`) — which is why
`elixirI18nString` escapes `{`/`}` in the message. Until it existed
HEEx translated every TEXT slot and no ATTRIBUTE one, so an accessible
name shipped in English at every locale beside a caption that did not.

The rejected alternative is handing the pack the **key** and letting it
call the runtime: that duplicates the "is this app i18n-enabled at all"
decision into every pack, and one pack forgetting the check emits a
`t()` into an app with no runtime. Deciding once in the helper keeps the
i18n-OFF path byte-identical by construction, and keeps
`.loom/messages.en.json` the single catalog for both spellings.

**Corollary.** A pack that *drops* a user-visible slot is a bug, not a
style choice — the string still reaches the catalog, so a translator
translates text the app never renders.

**Corollary 2.** A slot the helper owns is a slot no pack re-decides.
When `Icon`'s accessible name joined the table, the walker took over the
decorative-vs-named decision as well — a pack now receives a name or
nothing, instead of re-implementing "`label:` and not `decorative:`"
from raw args in its own language. Two copies of that predicate (Feliz,
Flutter) and one HTML round-trip disappeared with it.

**Affects.** `i18n.md`, `accessibility.md`; `_walker/i18n-emit.ts`,
`_walker/a11y-emit.ts`, `_walker/target.ts`; every `primitive-*.hbs`
carrying a user-visible attribute, plus the Feliz/Flutter packs.

---

## D-PACK-CHROME — how a design pack makes its own strings translatable

**Status:** PINNED.

**Decision.** **A pack DECLARES its chrome in `pack.json`; the toolchain
derives the key and decides whether i18n is on.** The user-visible-string
extraction pass walks the IR, so a word that exists only in a `.hbs` is
invisible to it and therefore untranslatable. The curated `chrome.*` table
([D-I18N-ATTR](#d-i18n-attr--who-resolves-an-attribute-position-string) and
the `localizedChrome*` helpers) covers chrome an EMITTER builds and hands a
template as a ready token; it cannot cover a string the pack invents, because
that would need a curated key in the toolchain, a token in the emitter's view
model and a threading argument at every call site — for a word only that pack
renders. Packs genuinely disagree about those words: two of fifteen spell the
empty picker `— select —` rather than `Select…`, one labels a breadcrumb
landmark, two carry a visually-hidden `Close`.

So `pack.json` grows a `chrome` map of `role → English`, and templates spell
it through helpers the loader binds into every `pack.render` — `{{{chrome}}}`
(markup text, with ICU hole values as hash args), `{{{chromeAttr}}}` (a WHOLE
attribute: a bound attribute changes shape per framework, so the template
cannot spell the name and take only the value), `{{{chromeValue}}}` (a
target-native value), `{{{chromeImport}}}` (whole-FILE templates only).

Keys are `pack.<family>.<role>.<hash>`, consistent with
[D-I18N-KEY](#d-i18n-key--i18n-key-stability): the `pack.` namespace cannot
collide with `page.*` / `component.*` / `menu.*` or `chrome.*`; `<family>`
rather than `family@version`, because two versions that spell a string
identically should share one translation and the content hash separates them
the moment they diverge; and a rephrase re-keys, so `ddd i18n sync` sees a
delete-old + add-new instead of silently keeping a translation of the old
wording.

**This does not weaken D-I18N-ATTR.** A pack names a ROLE; it never resolves
a key and never decides whether the app has a translation runtime. Both stay
in the toolchain (`packChromeKey`, `LoadedPack.setChromeI18n`), which is what
keeps the i18n-OFF path byte-identical BY CONSTRUCTION — the binding starts
off, each helper returns the bytes the template previously spelled inline,
and a frontend switches it on only for a UI already translatable by its
authored strings.

**Rejected: scraping the `.hbs` for English.** It cannot tell `Remove` from a
TypeScript generic bound, an `@doc` string or a class name; it gives an author
no opt-out; it produces no ROLE, which is what makes two occurrences of
`Close` in one pack distinguishable to a translator; and it cannot be
validated — whereas a declaration is rejected at pack LOAD when its message
carries a character significant to the markup it is spliced into unquoted.

**Corollary.** A declared role no template renders is a dead catalog entry (a
translator translating a string the app never shows) and fails a gate; so does
a template leaving user-visible English in a markup text node or a user-facing
attribute. Both live in `test/generator/pack-declared-chrome.test.ts`.

**Affects.** `design-packs.md` §2 `chrome`, `i18n.md`;
`_packs/pack-chrome.ts`, `_packs/loader.ts`, `_walker/render-primitive.ts`,
`_frontend/i18n-runtime.ts`, `system/i18n-catalog.ts`; every `pack.json`.

---

## D-I18N-HEEX-ICU — who formats an interpolated message on Phoenix

**Status:** PINNED.

**Decision.** **The message stays ICU verbatim; gettext resolves it and
an ICU engine formats the result.** Phoenix is the one frontend whose
translation runtime is not Loom's own shim — it uses `gettext`, which
every Elixir tool speaks. But gettext interpolates `%{name}`, not ICU
`{name}`, and has no `plural`/`select` arg type, so an interpolated
message has to be reconciled somewhere. Two jobs, split at their natural
seam:

```
gettext resolves the message  →  ex_cldr_messages formats the holes
```

which is exactly the two steps the JS shim already is (`messages[key] ??
default`, then `intl-messageformat`). The emitted call nests that way
round — `loom_icu(pgettext(<key>, <ICU msgid>), [<holes>])` — so the
holes are formatted in *the active locale's translation*, which may
reorder them or use plural categories English does not have.

The rejected alternative is rewriting ICU to gettext's `%{}` grammar at
emit time. It is cheaper, but the Phoenix `.po` would stop carrying the
same msgid as the other five catalogs, and the `,format` set and
plural/select would be lost outright. One `messageKey()` → one catalog →
one message is the invariant the whole i18n design rests on.

**Second-tier gate.** The CLDR backend costs real compile time, so it
ships only for a ui with an **interpolated** message — one tier below
the existing "has any string at all" gate. A translatable-but-literal-only
Phoenix app keeps the deps, files and bytes it had before. The gate reads
the extraction pass's per-entry `icu` marker, not a `{`-sniff over the
catalog: merged pack chrome carries holes too (`chrome.pageOf` is "Page
{page} of {pages}") and HEEx renders none of it through this path.

**Documented degradation.** `ex_cldr_messages` implements ICU
MessageFormat but not ICU number **skeletons** — `{total, number,
::currency/USD}`, the spelling Loom's own grammar documents — and raises
on a `date` style unless `ex_cldr_dates_times` is configured. An
unformattable message degrades to raw hole substitution rather than
crashing the render: the value appears unformatted, which is what the
page showed before it was translatable. Same trade, same reason, as the
Flutter runtime's `_substitute` fallback — though Flutter no longer
*needs* it for skeletons: its runtime pre-formats the `, number` /
`, date` / `, time` holes through `intl`'s `NumberFormat`/`DateFormat`
before `MessageFormat` parses the message, and keeps `_substitute` only
for a message the parser genuinely rejects.

**Affects.** `i18n.md`; `generator/elixir/i18n.ts`,
`generator/elixir/heex-walker-core.ts`,
`generator/elixir/vanilla/shell-emit.ts`;
`_walker/i18n-extract.ts` (`MessageEntry.icu`).

---

## D-CTX-SHAPE — the ambient `RequestContext` field set

**Status:** PINNED. Full shape in
[`architecture/request-context.md`](./architecture/request-context.md).

**Decision.** One ambient `RequestContext` value, read by every
governance feature. Two tiers: **request-stable** (`correlationId`,
`currentUser`, `locale`, `startedAt`) set once at the boundary;
**frame-local** (`scopeId`, `parentId`) re-derived per execution-context
scope frame. `currentUser` (`id`, `tenantId`, `permissions`, `dataKey`)
**is** the `currentUser` magic identifier from `authorization.md` and
the source of `user.tenantId` for multi-tenancy. No feature opens its
own parallel ambient channel (`ICurrentUserAccessor`, `getLocale()`, a
logging MDC, …) — they all read slices of this one value.

**Affects.** `execution-context.md` (defines the frame tier),
`multi-tenancy-design-note.md` (`tenantId`), `authorization.md`
(`currentUser`/`dataKey`), `sensitivity-and-compliance.md`
(declassification clearance), `i18n.md` (`locale`),
`audit-and-logging.md` (actor + correlation), `observability.md`
(correlation). PlatformSurface lifecycle hooks receive its accessor.

---

## D-ENVELOPE — the wire envelope rule

**Status:** PINNED. Full rules in
[`architecture/wire-envelope.md`](./architecture/wire-envelope.md).

**Decision.** Every HTTP response is exactly one of four shapes — **bare
value** (single entity/payload/primitive), **`Paged<T>`** (lists),
**ProblemDetails** (RFC 7807, all errors), **event-frame** (`{ kind,
occurredAt, correlationId, data }`). The HTTP **status code is the
success/error discriminator**; the success path is **never** wrapped in
a `{ kind: "ok", value }` envelope (D16) — the payload `kind`
discriminator (D2/D3) lives inside tagged-union bodies, not at the
envelope level. A uniform `{ ok, value | error }` envelope is rejected
(forces every client to unwrap; duplicates the status line).

**Affects.** `payload-transport-layer.md`, `exception-less.md` (D16,
D17, D18), `pagination-design-note.md` (`Paged<T>`/`unpaged`),
`workflow-and-applier.md` (event-frame); every backend's DTO/route
emitter; the `conformance-parity.yml` OpenAPI gate.

---

## D-URLSTYLE — lifecycle URL style on the api body + per-action routeSlug

**Status:** PINNED. Full design in
[`proposals/lifecycle-url-style.md`](old/proposals/lifecycle-url-style.md);
amends `lifecycle-operations.md` Phase 2, whose grammar sketch assumed a
fictional per-aggregate `api … for <Aggregate> { urlStyle }` form.

**Problem.** `lifecycle-operations.md` Phase 2 specifies `urlStyle` on a
per-aggregate api with a body. The real grammar is
`api <Name> from <Subdomain>` — per-subdomain, body-less. The proposal's
text can't parse against the shipped grammar, so Phase 2 is designed
against the real model here.

**Decision.**

1. **`urlStyle` lives on the `api`, as an optional body** —
   `api SalesApi from Sales { urlStyle: literal | resource }`, default
   `literal` (D-LIFECYCLE-VERB). On the *api* (the shared contract), not
   the deployable (URL shape isn't per-process) nor a system default
   (too coarse; a system-default-with-override is a deferred v2 nicety).
   Grammar uses a direct optional property, not a members list, until a
   second api-body clause actually lands. `urlStyle`/`resource` are
   soft-admitted in `LooseName`/`NameRefIdent` (the `dataSource`/`money`
   precedent).
2. **`routeSlug` is a per-action `OperationIR` field, derived in
   enrichment** — not the proposal's separate `agg.lifecycle` shape (the
   Phase-1 `creates`/`destroys` arrays already partition by kind).
   Derivation: `canonical → undefined` (bare collection / canonical-id
   URL); `urlStyle: literal → name`; `urlStyle: resource → plural(name)`.
   The HTTP verb + path skeleton stays Phase-3 emitter logic keyed on
   `kind` + `canonical` + `routeSlug`.
3. **The surfacing api is resolved by subdomain.** Aggregate → one
   context → one subdomain → the api `from` it. Enrichment threads the
   subdomain's style into `enrichAggregate`. Top-level contexts (no api)
   default to `literal`. If two apis surface one subdomain with differing
   `urlStyle`, the **first declared wins** and the validator warns
   (`loom.subdomain-conflicting-urlstyle`).

**Consequences (not separate decisions).**

- **No generated-output change in Phase 2** — no backend reads
  `routeSlug` yet (emitters still build slugs inline as `snake(name)`),
  so fixtures stay byte-identical. The re-baseline lands in **Phase 3**,
  when emitters consume `routeSlug` and `resource`-style URLs change
  (a coordinated `rebaseline-Lifecycle` moment).
- **The verb-name warning** (`loom.url-style-naming-warn`,
  `cancel → /cancels`) is **deferred** — reliable verb detection needs a
  lexicon; low value vs false-positive cost.

**Affects.** `lifecycle-operations.md` Phase 2 + integration-seams
sections (superseded by `lifecycle-url-style.md`); `ApiIR.urlStyle`,
`OperationIR.routeSlug`; the enrichment pass; depends on D-LIFECYCLE-VERB.

---

## D-PHOENIX-SURFACE — the decomposed Phoenix platform surface

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the canonical platform
name renamed `phoenix` → `elixir`). The *decomposition* conclusions of this
decision (one platform for the language ecosystem; UI framework axis on `ui`;
default domain Ash; no `family@version`; no `apiOnly`) all stand; only the
spelling of the canonical platform name changes. (Reconciles two proposals
that, taken individually, collide. Subsumes the **D-PHOENIX-ECTO** ask from
`elixir-ecto-and-api-only-backends.md`.)

**Amendment (aliases retired).** Both the `phoenix` / `phoenixLiveView`
*platform* aliases (D-ELIXIR-PLATFORM amendment) and the `liveview` *framework*
alias introduced by this decision have since been **removed**. `framework:
phoenixLiveView` is the only framework spelling — the bare `liveview` keyword is
gone from the grammar `Framework` rule, and the `canonicalFramework` desugar
(both the lowering-side and validator-side copies) is deleted. `platform:
elixir` + `framework: phoenixLiveView` are the only spellings.

**Problem.** Two proposals each free a *different* axis off the single
`phoenixLiveView` keyword, and their individually-recommended fixes
**conflict**:

- `elixir-ecto-and-api-only-backends.md` frees the **domain** axis (Ash vs
  Ecto) and its **Option B** recommends carrying that axis *in the platform
  name* — `phoenixLiveView` = Ash, a new `phoenix` = Ecto.
- `embedded-frontend-composition.md` frees the **hosted-UI-framework** axis
  (LiveView vs embedded React) and recommends **retiring `phoenixLiveView`**
  entirely — one `phoenix` platform, with `liveview` demoted to a
  `framework:` value on `ui`.

Composed, they collide: Option B uses the *name* to encode the domain axis,
while the framework note frees a *different* axis off that same name and
deletes it. You cannot do both. `phoenixLiveView` froze **two** axes plus the
host into one token; the fix must free **both** axes the same way — neither
should be re-frozen into a platform name.

**Decision.** **One** backend platform, **`phoenix`**, with both frozen axes
expressed as orthogonal config — *not* as platform names:

| Concern | Where it lives | Values |
|---|---|---|
| **Host runtime / web framework** | `platform: phoenix` | the Phoenix/BEAM runtime (`needsDb: true`, `apiBasePath: "/api"`, serves `priv/static`) |
| **Domain / persistence framework** | the existing **D-ADAPTER-HOME `style:`/`persistence:` adapter** menu off the backend's `PlatformSurface` — **not** a new keyword | `ash` \| `ecto` |
| **Hosted UI framework** | `ui { framework: … }` + `deployable { hosts: }` | `liveview` (Phoenix-only) \| `react`/… (any static host) |

This makes `phoenix.hostableFrameworks = {liveview} ∪ {react, …}` — the
richest of any platform — a *derived* consequence of Phoenix being the only
platform that is both a render runtime **and** a static-asset host, not a
special case. It is **a refinement of D-PHOENIX-ECTO Option B**: keep Option
B's "no `family@version`, no `apiOnly` platform" conclusions, but reject its
"domain axis = platform name" mechanism (which the framework note shows
double-books the name).

**The domain axis is universal, not Phoenix-special.** *Every* backend freezes
a domain/persistence framework — `hono`→Drizzle, `dotnet`→EF+Mediator,
`phoenix`→Ash|Ecto (`docs/generators.md:27`). Ash-vs-Ecto is the *same axis* as
Drizzle-vs-Prisma or EF-vs-Dapper; Phoenix only *looks* special because it is the
first backend whose menu has **size > 1**, so it is the first where the modifier
is ever written. Therefore:

- **No `domain:` keyword, and nothing Phoenix-only.** The axis is the
  already-PINNED **D-ADAPTER-HOME** `style:`/`persistence:` adapter surface:
  each backend exposes its menu + default off its `PlatformSurface`; `phoenix`'s
  menu is `{ash, ecto}` (default `ash`), `hono`'s is `{drizzle}`, `dotnet`'s is
  `{ef}`. A size-1 menu means the author never writes the modifier — which is
  why `platform: hono` looks "domain-free" today. Adding Ecto is *populating
  Phoenix's menu*, not minting a platform mechanism.
- **No second `framework:` on the backend.** `framework` is now the **UI** axis
  (`ui { framework: react | liveview }`); reusing it backend-side would collide.
  A backend's web framework simply **is** its `platform:` (`hono`/`dotnet`/
  `phoenix`). So a backend has exactly two axes, both already named:
  `platform:` (runtime/web framework) and `style:`/`persistence:` (domain
  framework) — and the Ecto note's own Option A already spells Ash/Ecto in
  exactly that surface (`persistence: { ectoPostgres }`, `style: { ecto }`).

Option A (adapter swap) is therefore not a *later* factoring for this axis — it
**is** the axis. This decision pins the domain axis onto the D-ADAPTER-HOME
surface now (the menu/default fields); only the Ash-emit *extraction behind the
adapter contract* remains as the implementation tail the Ecto note phases.

**Consequences.**

- `phoenixLiveView` is retired as a platform token; a desugar shim maps it to
  `platform: phoenix` + the `ash` adapter (default) + the referenced `ui`
  gaining `framework: liveview` (mirrors the `platform: react` → vite-host shim).
- **API-only** stays resolved by **D-API-ONLY** (absence of a `ui`/`hosts:`
  mount) — unchanged; it is neither a name nor a flag.
- **Phoenix-embeds-React** (bundle → `priv/static`, same-origin `/api`)
  becomes expressible for free — the `wwwroot` twin of dotnet.
- The four Phoenix shapes {Ash,Ecto} × {LiveView, embedded-React} +
  {API-only} are spanned by two orthogonal axes (one of them a pre-existing
  adapter menu), not 5+ platform names.

**Open within this decision.**

1. ~~**Adapter-surface spelling** — `style:` vs `persistence:` vs both for the
   Ash/Ecto choice.~~ **RESOLVED by D-REALIZATION-AXES:** neither — the
   domain-framework axis gets a dedicated `foundation:` keyword (default
   `vanilla`), and `persistence:` narrows to the data-access library only.
2. **Default domain** when unspecified on `platform: phoenix` — **`ash`**
   (matches today's `phoenixLiveView` behaviour after desugar). PINNED — now
   expressed as `foundation: ash` (the default) per D-REALIZATION-AXES.

**Affects.** `embedded-frontend-composition.md` §6 (its "retire
`phoenixLiveView`" is this decision's framework half); `elixir-ecto-and-api-only-backends.md`
§4 + §6 (supersedes its D-PHOENIX-ECTO Option-B "sibling platform name" with
"one `phoenix` platform + the domain axis on the D-ADAPTER-HOME surface"); the
`Platform` grammar enum + `Framework` enum; `src/platform/registry.ts`;
`checkDeployable`; **depends on D-ADAPTER-HOME** (the domain axis *is* that
surface's menu/default).

**Amended by D-REALIZATION-AXES.** Its *mechanism* for the domain axis — "rides
the `style:`/`persistence:` surface, no new keyword" — is superseded: the axis
gets the dedicated keyword `foundation:` so the data layer stays pickable under a
framework (`foundation: ash` + `persistence: ashSqlite`). Every *other*
conclusion of this decision stands (one `phoenix` platform, no `family@version`,
no `apiOnly`, `framework:` is UI-only, default domain = Ash).

---

## D-REALIZATION-AXES — the deployable platform-config axes (and the `foundation:` amendment)

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.
>
> **Superseded (2026): the realization block was pruned to two axes.** The bundle-decomposition instinct below stands, but four of the six axes were inert or theater and were removed, leaving only the two with real per-backend choice — **`persistence`** and **`directoryLayout`**. Removed: `foundation:` (single value `vanilla` everywhere — grammar clause, `DeployableIR.foundation`, the R4/R6 rules, the `foundation-default-flipping` warning all deleted); `application:`/style (each backend has one fixed emission style — `cqrs` on dotnet, `layered` elsewhere — kept as an internal `StyleAdapter`, no longer a user knob); and `transport:`/`runtime:` (name-only `TransportAdapter`/`RuntimeAdapter` registries that no emitter ever read — pure validation theater, deleted whole). Every reserved *stub* adapter (`marten`/`jooq`/`axon`/`minimalApi`/`orleans`/`genserver`/`worker`/the `cqrs`/`flat`/`layered` style stubs) was removed too — a stub that throws on `emit*` is speculative-generality debt, not a shipped capability. All `foundation:`/`application:`/`transport:`/`runtime:` reasoning below (the amendment, ownership rules, rung table, gating matrix, the R2–R7 rules) is historical.

**Status:** PINNED. (Amends **D-PHOENIX-SURFACE**'s domain-axis mechanism;
depends on **D-ADAPTER-HOME** and **D-STORAGE-SPLIT**. Full matrix, gating rules,
and examples in `proposals/platform-realization-axes.md`.)

**Problem.** `platform: dotnet` bundles EF Core + MediatR-CQRS + minimal API with
no exposed knobs (`storage-and-platform-config.md:58`). The decomposition into
`platform: <name> { … }` config needs (a) a fixed, reviewed *vocabulary* of
axes, and (b) a resolution of D-PHOENIX-SURFACE open-item 1 (where the Ash/Ecto
domain-framework axis lives). The storage doc's `style:`/`layout:` names are
weak/colliding, and folding the domain framework into `persistence:` destroys the
ability to pick the data layer *underneath* a framework.

**Decision.** A backend deployable's realization is **six orthogonal, optional,
validator-gated axes**, each named for the layer it realizes. Each is a
menu+default exposed off the backend's `PlatformSurface` (D-ADAPTER-HOME); a bare
`platform: <name>` equals the full default block (byte-identical to today).

| Axis | Realizes | Values (dotnet shown; menu is per-platform) | Default |
|---|---|---|---|
| `foundation:` | opinionated domain/app framework, or none | `vanilla` · `abp` (phoenix/elixir: `vanilla` only — `ash` removed; node: `vanilla` · `nestjs`) | `vanilla` (phoenix/elixir: `vanilla`) |
| `application:` | application-layer orchestration topology | `flat` · `serviceLayer` · `cqrs` | `cqrs` |
| `persistence:` | data-access library only | `efcore` · `dapper` · `marten` | `efcore` |
| `directoryLayout:` | source-tree organization | `byLayer` · `byFeature` | `byLayer` |
| `transport:` | HTTP surface | `controllers` · `minimalApi` | `controllers` (the attribute-routed `[ApiController]` surface the backend has always emitted; the labels were historically inverted and swapped 2026-06-10 — `minimalApi` is the reserved/unbuilt alternative) |
| `runtime:` | aggregate execution / concurrency model | `transactional` · `orleans` · `akka` (phoenix: `transactional` · `genserver`) | `transactional` |

**Rulings folded in:**

- **`foundation:` is its own keyword** — *this is the amendment to
  D-PHOENIX-SURFACE.* The Ash/Ecto (and EF/ABP, Drizzle/NestJS) domain-framework
  axis is **not** a `persistence:`/`style:` value; it is `foundation:` (default
  `vanilla`). This keeps the data layer pickable under a framework
  (`foundation: ash` + `persistence: ashSqlite`; `foundation: abp` +
  `persistence: dapper`). It preserves D-PHOENIX-SURFACE's correct **no
  `domain:` keyword** instinct — `foundation:` names the framework hosting the
  domain, not the domain (which is the `.ddd` source).
- **`persistence:` narrows** to the data-access library only (no domain
  framework). Prefer it over "dal" (dated acronym).
- **`style:` → `application:`** (layer-named; not `layering:`, which collides
  with its own value and miscasts CQRS). Values are a topology spectrum
  `flat` → `serviceLayer` → `cqrs`. `flat` (not `transactionScript` — that is an
  orthogonal logic-organization pattern spanning all three values; Loom is
  domain-model by construction so that axis is pinned and unexposed).
- **`layout:` → `directoryLayout:`** (explicit; disambiguates from the
  page-level `layout:` wrapper — a real collision).
- **`runtime:` default is `transactional`** (names the DB-transaction
  consistency model; the contrast to actor-mailbox serialization), not the
  earlier coinage `pooled`.
- **Foundation owns layers.** Each `foundation:` value declares which of
  `{application, transport, persistence-flavor}` it owns; setting an owned knob
  is an error. `vanilla` owns nothing.
- **Actor runtimes need a durable store, not necessarily a journal** — event
  sourcing is idiomatic for persistent actors, not required (Akka.NET + EF via a
  `DbContextFactory` is a valid, non-standard state-stored mode). `flat` × actor
  runtime is a *warning*, not an error.

All axes are **optional**; lowering normalizes each omitted knob to its platform
default, so the IR carries concrete values and `ddd snapshot` round-trips the
normalized form (mirrors `design:` via `BUILTIN_PACK_LATEST`).

**Affects.** `proposals/platform-realization-axes.md` (the full spec);
`proposals/storage-and-platform-config.md` (its `style:`/`layout:` names and the
"`platform: dotnet` defaults" row are renamed per this decision);
`proposals/elixir-ecto-and-api-only-backends.md` (its Phase-2 "`style:` vs
`persistence:` field" question is answered: `foundation:`); the `Platform` /
deployable grammar; `DeployableIR`; `checkDeployable`; each backend's
`PlatformSurface` (menu+default fields). **Amends D-PHOENIX-SURFACE** open-item 1;
**depends on D-ADAPTER-HOME**.

---

## D-VANILLA-PHOENIX-FOUNDATION — `foundation: vanilla` is added to the Elixir foundation menu

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the foundation menu lives
on `platform: elixir` after the rename; "Phoenix menu" wording below refers to
the same surface). The decision's substance — `foundation: vanilla` as a
first-class second adapter on the Elixir backend, `foundation: ash` remaining
the default, the validator R5 gate — is unchanged. (Concretises one menu slot of
**D-REALIZATION-AXES**; spec in `proposals/vanilla-phoenix-foundation.md`.)

**Problem.** D-REALIZATION-AXES pinned the `foundation:` axis with `phoenix: ash ·
vanilla` as the menu, but the validator (`src/language/validators/data/platform-rules.ts:184`)
currently returns the single-element `["ash"]` and the lowerer
(`src/ir/lower/lower-platform.ts:46`) defaults to `ash` — `vanilla` is a planned
value with no emitter behind it. Two operationally distinct strains on
`foundation: ash` motivate building the second emitter:

1. **Exception-less alignment.** A4 of `proposals/exception-less.md` deletes
   route-layer try/catch towers on every backend in favour of variant dispatch
   on typed `or`-union returns. The current Phoenix emitter has the tower as a
   design feature (`Plug.ErrorHandler` translates `Ash.Error.Invalid` → 422,
   `Ash.Error.Forbidden` → 403, `Ash.Error.Query.NotFound` → 404).  Vanilla
   Ecto's `{:ok, _} | {:error, changeset}` is the natural typed-error carrier;
   the tower collapses into per-variant `with`-block dispatch (the same shape
   TS/.NET adopt post-A4).
2. **Pure event sourcing.** The cross-backend pure-ES contract (no state
   table, per-aggregate `<agg>_events` stream, fold-on-load, emit-and-apply
   command bodies) is live on Hono/Drizzle, Hono/MikroORM, .NET/EF, and
   .NET/Dapper. Under `foundation: ash` there is no clean fit — AshEvents is
   hybrid (state table, single centralised event log, action-wrapping);
   AshCommanded is closer but heavy; a custom `Ash.DataLayer` over event
   streams is months of work (re-implements AshCommanded's internals).

Both strains are **Ash-foundation limitations, not Phoenix-platform
limitations** — Phoenix itself (Plug + Endpoint + Router + LiveView) is
domain-layer-agnostic; what doesn't fit is `Ash.Resource`'s changeset-shaped
action model + `Ash.DataLayer`'s queryable-store callback contract.

**Decision.** `foundation: vanilla` is added to the Phoenix menu as a
first-class second adapter. Emits plain `Phoenix.Endpoint` + `Phoenix.Router` +
LiveView over plain `Ecto.Schema` / `Ecto.Changeset` / `Ecto.Repo` — no
`Ash.Resource`, no `AshPostgres`, no `AshPhoenix.Form`. The existing
`foundation: ash` path is unchanged and remains first-class; neither is
deprecated.

**Affects.** `src/language/validators/data/platform-rules.ts:184` (lift the
single-element menu); `src/ir/lower/lower-platform.ts:46` (keep `ash` default —
see D-VANILLA-DEFAULT); a new `src/generator/phoenix-live-view/vanilla/`
subtree (sibling emitters: `schema-emit`, `changeset-emit`, `policy-emit`,
`context-emit`, `repository-emit`, `vanilla/api-emit`,
`vanilla/problem-details-emit`); a new `ecto-postgres-persistence` adapter; the
strict-parity conformance gate. **Depends on D-REALIZATION-AXES**;
**enables D-VANILLA-ES-HOME**.

---

## D-VANILLA-ES-HOME — pure event sourcing on Elixir lands only under `foundation: vanilla`

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the gap lives on
`platform: elixir` after the rename; the Ash-foundation-vs-Phoenix-platform
distinction in this decision's body is unchanged — the constraint is the
Ash *foundation*, on the Elixir *platform*). (Resolves the
`EVENT_SOURCING_BACKENDS` Elixir gap left open in
`proposals/workflow-and-applier.md`; **depends on
D-VANILLA-PHOENIX-FOUNDATION**.)

**Problem.** `validateEventSourcedStorage` (`src/ir/validate/checks/system-checks.ts`)
rejects `persistedAs: eventLog` aggregates on Phoenix today;
`ash-postgres-persistence.ts:60` advertises `supportedStrategies: ["state"]`
only. Once vanilla exists, the gate can lift on a foundation-sensitive basis —
but the question of *whether to also pursue Ash-foundation ES* (via AshEvents
adoption, AshCommanded adoption, or a custom `Ash.DataLayer`) is independent
and material.

**Decision.** Pure event sourcing on Phoenix lands **only** under `foundation:
vanilla`. `foundation: ash` + `persistedAs: eventLog` stays a hard error after
vanilla ships, with a structured diagnostic naming the Ash foundation as the
constraint and pointing the user at `foundation: vanilla` or a non-Phoenix
backend. The following alternatives are **explicitly not pursued**:

- **AshEvents adoption.** Its hybrid model (state table + centralised event
  log + action-wrapping + manual whole-resource replay) diverges from Loom's
  pure per-aggregate-stream / fold-on-load contract. Reconciling would force
  either a divergent Phoenix semantics or a fight-the-grain projection.
- **AshCommanded adoption.** Closest match semantically (Commanded aggregates
  + apply/2 + per-aggregate streams) but ships heavy infrastructure
  (Commanded + EventStore Postgres) for a single foundation, when the vanilla
  path achieves the same contract zero-dep.
- **Custom `Ash.DataLayer` over event streams.** Re-implements AshCommanded
  internals; ~months of work; half-bridges leak (`AshPhoenix.Form`,
  `AshGraphql`, `AshJsonApi`, relationships all assume the data layer answers
  queries about current state).

Rationale: the cross-backend pure-ES contract is live on four paths already
(Hono/Drizzle, Hono/MikroORM, .NET/EF, .NET/Dapper); vanilla joins them as a
fifth port of a proven shape (~2–4 days of work). The Ash paths each carry
multi-week-to-month costs to land *partial* fits. Routing ES through vanilla
costs nothing additional once vanilla exists.

**Affects.** `src/ir/validate/checks/system-checks.ts`
(`EVENT_SOURCING_BACKENDS` un-gate gains a foundation predicate — `phoenix` +
`foundation: vanilla` only); `test/ir/eventsourced-storage-support.test.ts`
(extend the matrix); the structured diagnostic from
`proposals/vanilla-phoenix-foundation.md` P0; `MigrationsIR` consumers (the
shared `<agg>_events` shape extends to the Ecto migrations renderer in P4).
**Depends on D-VANILLA-PHOENIX-FOUNDATION**.

---

## D-PHOENIX-FOUNDATION-ROUTING — Phoenix feature parity is reached by routing to `vanilla`, not by investing in Ash

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — ratified 2026-06 (backend feature-parity plan, W4).
Generalises **D-VANILLA-ES-HOME** from event sourcing to *every* feature with
no idiomatic Ash fit; **depends on D-VANILLA-PHOENIX-FOUNDATION**.

**Problem.** Several features (event-sourced storage, event-sourced workflows,
provenanced fields, full `shape: document` ops, `emit`/`add`/`remove`-bodied
`or`-union-returning ops) emit cleanly on `foundation: vanilla` but have **no
idiomatic Ash fit**. The recurring question is whether to close the
Phoenix-side gap by routing those contexts to `vanilla` (treating the `ash`
gates as the deliberate final answer) **or** by investing in an Ash-idiomatic
emission (AshEvents/AshCommanded for ES, an Ash `:map` document, an Ash
provenance extension, a custom `Ash.DataLayer`).

**Decision.** **Route, don't invest.** "Full parity" on Phoenix is reached by
`foundation: vanilla` for these features; `foundation: ash` keeps each one a
**fail-fast validator error** that names the constraint and points at
`foundation: vanilla` (never a silent downgrade). The Ash-side build-out is
**explicitly out of scope** — the cost is multi-week-to-month for *partial*
fits (see the "explicitly not pursued" list in D-VANILLA-ES-HOME), against a
zero-additional-cost vanilla port of a proven cross-backend shape. This is the
canonical case that "parity" means *emitted **or** fail-fast-gated*, not "every
backend emits every feature" (`plans/backend-parity-plan.md`).

**Already in place (no new compiler work).** Every routed feature already
emits on vanilla and gates on ash today: ES storage/workflows
(`EVENT_SOURCING_BACKENDS` + foundation predicate), provenance
(`PROVENANCE_BACKENDS` + `validateProvenancedStorage`), document-CRUD
(`loom.vanilla-document-unsupported`), returning-op bodies
(`loom.operation-return-unsupported`). Each is compiled against real
Elixir/Ecto by `elixir-vanilla-build.yml`. W4 is therefore a **documentation +
ratification** workstream, not an emission one.

**Affects.** `docs/platforms.md` (the *Phoenix foundations* routing table);
`docs/generators.md` (the five-backend matrix's `elixir·ash` / `elixir·vanilla`
columns); the `loom.*` gate diagnostics already cited above (unchanged — this
decision ratifies their finality).

---

## D-NO-MIXED-FOUNDATION — one foundation per deployable; per-aggregate override not added

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (substance unchanged;
`platform: phoenix` references in the body now read `platform: elixir`
post-rename). (Structural consequence of **D-REALIZATION-AXES** + the
deployable model; recorded explicitly to forestall the per-aggregate override
extension request.)

**Problem.** A natural-sounding feature request is "let me keep Ash resources
for state-based aggregates and use vanilla emit for the ES aggregate in the
*same* deployable." The motivation is real (some domains genuinely mix
state-based-CRUD aggregates with one or two ES aggregates), but the
implementation cost compounds at every call site: workflow bodies branch on
per-aggregate strategy, forms split between `AshPhoenix.Form` and stock
`to_form(changeset)`, authorization splits between Ash policies and plain
guard functions, telemetry emission splits between Ash trace events and
hand-emitted equivalents.

**Decision.** A single deployable carries one `foundation` value. Per-aggregate
`foundation` override is **not** added.

**Crucially: this is a structural consequence, not an additional policy.**
Under D-REALIZATION-AXES, `foundation:` is a **per-deployable axis** on the
deployable's `platform:` config block (each deployable declares one platform
with one foundation). The per-deployable scope of the axis *already* makes
mixed foundation within a deployable inexpressible in the grammar — this
decision merely confirms the architecture won't grow a per-aggregate escape
hatch, with the rationale that the plumbing cost (above) outweighs the
mixed-foundation use case.

Users who need both Ash-resource and pure-ES aggregates have two principled
paths:

1. **Split bounded contexts across deployables.** State-based contexts deploy
   under `foundation: ash`; ES contexts deploy under `foundation: vanilla`.
   Each deployable is internally coherent; cross-deployable consumption uses
   the api surface as on any cross-deployable boundary.
2. **Pick `foundation: vanilla` for the whole deployable.** State-based
   aggregates emit as plain Ecto schemas (no loss vs Ash for simple CRUD);
   ES aggregates emit as fold+repository. Single mental model.

**Affects.** `proposals/vanilla-phoenix-foundation.md` (the "Mixed-mode within a
context" section is the conversational origin of this decision). No grammar
change required (the constraint is already structural); no validator rule
needed beyond today's per-deployable `foundation:` typing.

---

## D-VANILLA-DEFAULT — vanilla becomes Elixir default after stabilisation, not on first ship

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the default-flip target
is `platform: elixir` after the rename; sequencing and rationale unchanged).
(Sequences the default-flip of **D-VANILLA-PHOENIX-FOUNDATION**; deferred to a
later release than vanilla's initial ship.)

**Problem.** Today's Phoenix default is `foundation: ash`
(`lower-platform.ts:46`). Once vanilla ships and exception-less A4 is in
place, vanilla is objectively the lower-friction default — no
`Plug.ErrorHandler` rescue tower, direct typed-error mapping, broader contract
coverage (ES + state). But flipping the default in the *same* release that
introduces vanilla risks two things: (a) silent emit-shape change for every
bare-`platform: phoenix` deployable that hasn't been re-validated against
vanilla; (b) regression discovery happening in production before vanilla has
seen real usage.

**Decision.** Vanilla ships **opt-in only initially**. The default stays
`foundation: ash` for at least one minor release after vanilla lands. The flip
is gated on two operational signals:

1. Vanilla has run **at least one minor-release cycle with green CI** —
   `phoenix-vanilla-build.yml` (`mix compile --warnings-as-errors`) and the
   strict-parity matrix entry pass cleanly without ongoing-fix churn.
2. **No obs-e2e regressions** observed on `phoenix-obs-e2e.yml` (vanilla
   variant) for the same cycle.

When both signals are clear, flip in two steps:

1. **Warn-then-flip release.** Emit a `loom.foundation-default-flipping`
   warning on every bare `platform: phoenix` (no explicit `foundation:`)
   for one release cycle, telling the user to set explicit `ash` if they
   want to stay on the current behaviour.
2. **Flip release.** Change `lower-platform.ts:46`'s default from `ash` to
   `vanilla`. Users who didn't act on the warning get vanilla emit; the
   one-line escape hatch (`foundation: ash`) remains supported and
   first-class.

Rationale: zero-surprise migration; opt-in window gives real users time to
validate vanilla before it becomes the default emission; the warning cycle
makes the change visible without breaking anyone's build.

**Affects.** `src/ir/lower/lower-platform.ts:46` (default flip, gated on
release sequencing); `src/language/validators/data/platform-rules.ts`
(`loom.foundation-default-flipping` warning during the warn cycle); release
notes for the two flip-related releases. **Depends on
D-VANILLA-PHOENIX-FOUNDATION**.

---

## D-NODE-PLATFORM — `node` is the JS-runtime platform; `hono` is a `transport:` value

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (this decision's body
asserts *"`dotnet`/`phoenix` name the language-ecosystem"* — a rationalisation,
since `phoenix` is a web framework, not a language-ecosystem; the actual
ecosystem is **Elixir**. D-ELIXIR-PLATFORM completes the rename pattern by
making `elixir` the canonical language-ecosystem platform and `phoenix` a
back-compat alias. The framing in the original problem statement should now
be read as *"`dotnet`/`elixir` name the language-ecosystem"*.) (Mirrors
**D-PHOENIX-SURFACE**'s rename pattern; depends on **D-REALIZATION-AXES** for
the `transport:` axis. Rollout in `proposals/realization-axes-rollout.md`
Phase 3.)

**Amendment (alias retired).** The `hono` → `node` back-compat alias described
below has since been **removed** — `node` is now the only spelling. The
`hono` keyword is gone from the grammar `Platform` rule, `LEGACY_PLATFORM_ALIASES`
(`src/platform/metadata.ts`) and `canonicalPlatform` (`src/ir/lower/lower-platform.ts`)
no longer map it, and `platform: hono` / `platform: "hono@v4"` now fail validation
as unknown platforms. All in-tree sources, fixtures and docs were migrated to
`platform: node`. The Hono web framework keeps its name only as the `transport:`
value on `platform: node` (and as the `src/platform/hono/` / `@loom/backend-hono-v4`
package directory). The historical body below is preserved as the original
rationale for the rename.

**Problem.** `platform: hono` conflates the **JS runtime** (Node) with the **web
framework** (Hono) in one token — the same conflation just resolved for
`phoenixLiveView`. `dotnet` / `phoenix` name the language-ecosystem; `hono` names
only *one of several* interchangeable TS web frameworks (Hono / Express /
Fastify / Elysia). The codebase already splits these: language codegen lives in
`src/generator/typescript/`, while `src/platform/hono/` is the Hono web-framework
backend.

**Decision.**

- **`node` is the canonical JS-runtime platform** (language TypeScript, *derived*
  — not a name prefix; cf. `dotnet` is not `csharp-dotnet`). Legacy
  `platform: hono` is admitted as a **back-compat alias** that desugars to
  `platform: node { transport: hono }` (same mechanism as `phoenixLiveView` →
  `phoenix`).
- **The web framework is the `transport:` axis** (D-REALIZATION-AXES). `node`'s
  menu: `hono`\* · `express` · `fastify` · `elysia`; default `hono`. (`dotnet`
  transport stays `minimalApi`\*·`controllers`; `phoenix` `phoenixRouter`\*.)
- **NestJS is a `foundation:` value** (rung-3): it owns application + transport
  and runs on an underlying http adapter, so `foundation: nestjs` locks
  `transport:` via R4 — identical shape to `foundation: abp` on dotnet.
- **`language` is a derived surface property** (`typescript` for `node`/`react`,
  `csharp` for `dotnet`, `elixir` for `phoenix`), consumed by the Phase-F
  shared-contracts grouping — *not* a platform-name prefix.
- **Future JS runtimes** (`bun` / `deno` / `edge`) are **sibling `platform:`
  values** (distinct stdlib/deploy), all TypeScript — not a `typescript-X`
  prefix and not a new sub-axis.

**Affects.** `src/platform/registry.ts` (add `node`, alias `hono`→`node`); the
`Platform` IR union + grammar `Platform` rule (add `node`, keep `hono` as
back-compat keyword); the `transport:` menu (`hono` becomes its default value);
`src/platform/hono/` (reframed as node's Hono transport); the derived `language`
property on `PlatformSurface`. **Depends on D-REALIZATION-AXES**; mirrors
**D-PHOENIX-SURFACE**.

---

## D-ELIXIR-PLATFORM — `elixir` is the canonical language-ecosystem platform; `phoenix` is a back-compat alias

**Status:** PINNED. (Mirrors **D-NODE-PLATFORM**'s rename pattern; amends
**D-PHOENIX-SURFACE**'s platform-name choice; depends on **D-REALIZATION-AXES**
for the `transport:` axis. Spec in `proposals/elixir-platform-rename.md`.)

**Amendment (alias retired).** The `phoenix` / `phoenixLiveView` → `elixir`
back-compat platform aliases described below have since been **removed** —
`elixir` is now the only spelling, exactly mirroring the retired `hono` →
`node` alias (D-NODE-PLATFORM). The `phoenix` and `phoenixLiveView` keywords
are gone from the grammar `Platform` rule, `LEGACY_PLATFORM_ALIASES`
(`src/platform/metadata.ts`) and `canonicalPlatform`
(`src/ir/lower/lower-platform.ts`) no longer map them, and `platform: phoenix`
/ `platform: "phoenixLiveView"` now fail validation as unknown platforms. All
in-tree sources, fixtures and tests were migrated to `platform: elixir`. The
Phoenix web framework keeps its name only as the `transport: phoenix` value
(D-PHOENIX-TRANSPORT) and the `phoenixLiveView` **framework** value (with its
`liveview` alias, D-PHOENIX-SURFACE — *not* retired); the `ashPhoenix` design
pack and the generated-project code likewise keep the framework name. The
historical body below is preserved as the original rationale for the rename.

**Problem.** D-NODE-PLATFORM (the later decision) renamed `platform: hono` →
`platform: node` on the principle that *platform names the language-ecosystem,
transport names the web framework*. Its own text justifies itself by asserting
*"`dotnet`/`phoenix` name the language-ecosystem"* (decisions.md:1072) — a
rationalisation, since `phoenix` is a web framework, not a language-ecosystem.
The actual ecosystem is **Elixir**.

The result was visible repetition: `platform: phoenix, transport: phoenixRouter`
reads as "Phoenix Phoenix" — two restatements of the same framework. And the
generator scaffolding around the platform name (`src/generator/phoenix-live-view/`
the directory, `src/platform/phoenix-live-view.ts` the module, `phoenix-build.yml`
the CI workflow) carried the legacy `phoenixLiveView`-era spelling that
D-PHOENIX-SURFACE retired at the *platform name* level but never followed
through at the *scaffolding* level.

**Decision.**

- **`elixir` is the canonical language-ecosystem platform**. The platform
  surface that emits the fullstack Elixir/Ash + Phoenix LiveView project
  registers under `elixir` in `src/platform/registry.ts`.
- **`phoenix` and `phoenixLiveView` are back-compat aliases** that desugar to
  `elixir` at the lowering boundary (`canonicalPlatform` /
  `LEGACY_PLATFORM_ALIASES`), preserving any `@version` pin
  (`phoenix@v1` → `elixir@v1`; `phoenixLiveView@v1` → `elixir@v1`). Every
  existing `.ddd` source continues to parse, validate, lower, and emit
  byte-identical output. Identical mechanism to `hono` → `node`
  (D-NODE-PLATFORM).
- **`language` is a derived surface property** (`elixir` for `elixir`,
  `typescript` for `node`/`react`, `csharp` for `dotnet`), consumed by the
  Phase-F shared-contracts grouping — *not* a platform-name prefix. Matches
  D-NODE-PLATFORM's framing now that `phoenix` is no longer the platform.

**Affects.** `src/platform/registry.ts` (register under `elixir`; add `phoenix`
and `phoenixLiveView` to `LEGACY_PLATFORM_ALIASES`); the `Platform` IR union
(`"phoenix"` → `"elixir"`); grammar `Platform` rule (add `elixir` keyword);
`src/ir/lower/lower-platform.ts` (`canonicalPlatform` adds the `phoenix`
arm); every `family === "phoenix"` check across the toolchain (renamed to
`"elixir"`); CLI `--platform` (canonical `elixir`, `phoenix` accepted as
alias); the seven affected decisions get an amend-by-this-one note.
**Mirrors D-NODE-PLATFORM**; **amends D-PHOENIX-SURFACE**.

---

## D-PHOENIX-TRANSPORT — Phoenix is the `transport:` value on `platform: elixir`; `phoenixRouter` is a back-compat alias

**Status:** PINNED. (Depends on **D-ELIXIR-PLATFORM** and **D-REALIZATION-AXES**;
spec in `proposals/elixir-platform-rename.md`.)

**Amendment (alias retired).** The `phoenixRouter` → `phoenix` back-compat
transport alias described below has since been **removed** — `phoenix` is the
only `transport:` value now. The `canonicalTransport` desugar helper (which was
already dead code — nothing called it) is gone, and `transport: phoenixRouter`
no longer resolves to any adapter (it fails the realization-axes menu check
like any unknown transport). Mirrors the retired platform aliases
(`hono`/`phoenix`/`fastapi`) and the `liveview` framework alias.

**Problem.** The transport value `phoenixRouter` carried a redundant `Router`
suffix that named no real distinction (Phoenix has one router; there's no
"Phoenix-but-not-the-router" alternative). Under `foundation: ash` the
transport axis is owned (`FOUNDATION_OWNED_AXES.ash = ["application",
"transport"]`), so users never even wrote it. It existed only as a default
value in the IR — repeating the framework name with no information added.

**Decision.**

- **`phoenix` is the canonical `transport:` value** on `platform: elixir`
  (D-ELIXIR-PLATFORM). Names the Phoenix web framework, parallel to how
  `transport: hono` names the Hono web framework on `platform: node`.
- **`phoenixRouter` is a back-compat alias** that desugars to `phoenix` at
  the lowering boundary (`canonicalTransport` in
  `src/ir/lower/lower-platform.ts`). Every existing source with explicit
  `transport: phoenixRouter` keeps working unchanged.
- **Future Elixir web frameworks** (a Plug-only minimal API, hypothetical
  alternatives) slot into `transport:` as siblings; the menu grows from
  size-1 to size-N without a platform-level change.

**Affects.** `src/ir/lower/lower-platform.ts` (new `canonicalTransport` +
`greenfieldMenu` returns `"phoenix"` for `elixir`); `src/language/validators/data/platform-rules.ts`
(transport menu update); test expectations across the lowering / axes test
files; `proposals/elixir-platform-rename.md`. **Depends on
D-ELIXIR-PLATFORM**.

---

## D-PHOENIX-DIR — generator directory + platform module + CI workflow renames

**Status:** PINNED. (Mechanical completion of the D-ELIXIR-PLATFORM rename;
spec in `proposals/elixir-platform-rename.md`.)

**Problem.** When D-PHOENIX-SURFACE renamed `platform: phoenixLiveView` →
`platform: phoenix`, the legacy directory `src/generator/phoenix-live-view/`,
the platform module `src/platform/phoenix-live-view.ts`, and the CI workflows
`phoenix-*.yml` were not renamed alongside. After D-ELIXIR-PLATFORM the
debt compounds: the LiveView part of the name is no longer accurate (the
emitter outputs the whole Phoenix project — API controllers, OpenAPI,
shell scaffolding — most of which has nothing to do with LiveView), and
the `phoenix` part needs to align with the new `elixir` platform name.

**Decision.** Three coordinated renames, no back-compat alias at the
directory / module / workflow level (callers reach these through the
registered platform surface and the CI matrix, not directly):

| Today | After |
|---|---|
| `src/generator/phoenix-live-view/` | `src/generator/elixir/` |
| `src/platform/phoenix-live-view.ts` | `src/platform/elixir.ts` |
| `generatePhoenixLiveViewProject` | `generateElixirProject` |
| `GeneratePhoenixLiveViewArgs` | `GenerateElixirArgs` |
| `phoenixPlatform` (registry alias) | `elixirPlatform` |
| `.github/workflows/phoenix-build.yml` | `.github/workflows/elixir-ash-build.yml` |
| `.github/workflows/phoenix-dialyzer.yml` | `.github/workflows/elixir-ash-dialyzer.yml` |
| `.github/workflows/phoenix-obs-e2e.yml` | `.github/workflows/elixir-ash-obs-e2e.yml` |

The CI rename uses the `elixir-ash-` prefix (foundation in the name) so a
future `elixir-vanilla-build.yml` pairs cleanly when P2 of
`vanilla-phoenix-foundation.md` ships.

**Affects.** ~80 import paths across `src/` and `test/` (mechanical `sed`,
TypeScript imports resolve through the rename); workflow display names
updated alongside (`Phoenix LiveView build verification` → `Elixir / Ash
build verification`, etc.). The `ashPhoenix` design pack name is **not**
renamed in this pass — its foundation-aware rework belongs to P2 of
`vanilla-phoenix-foundation.md`. **Depends on D-ELIXIR-PLATFORM**.

---

## D-SEED-PATH — seed rows go through the domain `create`

**Status:** PINNED.

**Problem.** `database-seeding.md` must pick how a declarative seed row
reaches the database. Target frameworks split: EF `HasData` and Drizzle
`insert` go *straight to tables*; Ash goes *through actions* (enforcing
changesets). Loom needs one default.

**Decision.** Seed rows lower through the aggregate's **canonical
`create`** by default — the same path a real request takes — so
invariants and create-time logic run, and a seed that violates an
invariant is caught at boot rather than producing a corrupt row. A
`seed raw { … }` modifier opts a block into table-level inserts for
bulk fixtures where the domain pass is deliberately bypassed (or too
slow); `raw` carries a `loom.seed-raw-unchecked` warning when a value
would fail an invariant.

**Rationale.**

- The domain `create` already encodes the invariants; bypassing it to
  insert rows is the same mistake as letting an API skip validation.
- Ash's native seed idiom is `Ash.create!`; routing through `create`
  makes the Loom surface map cleanly onto the most-opinionated backend
  rather than the least.
- `raw` keeps the escape hatch explicit and visible, not the default.

**Consequences.** `SeedIR.path: "domain" | "raw"`; the declarative
record shape is the aggregate's **`create`-parameter shape** (no `id`
field — the framework mints ids). Object graphs built by *operations*
(not create params) are the imperative-body's job, not the declarative
form's.

**Affects.** `database-seeding.md` §2 (D-SEED-PATH), §3.2, §6 (per-
backend emitters), §8 (`loom.seed-raw-unchecked`).

---

## D-SEED-IDEMPOTENCY — v1 is ship-once via a dataset marker

**Status:** PINNED.

**Problem.** Re-running a seed must not duplicate rows. Two mechanisms
were on the table: (a) an applied-**marker** table; (b) per-row
**upsert** by a declared natural key.

**Decision.** v1 is **ship-once via an applied-marker**: a `__loom_seed`
table holds one row per applied `(module, dataset)`; the seeder skips
the whole set on boot if the marker is present. This matches the Rails
`db:seed` / Ecto `seeds.exs` contract, needs no natural key on the
rows, and covers the quick-start demo entirely. Editing an
already-applied seed has no effect until the marker is cleared
(`ddd seed --reset <dataset>`); seeding is forward-only, mirroring the
migrations stance.

Per-row **upsert by a declared natural key** (`key Aggregate.field`),
for *reference* data corrected in place over time, is **deferred** — it
adds a second idempotency mechanism, a grammar clause, a validation
rule, and a per-backend upsert branch, and earns its keep only once a
model actually has evolving lookup data. The grammar reserves the slot
(`seed <dataset> key Aggregate.field`) so it lands additively later.

**Rationale.**

- The driving use case (first-boot demo content) is served by the
  marker alone; the marker is the smaller, simpler mechanism.
- Marker-by-content-hash was rejected: re-applying forward-only
  `create`s on a changed set just collides on existing rows — the very
  thing upsert would fix — so hashing buys nothing without also buying
  upsert. Keying the marker by *dataset name* sidesteps it.

**Consequences.** No `key`/`contentHash` in `SeedIR` for v1; the marker
table is emitted as a synthetic `createTable` step by the owning
module's migration pass. `LOOM_SEED` gates which datasets run.

**Affects.** `database-seeding.md` §2 (D-SEED-IDEMPOTENCY), §7, §10
(deferred upsert), build-order §11 phase 6.

---

## D-SEED-XREF — seed cross-references are explicit ids (no `@handle`)

**Status:** PINNED.

**Problem.** Declarative seed data sometimes needs to relate rows (an
`Order` referencing a `Customer`). How does a referencing row name the
referenced row's id?

**Decision.** **Explicit ids on the `raw` path** — the declarative-fixture
model of Django fixtures, EF Core `HasData`, and raw SQL. A `raw` row is a
literal record (explicit `id` + literal FK columns) inserted directly,
bypassing the domain `create`; the author writes the same literal id in the
referenced row and the referencing FK, and orders parents before children.
No bespoke handle/reference construct, no topological reorder.

A symbolic-reference form (`Customer @acme { … }` / `Order { customerId:
@acme }`, lowering to a `SeedRef` ExprIR + topo-sort) was prototyped and
**dropped**: no concrete stack has it (imperative seeders use host-language
local variables; declarative ones use explicit ids), it duplicates what the
imperative body's `let` bindings already give for free, and it spread a new
`ExprIR` variant + topo-sort + three validators across the toolchain for a
convenience neither camp felt the need to invent.

**Consequences.** The default **domain** path mints ids and therefore has no
cross-references (a minted id isn't knowable to reference) — flat demo /
reference data only. Cross-referenced / relational seed data uses **`raw`**.
`SeedRowIR` carries no `handle`; there is no `seed-ref` ExprIR; `SeedIR.rows`
stay in source order.

**Affects.** `database-seeding.md` §3.1/§3.2 (cross-ref design), §5 (IR), §8
(validation), §11 (build order — `raw` path is the cross-ref home).

---

## D-AUTH-OIDC — turnkey auth delegates to OIDC; Loom does not build an auth runtime

**Status:** PINNED.

**Problem.** `quickstart-and-day-one-batteries.md` §4 ("turnkey auth") sketched
a self-built auth runtime: an `auth { providers: [email, google, github] }`
block that makes Loom generate an `AuthUser` aggregate with **hashed
passwords**, signup/login/verify-email endpoints, OAuth clients, session
issuance, and login/signup UI — across Hono, .NET, **and** Phoenix, × four
design packs. That is a large, security-critical, perpetually-maintained
surface for a code generator to own.

**Decision.** Turnkey auth **delegates to an OIDC identity provider**.
**Keycloak** is the self-hostable default; Auth0 / Cognito / Zitadel / Ory /
Entra ID are the same thing to Loom — an `issuer` URL. "Don't roll your own
auth": Loom **validates tokens and maps claims into the existing typed
`user {}` shape**; the IdP owns credential storage, password reset, MFA,
lockout, and the hosted login/signup pages. Loom generates **no `AuthUser`
aggregate, no password column, no OAuth client code** — only an OIDC verifier
(the batteries-included fill-in for the already-shipped
`IUserVerifier` / `registerUserVerifier` seam), the `/auth/login|callback|logout`
redirect handshake, session issuance, and a route guard.

**Rationale.**

- "Don't roll your own auth" is the strongest security guidance in the field;
  passwords/MFA/reset/lockout are deep and ruinous to get wrong.
- OIDC is the universal protocol — every IdP plugs in uniformly behind one
  `issuer`. Loom's per-backend work shrinks to "validate a token" (mature libs
  everywhere: `jose`, `Microsoft.Identity`, `oidcc`/`Ueberauth`) + a redirect.
- It **completes** what `auth.md` already ships (typed `user {}`,
  `currentUser`, `requires`, `auth: required` middleware, the verifier hook)
  rather than adding a new runtime. OIDC is just the batteries-included
  verifier.
- The multi-backend × multi-pack cost of a hand-built password/session/login-UI
  runtime is a maintenance + security liability where any divergence is a
  vulnerability.

**Zero-config quick-start.** The one cost of self-hosted OIDC — standing up an
IdP — is closed by **bundling a dev IdP**: the generated `docker-compose.yml`
adds a Keycloak service with a pre-provisioned realm + a **seeded demo user**
(seeding feature, `database-seeding.md` §5.4), so `docker compose up` logs in
out of the box; production repoints `issuer:` at a real IdP. The on-ramp owns
zero auth logic.

**Consequences.** The `auth {}` surface is reframed from
`providers: [email, google, github]` to `auth { oidc { issuer, clientId, … } }`
+ a `claims:` map. A self-contained email/password mode, if ever wanted, is a
**secondary, library-backed** option — never hand-rolled across backends, and
not the headline. Default-deny enforcement (`enforcement: denyByDefault`) is
unaffected.

**Affects.** `quickstart-and-day-one-batteries.md` §1 (battery list), §3.1
(`saas` template), §4 (entire turnkey-auth section), §7 (build order);
`auth.md` (the verifier-hook seam is OIDC's mount point — no rewrite, just the
completion it always anticipated).

---

## D-AI-EMPHASIS — Loom leads as a platform (mass-market land + regulated expand), IR-embedding deferred

**Status:** PINNED.

**Problem.** [`ai-generation-platform.md`](old/proposals/ai-generation-platform.md)
§4.4/§7 leaves the platform-vs-IR emphasis open. Three coherent paths
were on the table:

- **A — IR-first.** Ship `@loom/core` as the deterministic, multi-stack,
  auditable engine that *other* AI builders embed (B2B2C). Lowest risk,
  plays to the compiler strength, dodges consumer-AI UX — but has no
  direct customer, leans on integrators with weak incentive to adopt a
  DDD compiler that constrains their breadth, and cannot monetise the
  niche that actually values the differentiation.
- **B — Mass-market platform.** Loom's own end-to-end AI generation
  platform competing for the broad "describe an app" market.
- **C — Vertical platform.** The same platform aimed at the regulated /
  domain-heavy / engineering-led niche (fintech, healthtech, govtech),
  where determinism + ownership + multi-stack + governance are
  non-negotiable and the consumer-grade incumbents cannot follow.

**Decision: B + C.** Loom leads as a **first-party platform across both
motions** — a land-and-expand:

- **B is the funnel.** A free/low tier for the broad market is the
  distribution and brand engine. It is winnable *not* on UX polish alone
  but on the genuine differentiators: model-as-memory (no context rot as
  the app grows), determinism (maintainable/upgradable output), multi-stack,
  and code ownership. The pitch is "AI apps that don't collapse at scale and
  that you own," not "a prettier Bolt."
- **C is the revenue.** The regulated/engineering niche is where pricing
  power lives — governance/conformance/provenance reporting, private
  backends, hosted `verify`, SLA'd determinism. B lands these users; C
  expands them.
- **A is deferred, not dropped.** IR-embedding (`@loom/core` as an engine
  other builders license) is a later **channel/partnership** play, reachable
  *from* a proven platform; the reverse climb (embedded engine → owns the
  customer) is much harder.

**Rationale.**

- The emphasis question is **GTM and narrative, not architecture.** Platform
  and IR run the *same* validate→repair→verify loop over the same model
  patches ([`ai-authoring-loop.md`](old/proposals/ai-authoring-loop.md)); the
  wedge demo advances all paths. So committing to B+C costs nothing
  technically and keeps A open.
- Owning the customer (B+C) is the only path that monetises Loom's defensible
  whitespace directly; A buries the differentiation three layers down someone
  else's stack.
- B funds C: the mass-market top-of-funnel supplies the distribution that a
  pure-niche motion lacks, while C supplies the margin a pure-mass motion
  lacks.

**Consequences / honest caveats.** B+C is the **highest-prize and
highest-cost** path, and it leans hardest on Loom's weakest muscle — consumer
AI UX and the capital/team to compete on it. It is justified only if (a) the
on-ramp can be made cheap (grammar-constrained `.ddd` authoring + the
context-pack, `ai-authoring-loop.md` §5) so the engine carries the UX, and
(b) the build sequences the **wedge demo first** (prove the loop end-to-end in
the browser playground) before any mass-market growth spend. If funding/team
for B does not materialise, fall back to **C-only** (vertical-first) rather
than A — keep the direct customer.

**Affects.** `ai-generation-platform.md` §4.4 (reframe the "two strategies,
sequence them" block from IR-first to B+C platform-first with A deferred) and
§7 (resolve the platform-vs-IR open question, citing this tag).

---

## D-API-TOOLKIT — one transport-neutral toolkit core, thin adapters per surface

**Status:** PINNED.

**Problem.** Loom's structured operations (`validate`, `generate`, `patch`,
plus `outline` and the diagnostics/fixHint serializers) were being grown inside
`src/cli/` (`json-report.ts`, `runParseJson`), which is Node-bound. But the
**same operations** are needed by at least four surfaces — the CLI, an MCP
server (agents), the LSP (Monaco/VS Code), and the in-browser playground — and
re-implementing them per surface is exactly the drift the structured contract
exists to prevent. The patch/diagnostic format is also ours
([`ai-diagnostics-contract.md`](old/proposals/ai-diagnostics-contract.md)), not an
editor/agent standard, so it needs *one* authoritative implementation plus thin
adapters at the boundaries.

**Decision.** A single **transport-neutral toolkit at `src/api/`** is the
shared core; every surface is a thin adapter over it.

| Layer | Home | Role |
|---|---|---|
| **Toolkit core** | `src/api/` | `validate(source)→ValidateReport`, `generate(source)→GenerateReport`, `applyPatches(source,patches)→PatchResult`; pure, in-memory, **browser-safe** (parses on `EmptyFileSystem`, no `langium/node`). `src/api/report.ts` holds the diagnostic/outline serializers. |
| **CLI** | `src/cli/` | argv + stdout/exit only; calls the toolkit. |
| **MCP server** | (future) | tool handlers calling the toolkit — the recognized way agents call tools. |
| **LSP adapters** | `src/language/lsp/` | `ModelPatch → WorkspaceEdit/TextEdit`, `fixHint → CodeAction`, `JsonDiagnostic → Diagnostic`. |
| **Web playground** | `web/` | imports the toolkit directly (`../src/api`). |

**Consequences.**
- The CLI shrank to thin wrappers (`runParseJson`/`runGenerateJson` are a few
  lines each); the fat report-building moved out of `src/cli/`.
- `applyPatches` switched `NodeFileSystem` → `EmptyFileSystem`, restoring the
  "`src/language/` is browser-safe" invariant (CLAUDE.md).
- The **node-addressed `ModelPatch` stays the loop-native format** (it survives
  re-printing and joins to diagnostics/outline); LSP/MCP are adapters at the
  edge, so the system is "recognizable by everything" without compromising the
  core.
- A new operation (e.g. `rename`, `verify`) is added **once** in the toolkit and
  every surface inherits it.
- `src/api/` sits above `language`/`ir`/`generator`/`system` (an
  orchestration/entrypoint layer, like `cli`); it is not scanned by the
  pipeline-layering invariant and creates no back-edge.

**Affects.** `ai-diagnostics-contract.md` (`--json` scope note now points at the
toolkit, not the CLI); `ai-authoring-loop.md` §3 (the tool surface is the
toolkit + an MCP transport); future MCP-server and LSP-adapter slices build on
this seam.

---

## D-AGENT-TOOLS — one tool catalog over the toolkit; MCP and in-browser are transports

**Status:** PINNED.

**Problem.** Loom's operations need to be **agent-callable tools**. Two surfaces
want them: external agent hosts (Claude Desktop, IDE agents, CI) via **MCP**, and
the in-browser **playground** agentic chat. An MCP stdio server runs as a Node
subprocess and cannot run in a browser; hand-coding the tool schemas separately
for each surface would let them drift — the same mistake
[D-API-TOOLKIT](#d-api-toolkit--one-transport-neutral-toolkit-core-thin-adapters-per-surface)
fixed one layer down.

**Decision.** A single **transport-neutral tool catalog at `src/tools/`** over
the `src/api/` toolkit is the source of truth; every transport is a thin adapter.

| Layer | Home | Role |
|---|---|---|
| **Tool catalog** | `src/tools/` | `{ name, description, inputSchema (JSON Schema), handler(args)→toolkit }` per tool. Browser-safe (imports only `src/api/` + contract types; **no MCP dependency**). |
| **MCP stdio server** | `packages/ddd-mcp/` | Node entrypoint registering the catalog; for external hosts (`npx ddd-mcp`). |
| **Playground chat** | `web/` | imports the same catalog; dispatches the LLM's `tool_use` calls **directly** to `handler(args)` in-browser. (Optional in-memory MCP for byte-identical parity.) |

**Tools are pure and stateless.** Each tool is a function of its inputs (model
`source` in → report/new-source out); **no server-side model state, no
filesystem side effect.** The host owns the working model and threads it through.
This makes the server safe by default (read-only/functional — no consent
prompts), keeps the browser transport trivial, and inherits the toolkit's
determinism + browser-safety. File emission stays in the CLI, never in a tool.

**Two verb families, one catalog.** (a) **Generative** (the v1 authoring loop,
pure functions of `source`): `loom_validate` `{source}→ValidateReport`,
`loom_apply_patch` `{source,patches}→PatchResult`, `loom_generate`
`{source}→GenerateReport`, `loom_outline` `{source}→Outline`. (b)
**Navigational** (query/refactor over the LSP providers, by-name dotted-symbol
addressing): `loom_find_symbol` / `loom_references` / `loom_hover` /
`loom_rename` / `loom_quickfix` / `loom_unfold_macro` — **edits returned as an
LSP `WorkspaceEdit`, never applied to disk** (consistent with pure tools).
(c) **Evolution** (pure functions surfacing the derived-artifact deltas the
playground's Migrations dock shows a human): `loom_snapshot` `{source}→SnapshotReport`
(the `ddd snapshot` provenance capture, returned as data — **no file emission**)
and `loom_diff` `{source,baseline?}→DiffReport` (the schema-migration + wire-
contract delta a change implies, with the destructive/breaking gate surfaced).
Folded from the superseded `language-services-and-agent-tools` proposal; the
navigational verbs gate on fixing the LSP providers' real bugs (operation
rename) first. `loom_read_model` / `loom_list_primitives` / `loom_snapshot` /
`loom_diff` have shipped; `loom_verify` follows once the playground can run the
emitted suites in-browser (M-T8.3 / M-T8.6). New diagnostic→fix mappings are
`src/language/fix-hints.ts` providers (one `ModelPatch` → both the LSP
code-action and `loom_quickfix`), not duplicated bespoke verbs.

**Consequences / answers the question that prompted this.**
- The **stdio MCP server is not runnable in the playground browser** — and isn't
  needed there; the playground dispatches tool calls to the in-process catalog.
- Adding playground agentic chat becomes a **UI + LLM-wiring** task reusing the
  catalog — no second tool implementation. The only browser-new concern is LLM
  key/endpoint handling.
- A future **Streamable-HTTP** transport (hosted Loom MCP endpoint) is another
  thin adapter over the same catalog.

**Rejected.** A stateful "session holds the model" MCP server (adds mutable
server state, complicates the browser path, buys nothing a host string can't);
write-capable tools in v1 (kept side-effect-free; `generate-to-disk`, if ever
wanted, is a separate consent-gated tool).

**Affects.** `ai-authoring-loop.md` §3 (the tool surface is the catalog + MCP /
in-browser transports) and §7 item 6; the new `agent-tools-and-mcp.md` is the
detailed spec; the future playground-chat slice builds on this seam.

## D-PHOENIX-FOUNDATION-STRATEGY — vanilla is the home for everything that fights Ash; Ash stays for the CRUD sweet spot, feature-frozen at the boundary, not deprecated

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED. (Go-forward stance over **D-VANILLA-PHOENIX-FOUNDATION** /
**D-VANILLA-ES-HOME** / **D-VANILLA-DEFAULT**, prompted by a third Ash-fit
deferral.  No new mechanism — a prioritisation + feature-direction policy.)

**Problem.** The friction between Ash's model and Loom's contracts is not a
one-off; it recurs, and each occurrence is paid as a per-feature Phoenix
deferral or an off-Ash workaround:

1. **Pure event sourcing** — no clean fit on `foundation: ash`; deferred to
   vanilla (D-VANILLA-ES-HOME; `proposals/workflow-and-applier.md`).
2. **Workflow saga / correlation state** — kept a plain `Ecto.Schema`
   deliberately *off the Ash action surface*, because the dispatcher mutates
   it imperatively (load-or-allocate / route-or-drop), not via changeset
   actions (`proposals/channels.md`; `dispatch-emit.ts`).
3. **Exception-less variant returns** — Phoenix is the odd backend out; the
   `Plug.ErrorHandler` rescue tower that translates `Ash.Error.*` is a
   *designed-in* feature on Ash that fights the cross-backend typed-`or`-union
   dispatch (`proposals/exception-less.md`; D-VANILLA-PHOENIX-FOUNDATION §1).

The common cause is structural and consistent: **`Ash.Resource`'s
changeset-shaped action model + `Ash.DataLayer`'s current-state queryable
contract do not fit Loom's imperative / non-CRUD / event-sourced / typed-error
paths.** Ash remains a *good* fit for what it was built for — declarative CRUD
aggregates, AshPostgres migrations, admin-shaped LiveView forms. The boundary is
the issue, not the framework.

**Decision.**

1. **Feature-direction policy.** New Phoenix domain capabilities that hit the
   Ash action-model boundary — event sourcing,
   exception-less returns, future saga / projection / outbox work — target
   **`foundation: vanilla`** as their Phoenix home. `foundation: ash` is
   **feature-frozen at that boundary**: it is fully supported for the CRUD/admin
   sweet spot and gets cheap parity where it falls out naturally, but we do
   **not** grow bespoke Ash workarounds (custom data layers, AshEvents/AshCommanded
   bridges, action-wrapping) to force ill-fitting patterns onto it. This makes
   explicit the de-facto pattern already in the tree (1–3 above).
2. **Vanilla is the next foundation investment.** Building the vanilla emit
   subtree (P2 of `proposals/vanilla-phoenix-foundation.md`) is now the gating
   dependency for *multiple* deferred features, so its cost is paid once instead
   of re-paid as recurring deferrals. Prioritise it ahead of further per-feature
   Phoenix-on-Ash special-casing.
3. **Ash is NOT deprecated now.** Deprecating `foundation: ash` is premature:
   vanilla is unbuilt and unproven, Ash's declarative DX is a real asset for the
   CRUD case, and D-VANILLA-DEFAULT already sequences vanilla-as-default behind a
   stabilisation cycle. The "neither is deprecated" stance of
   D-VANILLA-PHOENIX-FOUNDATION holds.
4. **Sunset is a *later, conditional* decision.** Whether `foundation: ash` is
   eventually deprecated is deferred and **revisited only after** vanilla (a)
   ships, (b) passes the strict cross-backend parity gate, and (c) clears the
   same stabilisation signals D-VANILLA-DEFAULT defines (a green
   `phoenix-vanilla-build.yml` minor-release cycle + no obs-e2e regressions). At
   that review, weigh the cost of maintaining two Phoenix emitters against Ash's
   residual value for the CRUD sweet spot. Do not pre-commit either way here.

**Affects.** No code change. Sequencing/roadmap: elevates
`proposals/vanilla-phoenix-foundation.md` P2 to the next Phoenix work item;
sets the policy any future
Ash-boundary feature are evaluated against. **Depends on
D-VANILLA-PHOENIX-FOUNDATION**; **informs D-VANILLA-DEFAULT** (its
stabilisation signals double as the sunset-review trigger).

---

## D-SVELTE-FRONTEND — Svelte reuses the shared markup walker; SvelteKit static SPA; runes-native data/forms

**Decision.**  The Svelte frontend (`platform: svelte`) is NOT a fork of the
React generator.  Pages flow through the SAME shared markup walker
(`src/generator/_walker/walker-core.ts`) with a `svelteTarget`
(`WalkerTarget` impl) and svelte-format design packs (`shadcnSvelte`,
`flowbite`) supplying the framework surface.  Three sub-decisions:

1. **App shape: SvelteKit static SPA** (`@sveltejs/adapter-static`,
   `ssr = false`, fallback `index.html`), served with `vite preview` exactly
   like the React SPA.  File-based routing maps the page metamodel's routes
   (`/orders/:id` → `src/routes/(app)/orders/[id]/+page.svelte`); route
   groups `(app)` / `(bare)` carry the layout selectors.  Chosen over a
   Vite + community-router SPA because SvelteKit is the ecosystem's
   maintained routing answer — dependency risk kills generated-code
   products faster than structural asymmetry.
2. **Data layer: `@tanstack/svelte-query` v6** — runes-native
   `createQuery(() => opts)` returns a reactive object with the
   React-Query property surface (`.data` / `.isPending` / `.mutate`), so
   the generated api factories keep the TSX hook NAMES
   (`useAllCustomers`, `useCreateCustomer`, …) and the walker's api seam
   is name-compatible across both frontends.  The zod schema half of
   every api module is emitted byte-identically from the shared
   `src/generator/_frontend/zod-schemas.ts`.
3. **Forms: hand-rolled runes + zod** (`$lib/forms.svelte.ts` —
   `createForm` with `values` / `errors` / `submit` / `applyServerErrors`),
   no third-party form dependency.  Field templates bind
   `form.values.<path>`; RFC 7807 422s decode onto the same per-field
   error map react gets from apply-server-errors.  Operation-form modals
   render as page-scope `{#snippet <op>OpModal(form)}` blocks (one
   component per .svelte file — module scope lands in the template).

**Walker contract.**  The Svelte port added five `WalkerTarget` seams:
the four markup seams (`renderComment`, `renderConditionalChild`,
`renderStyleAttr`, `escapeText`) plus `renderChildrenSlot` and
`formRuntimeImports`.  Svelte 5 shares JSX's `{expr}` interpolation,
`<Comp x={y}/>` invocation and `data-testid={expr}` syntax — those stay
hardcoded in the shared walker; the seams cover exactly where the two
markups diverge.

**Hosting.**  `svelte` joined `STATIC_BUNDLE_FRAMEWORKS`: dotnet
fullstack hosts embed SvelteKit SPAs under `ClientApp/` (the Dockerfile
copies the adapter-static `build/` into wwwroot).  Phoenix is the
deliberate exception — it serves embedded SPAs under the `/app` path
prefix, which a SvelteKit bundle needs `paths.base` threading for; its
surface excludes `svelte` until that lands.  The in-browser playground
preview is likewise deferred (Svelte compiler in the VFS bundler).

See `docs/old/plans/svelte-frontend-plan.md` for the slice history.
## D-VUE-FRONTEND — reuse the shared walker, Vite+vue-router SPA, vee-validate forms

`platform: vue` (Phase B of the platform-expansion roadmap;
`docs/old/plans/vue-frontend-plan.md`) ships as the third frontend with
three locked choices:

1. **Reuse, not fork.**  Vue pages render through the SHARED markup
   walker (`src/generator/_walker/`) with `vueTarget` supplying the
   leaf seams.  Where Vue genuinely diverges from the JSX family the
   CONTRACT grew (renderInterpolation / renderAttrBinding /
   renderMatchChild) rather than the walker forking — every extension
   byte-identical for TSX/HEEx.  The api/workflows module
   builders moved to `src/generator/_frontend/` and are shared
   verbatim (TanStack Query's call surface is identical across
   react-query and vue-query; one import-specifier knob).
2. **Plain Vite SPA + vue-router** — `createWebHistory`, explicit
   route table in `src/router.ts`, `<script setup lang="ts">` SFC
   pages, the same two-stage vite-build/vite-preview docker runtime
   as React.  No Nuxt.
3. **vee-validate forms** (`src/lib/form.ts` — `useLoomForm`): the Vue
   analog of the React packs' react-hook-form.  `useForm` drives
   validation + submit over the SAME shared zod request schema, adapted
   by a locally-emitted `toTypedSchema` (`@vee-validate/zod` is NOT a
   dep — its peer pins zod 3 while the stack is zod 4, so a plain
   `npm install` would ERESOLVE; vee-validate core carries no zod
   peer).  `values` stays a local `reactive()` draft (so pack markup's
   `v-model` + array push/splice keep working) and is pushed into
   vee-validate on submit; per-field error map + ProblemDetails-style
   server-error application preserved.  The `useLoomForm` seam keeps
   the same surface, so pack markup + testids are unchanged across
   packs.

Packs: `vuetify@v3` (npm-package model, the default) and
`shadcnVue@v1` (source-copy: reka-ui + Tailwind 4 + a components-ui
barrel; pack-declared `imports` tables flow into page scripts).  Vue
packs own the `op-dialog` operation-modal wrapper.  `vue` is a
STATIC_BUNDLE_FRAMEWORK — dotnet/java/phoenix hosts embed a
`framework: vue` ui exactly like a React one.

---

## D-NO-PAGE-ARCHETYPES

**Status:** PINNED.

**Problem.** The page DSL shipped three "archetype" builder-call names —
`List { of: T }`, `Detail { of: T, by: id }`, `MasterDetail { of: T, scope?,
detail? }` — documented (`page-metamodel.md` §4/§9) as the canonical page
bodies and used in examples. They were **inert**: `admissibleInSource: true`
in the walker registry but with **no `tsx`/`heex` renderer and no expander
arm**, so a body of `List { of: Order }` parsed, validated, then dead-ended to
a `// not supported by the React walker yet` comment (and they sat in
`NON_PAGE_BODY_LAYOUT_PRIMITIVES`, excluded as page bodies outright). Meanwhile
the scaffold sentinels `scaffoldList`/`scaffoldDetails` — also
`admissibleInSource` — *are* generative (a phase-⑤c expander arm rewrites them
into the full Breadcrumbs · Toolbar · QueryView · Table tree) and are
themselves hand-writable and embeddable anywhere (the expander recurses into
nested bodies). So the archetypes were duplicate names for the working scaffold
sentinels, minus the wiring.

**Decision.** **Remove `List` / `Detail` / `MasterDetail`** from the language.
The list/detail surface is the `scaffold` macro (whole-page generation) plus
the `scaffoldList` / `scaffoldDetails` body sentinels (hand-writable, for
embedding a list/detail in a custom page). No capability is lost — the
embeddable case the archetypes were imagined for is already served by writing
`scaffoldList { of: T }` in a custom page body. `MasterDetail`'s richer
split-pane shape (`scope:` + `detail:` lambda) was never implemented; it is
not reintroduced (compose `scaffoldList` + a `state {}` selection + a detail
component if needed).

**Removed from:** `src/generator/_walker/registry.ts`,
`src/language/walker-stdlib.ts`, `NON_PAGE_BODY_LAYOUT_PRIMITIVES`
(`walker-core.ts`), the web visual-builder model (`web/src/builder/page/`),
and their tests; examples switched to `scaffoldList`/`scaffoldDetails`.

**Supersedes** the `proposals/unfoldable-page-scaffolding.md` direction (which
explored *implementing* the archetypes as emitted components) for the
archetype question specifically. The residual idea in that proposal — that the
phase-⑤c scaffold expansion is opaque "magic" that could instead emit
unfoldable, named components — remains an OPEN, separate consideration for the
`scaffoldList`/`scaffoldDetails` sentinels themselves; it is not blocked by
this removal.

**Superseded (2026-06-19).** The `scaffold*` page-body sentinels
(`scaffoldList` / `scaffoldDetails` / `scaffoldNewForm` / `scaffoldOperations`
/ `scaffoldWorkflowForm` / `scaffoldInstanceList` /
`scaffoldInstanceDetails`) — together with their phase-⑤c expander
(`src/ir/lower/walker-primitive-expander.ts`) — have now been **removed
entirely**: they were "scaffolds that aren't scaffolds" — opaque,
permanently-in-source indirections with no `unfold`. The only scaffold surface
is the `with scaffold(...)` **page macro**, which emits full unfoldable AST
trees (`src/macros/stdlib/scaffold/_body-builders.ts`). The sentinels are no
longer `admissibleInSource` — a hand-written `body: scaffoldList { of: X }`
now fails validation with "Unknown builder type". Embedding a list/detail in a
custom page therefore means writing the body explicitly (the example
`web/src/examples/extern-showcase.ddd` shows the inlined list tree).

**Update (2026-06-20).** The two **singleton index-page sentinels** (`Home` /
`WorkflowsIndex`) — the last holdouts — are gone too. They are
now ordinary scaffold macros (`scaffoldHome` / `scaffoldWorkflowsIndex`
in `_body-builders.ts`) emitting full bodies from the
gathered inventory; the `expandInlineScaffoldPrimitives` expander, the ⑤c pass,
the `Home`/`WorkflowsIndex` registry primitives, and the page
`origin`/`source` fields are all removed. `walker-primitive-expander.ts` is now
just `buildExpandContext`. A page's kind is derived on demand from its
role-scoped name + area via `classifyPage` (`src/ir/util/page-kind.ts`).

---

## D-TENANCY-SCOPE — the per-aggregate tenancy axis is two values

**Status:** PINNED.

**Problem.** Earlier drafts of `multi-tenancy-design-note.md` had a three-value
scope axis — `tenantOwned` / `crossTenant` / `platform` — where `platform` meant
"admin-only cross-tenant data" (audit trails, projections), distinct from open
reference data.

**Decision.** The per-aggregate tenancy axis has **two** values: tenant-owned
(the `tenantOwned` capability) and `crossTenant` (unscoped). There is **no
`platform` scope.** *Who may read* is an authorization concern, not a tenancy
scope, so admin-only cross-tenant data is `crossTenant` + an authorization
default-deny policy. Once depth moved to per-role authz access levels
(D-TENANCY-HIERARCHY) and the registry to a capability (D-TENANCY-REGISTRY),
`platform` had no scope meaning left. Safety note: `crossTenant` is fail-open at
the tenancy layer; sensitive cross-tenant data relies on the authz default-deny
gate.

**Affects.** `multi-tenancy-design-note.md` R2 (canonical); `authorization.md`
§0/§2 (no longer lists `platform`).

---

## D-TENANCY-REGISTRY — registry named in `tenancy by … of X` + a `tenantRegistry` capability

**Status:** PINNED.

**Problem.** The tenant registry (the `Organization`/`Tenant` aggregate) can't be
plain tenant-scoped (it is created before its own tenant context exists, and is
self-keyed with no `TenantId` column) nor `crossTenant` (that would leak every
org). An early draft made it a `platform` aggregate mode.

**Decision.** The registry is a **system-level fact** named in `tenancy by
user.tenantId of Organization`. It carries an explicit, unfoldable **`implements
"tenantRegistry"` capability** that **provides** an immutable self-referential
`parent: Self id?` + a managed `dataKey` path + the path-stamp — fields come from
the local capability, never injected by the distant `tenancy by` line
(verify-don't-inject). Loom **verifies** cardinality (exactly one
`tenantRegistry`) + the `of …` cross-link + that the claim field exists — **not**
field-conformance (the capability provides the fields by construction).
**Reparent is out of scope** (immutable `parent` ⇒ permanent paths; rare org
moves are an offline migration).

**Affects.** `multi-tenancy-design-note.md` R1/R5; `typed-capabilities.md` (the
`tenantRegistry` worked case).

---

## D-TENANCY-DEFAULT — no silent default; an explicit-stance lint

**Status:** PINNED (lint **severity** OPEN — recommended `error`).

**Problem.** A fail-closed *silent* default ("unmarked ⇒ `tenantOwned`") would
have Loom implicitly attach the `tenantOwned` capability, injecting
`tenantId`/`dataKey` — the distant-injection magic the capability model forbids.

**Decision.** **No silent default.** An unmarked aggregate under a `tenancy by`
system is **unscoped**; a **lint** flags it and suggests the explicit marker
(`with tenantOwned` or `crossTenant`). Fields only ever come from an explicit,
unfoldable capability. The lint's **severity is the fail-open/fail-closed knob**:
**error** (recommended — the common case is tenant data, so the unmarked fallback
is the dangerous one) gives fail-closed without magic; **warning** is fail-open.
Severity is the one OPEN sub-decision.

**Affects.** `multi-tenancy-design-note.md` R3 (supersedes original decision #2's
silent-default *mechanism*; the fail-closed *goal* survives via the lint).

---

## D-TENANCY-HIERARCHY — always hierarchy-ready; depth is a per-role authz access level

**Status:** PINNED.

**Problem.** Hierarchical (parent/child org) visibility could be a
flat-vs-hierarchical *mode*, a per-aggregate `subtenantScoped` flavor, or a
per-role access level. An entity-flavor can't express "Manager sees `Project`
deep but `Invoice` local."

**Decision.** **Always hierarchy-ready — no mode switch.** "Flat" is the
degenerate case (every org a root, every read `local`). `tenantId` + a
denormalised `dataKey` (the owning org's materialized path) are stamped on every
`tenantOwned` aggregate **from the token** at create (immutable `parent` ⇒
permanent paths ⇒ `orgPath` can ride the token), so enabling `deep` later is
**migration-free**. **Depth is a per-role authorization access level**, not an
aggregate marker — `authorization.md`'s directional `Self`/`Descendants`/`All`
(Dynamics' `local`/`deep`/`global` is the same ladder, a mnemonic). `deep` is a
**direct indexed prefix scan** on the row's `dataKey` (no join). Grounded in
Dynamics (Business Unit + Basic/Local/Deep/Global) and Salesforce (Role
Hierarchy). **Assumption to verify:** token-carried `orgPath` is a *derived
session value*, not an IdP claim (D-AUTH-OIDC), so the pure-claim-copy stamp is
contingent on session enrichment, else a per-request cached registry lookup.

**Affects.** `multi-tenancy-design-note.md` R5; `authorization.md` §2 (`DataKey`
= the hierarchical extension; directional predicates = the access levels).

---

## D-TYPED-CAPABILITIES — capabilities are first-class pure-mixin declarations

**Status:** PINNED (proposal pending scheduling).

**Problem.** Loom's capability surface (`implements "X"` / `filter for "X"` /
`stamp for "X"`) is the one stringly-typed corner — no resolution, no contract,
and a muddy capability-vs-macro line (capabilities are *implemented as* macros
today).

**Decision.** Promote capabilities to a first-class **`capability { fields +
filter + stamp }`** declaration with **typed references** (`implements X` /
`with X`). It is a **pure mixin** — everything in the body is *provided*; **no**
`requires`/`provides`/`expects` keywords and **no** field-conformance (every
capability provides what its own behavior uses; the rare "operate on a host
field" case is *parameterization*, not a contract). Provision is local +
unfoldable (not magic); provided members are non-overridable by default. Lowers
to the existing per-aggregate `contextFilters`/`contextStamps` IR ⇒
**byte-identical migration**. Subsumes the `audit`/`softDelete` field+filter+stamp
macros; `crudish`/`scaffold*` stay macros (operations/structure). Open: emission
deduplication when a capability is reused (`typed-capabilities.md` OQ#1).

**Affects.** `typed-capabilities.md` (canonical); `../capabilities.md` (evolves
its mechanism); `multi-tenancy-design-note.md` (`tenantOwned`/`tenantRegistry`
are capabilities).

---

## D-INDEX-INFRA — manual performance indexes live on the storage binding, not the aggregate

**Status:** PINNED.

**Problem.** Domain uniqueness is a `unique (...)` invariant on the aggregate, but
a plain **performance** index (speed up a frequent filter) has no domain meaning —
putting it on the aggregate conflates infrastructure with the model.

**Decision.** A performance index is declared on the `resource` binding via
`index: [Entity.col, Entity.(a, b)]` (grammar `IndexSpec`). It is **pure
infrastructure** and always **non-unique** (uniqueness stays the domain
invariant). The target entity is named **explicitly** (`Project.name`), never
inferred from which table owns the column — the binding knows the context's shape,
and the entity may be an aggregate *or* a contained part. Lowers to `manualIndexes`
in the IR and lands as `CREATE INDEX` in the derived migration.

**Affects.** `uniqueness-and-indexes.md` §3.2 (canonical); `../resources.md`
(surface); `../migrations.md`.

---

## D-INDEX-SUGGEST — index suggestions are an advisory lint, not an auto-emitted index

**Status:** PINNED.

**Problem.** Loom can see which columns get filtered frequently (find predicates,
FK-shaped reads), so it *could* auto-create covering indexes. But silently
emitting indexes hides a cost (write amplification, storage) the author never
chose, and an index is an ops decision.

**Decision.** Loom does **not** auto-emit performance indexes. It emits an
**advisory warning** — `loom.index-suggestion` (`validateIndexSuggestions`,
`src/ir/validate/checks/index-suggestion-checks.ts`) — pointing at a
frequently-filtered column with no covering index, and the author opts in via the
manual `index:` hatch (D-INDEX-INFRA). Advisory, never an error; never changes
emitted schema on its own.

**Affects.** `uniqueness-and-indexes.md` §11 (canonical); `../resources.md`.

## D-MIG-NO-DOWN — down migrations are no-op everywhere, by decision

**Status:** PINNED.

**Problem.** Every backend's migration mechanism has a down/rollback slot
(EF `Down()`, Ecto `change/0` reversibility, Drizzle/Flyway/Python file
pairs). Loom has always emitted no-op downs de facto; M-T2.3's data steps
(backfills, raw SQL) forced the question, because a "down" of a backfill is
a data-destroying drop.

**Decision.** Down migrations are **no-op on every backend, permanently**.
Operators roll forward; recovery is backup + roll-forward. The snapshot
ledger re-derives forward state deterministically, so a bad migration is
corrected by the *next* migration, not by rewinding.

**Rationale.**

- Down paths are untested-by-construction — nothing in the pipeline ever
  executes them, so shipping them is shipping unverified code.
- The "down" of a data step is destructive by definition (un-backfilling a
  column is dropping its values), which contradicts the destructive gate's
  whole posture.
- Forward-only matches the seeding stance (D-SEED-IDEMPOTENCY) and the
  documented practice of every backend's own community for production data.

**Affects.** `../migrations.md` § Data migrations; `dotnet/emit/migrations.ts`
(`Down()` comment); every backend's migration emitter.

## D-MIG-DSL-STEPS — data migrations are DSL steps, not emitted stub files

**Status:** PINNED.

**Problem.** The original M-T2.3 sketch was "an emitted, history-tracked stub
file the user fills (per backend's native mechanism)". A stub must survive
regeneration (write-once machinery), exists five times (a Drizzle `.sql`, an
EF class, an Ecto `.exs`, a Flyway file, a Python `.sql`) for one logical
change, and breaks the "generated tree is disposable" invariant.

**Decision.** Data migrations are **steps in the `migration` block** —
backfill (`Agg.field = <expr>`) and raw `sql "…"` — validated, printed, and
ledgered like every other step, rendered once through the two shared
renderers (`sql-pg.ts`, Ecto `execute/1`). No generated file is ever
user-edited. The raw step's exactly-once semantics live in the snapshot
(`appliedDataMigrations`), not in a new history file — the same "the snapshot
IS the applied-history record" property M-T2.1 pinned for renames.

**Rationale.**

- One source, five backends: the stub-file design duplicates the same DML per
  backend and drifts.
- The block already existed (M-T2.1) and was explicitly shaped for these
  steps; a second surface would be permanent tech debt.
- Procedural, app-level data migrations (beyond SQL) are a documented
  non-goal for v1; the pressure valve is the raw `sql` step's full Postgres
  expressiveness (CTEs, functions).

**Affects.** `../migrations.md` § Data migrations;
`../new-plan/missions/M-T2.3-data-migration-surface-design.md` (canonical);
`src/system/migrations-builder.ts`.

## D-DATAGRID-TARGETS — a target hosts `DataGrid` only if it can host TanStack

**Status:** PINNED.

**Problem.** `DataGrid` (M-T1.1 slice 10) is not a markup mapping. It is a
TanStack Table row model — multi-column sort, per-column filters, column
visibility, pagination, row selection — that each target wires to its own
reactivity through the `renderDataGridChild` seam. The seam exists precisely so
those semantics are shared rather than re-derived. That makes "should target X
get a DataGrid?" a different question from every other primitive's, and the
tempting answer is the wrong one: most UI toolkits ship *a* data grid, and
adopting it would satisfy the emitter while quietly forking behaviour.

**Decision.** A frontend ships `DataGrid` **iff it can run TanStack Table
itself**. Not "iff it emits JSX", and not "iff its UI kit has a grid widget".

- **React / Vue / Svelte / Angular / Feliz — yes.** The first four via their
  official adapters or (Svelte) `@tanstack/table-core` directly. **Feliz too:**
  Fable compiles F# to JavaScript, so it binds `table-core` through ordinary
  interop and executes the same row model. No adapter is required, and none
  exists — that was never the test.
- **Flutter — no, permanently.** There is no Dart adapter and no Dart port.
  `dart:js_interop` exists on Flutter *web* only, while the shipping target
  (what `generated-flutter-build.yml` builds) is a native APK with no JS
  runtime. A primitive that compiles on one Flutter target and not the other is
  worse than an honest gap.
- **HEEx — no,** and (revised) for the **same** rule, not an unrelated one.
  LiveView has a JS runtime, so "can it host TanStack?" is not answered by
  physics the way Flutter's is; it is answered by what hosting would cost.
  Both available roads fork the seam:
  - **Hand-rolled server-side.** The rows are already in a socket assign, so
    sort/filter/visibility/paging would be `Enum.sort_by`/`Enum.filter`/
    `Enum.slice` over that assign — feasible, and *that is the problem*: it
    means re-deriving `sortingFns.alphanumeric`, the multi-sort tie-break
    order, `filterFns.includesString` and TanStack's pagination edges in
    Elixir, against a library that keeps moving. Identical to the Dart
    hand-roll this decision already rejects.
  - **A `phx-hook` mounting `table-core`** over a `phx-update="ignore"`
    subtree. Technically the real row model, but a JS-owned island LiveView
    must not patch — forfeiting the server-rendered markup every other HEEx
    primitive is built on (page objects, the shared chrome-i18n path,
    `<.input>`/`<.table>`), to gain one primitive.

  `Table` is server-driven there instead, and carries real sort + pagination.

`Table` is the portable answer on both, and it carries column sort, pagination
and filtering on every frontend. `loom.datagrid-unsupported-target` says so, per
target, rather than "not supported yet".

**Correction (DataGrid pin re-examination).** Until this revision, HEEx's
exclusion was justified — in `KNOWN_HEEX_GAPS`, in `allowlist-ratchet`, and in
the `*-unsupported` register's "phoenixLiveView is the open leg" — by a blocker
that does not exist: *"every interaction would be a `handle_event` round-trip
re-querying the server … and needs backend support for multi-column ORDER BY,
which `list/4`'s single sort/dir pair does not have."* **`DataGrid` drives no
server read on any of the five targets that ship it.** It grids the array it was
handed (`getSortedRowModel` / `getFilteredRowModel` / `getPaginationRowModel`
over `data: rows`; `pageSize:` is a *client* page size), so `list/4`'s sort/dir
pair was never on its path — and on LiveView those same rows sit in a socket
assign, so nothing would be re-queried either. The exclusion survives the
correction, but on this decision's own rule rather than on a backend limit.
Column visibility deserves its own note: it is pure assign state touching no row
model at all, so it is the one grid feature with nothing to fork — which makes
it a candidate for `Table`, not an argument for a partial `DataGrid`.

**Rationale.**

- Flutter ships `DataTable`/`PaginatedDataTable`, which is exactly the trap.
  They would give an author *a* grid whose sort stability, filter composition,
  multi-sort semantics and pagination edges differ from the other five — the
  divergence class the shared seam was built to prevent, reintroduced under a
  primitive with one name.
- The alternative — hand-rolling a row model in Dart — is the same fork with
  more code, and it is unbounded work: parity is measured against a library
  that keeps moving.
- Stating the rule as "can it host TanStack" makes both answers fall out
  mechanically and keeps the next target's decision cheap. Read it as **"can it
  host TanStack *without forking the target's own contract*"** — that is what
  makes it answer HEEx too, where the literal question has a yes-shaped answer
  nobody wants.
- The grid already carries one deliberate override of a TanStack comparator
  (`compareDecimal`, for money columns whose `Decimal.valueOf()` returns a
  string), and `data-grid.test.ts` declines to add a second because it "would
  FORK TanStack's `text`/`alphanumeric` choice" — at *one column*. That is the
  scale at which forking is already treated as a cost; a whole
  re-implementation is the same cost everywhere, with no shared spec to hold
  the targets together.

**Affects.** `DATA_GRID_FRAMEWORKS` (`ir/validate/checks/system-checks.ts`);
`DATA_GRID_PRIMITIVES` (`generator/_packs/required-primitives.ts`);
`util/flutter-deferred-primitives.ts`; `generator/feliz/data-grid-child.ts`;
[`page-metamodel.md` §9.1](page-metamodel.md); `new-plan/T1-ui-frontend.md`
M-T1.1.

## D-WHEN-GATE-DOMAIN — the `when` state gate is a domain-method property, not an HTTP-edge one

**Status:** PINNED.

**Problem.** `operation cancel() when <pred>` (criterion.md use site 2, the
canCommand state gate) used to be emitted at the **route / command-handler layer
only**. Every other caller of the domain method walked straight past it — a
workflow step, a saga cascade, an `extern` command handler, the LiveView action
seam all call `aggregate.cancel()` directly. The declared rule then silently did
not run on the paths that reach the aggregate from *inside* the system: no
`DisallowedError`, no 409, the write landed. It is the absence of a refusal, so
no wire-shape differential can see it — the request that should have been refused
is never made over HTTP at all.

Two coherent answers were open (`new-plan/T6-backend-parity.md` M-T6.38):

1. **Domain-layer gate** — the predicate is asserted by the aggregate's own
   method, so every caller is gated.
2. **Route-layer by design** — `when` stays an API-edge gate and the language
   says so, leaving in-system callers deliberately ungated because the workflow
   *is* the authority.

**Decision.** (1). The `when` predicate renders as the first line of the
generated operation method on all five backends. The route keeps its own
post-load check so the HTTP answer (409 + the RFC 7807 envelope) is still
produced before the aggregate is touched and the wire contract is unchanged;
the two checks are the same predicate and the same message.

**Rationale.**

- `when` is written *on the aggregate*, in terms of the aggregate's own state,
  and reads as a statement about when the operation is meaningful — not about
  who may call it over HTTP. Answer 2 asks the reader to hold a rule whose
  enforcement depends on the caller's transport, which nothing in the syntax
  hints at.
- It makes the gate uniform with `precondition` / `invariant`, which have always
  been domain-method properties. `requires` stays the deliberate exception —
  its leading run is hoisted to the calling handler (`ir/util/op-gates.ts`)
  because authorization needs a principal the domain layer does not carry.
- Phoenix was already doing this (its gate has always lived inside the context
  function the workflow starter calls), so answer 2 would have meant *removing*
  enforcement from a shipping backend to reach parity.
- Cost is bounded: one line per gated operation in five domain emitters, and no
  wire change — the route-layer check is retained precisely so no status,
  envelope, or ordering moves.

**Affects.** `generator/typescript/emit/aggregate.ts`,
`generator/dotnet/emit/entity.ts`, `generator/java/emit/entity.ts`,
`generator/python/emit/aggregate.ts` (elixir's
`vanilla/context-emit.ts` already conformed); the route-layer checks in
`platform/hono/v4/routes-builder.ts`, `generator/dotnet/cqrs/commands.ts`,
`generator/java/emit/service.ts`, `generator/python/routes-builder.ts` are
unchanged. Pinned by `test/generator/when-gate-domain-entry.test.ts`;
documented in [`language-reference/06-behavior-and-statements.md`](language-reference/06-behavior-and-statements.md).

---

# Wave C0.6 — the fifteen rulings batch (drafted 2026-09-10)

The fifteen entries below were batched by packet **C0.6** of Wave C0 in
[`new-plan/completion-waves-2026-09.md`](new-plan/completion-waves-2026-09.md)
(the table that used to live in that plan's Wave C5 now points here). They are
drafted so the owner can sign the batch off in one sitting: each carries the
question in one sentence, the options that were on the table, a **default**, its
reason grounded in the code as it stands on `main` @ `bc7ed8f`, what it unblocks
(mission id + wave packet), and Sources.

**How the defaults work.** Every entry is `proposed`. Thirteen carry *default
applies 48 h after merge unless overridden* — an absent owner does not stall the
fleet. **Two are `owner-only, no default`** and nothing may proceed on them
without a signature: **D-HANDLE-REMOVAL** (it deletes surface syntax) and
**D-NUMERIC-INGRESS-STRICT** (it is a breaking narrowing on a shipping wire).
When a default is taken, flip that entry's Status to `PINNED` and date it; when
the owner overrides, rewrite the Decision rather than adding a second one beside
it.

| # | tag | default in one line |
|---|---|---|
| 1 | `D-ENVELOPE-RATIFY` | `X envelope` = a single-row find; the `{id, ts, body}` carrier is dropped |
| 2 | `D-HANDLE-REMOVAL` | remove workflow `handle` / named `create` — **owner-only** |
| 3 | `D-FOR-IN-DOMAIN` | `for` in a domain body = honest gap + named successor; `variant-match` / `if let` = permanent refusals |
| 4 | `D-NUMERIC-INGRESS-STRICT` | strict on both real narrowings — **owner-only** |
| 5 | `D-DECIMAL-EXACT-MOMENT` | one PR: node + python + all 54 goldens re-captured; mint **RS-35** |
| 6 | `D-WRITE-TX` | state + outbox + audit + provenance in one tx; dispatch after commit |
| 7 | `D-CROSSTENANT-ACK` | `policy { deny on X }` is the acknowledgment; `allow global` stays refused |
| 8 | `D-READ-SURFACE-ORDER` | re-verify, then projection masking, then the two small gates, then system reads |
| 9 | `D-LONG-AVG-DEFAULTS` | declared 2^53 ceiling for `long`; projection `avg` over money retypes to `money` |
| 10 | `D-DAPPER-ALTER` | build the ALTER path in phase ⑨; the widened refusal lands first |
| 11 | `D-PROJECTION-IMPLICIT-SUB` | an `on(Event)` subscribes in-process with or without a channel |
| 12 | `D-FIRST-ON-EMPTY` | `first` is partial and fails on empty; `firstOrNull` is total; mint **RS-36** |
| 13 | `D-ABSENT-JOIN-DATETIME-WIRE` | absent join value = wire `null` everywhere (RS-34 ratified); datetimes ship milliseconds; mint **RS-37** |
| 14 | `D-FLUTTER-BEARER` | Flutter native = bearer, Flutter web = cookie (a RULE 2 amendment) |
| 15 | `D-MISC-C0` | four small rulings: the .NET entry-point boundary, `connection:` semantics, per-op OpenAPI tags, `scopeId` |

---

## D-ENVELOPE-RATIFY — `X envelope` is a single-row find, not an `{id, ts, body}` carrier

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** Does `find audit(): Order envelope` mean a wrapped
`{id, ts, body}` payload, a single-row read, or nothing at all until the carrier
is built?

**Options.** (L) build the `{id, ts, body}` carrier on all five backends — it
needs a `ts` source in the IR that nothing supplies; (M) ratify the single-row
meaning node and python already ship and drop the distinct carrier meaning;
(S) refuse `envelope` until it is built.

**Decision.** (M) — **`envelope` is arity sugar for a find that returns exactly
one row.** This diverges from the completion plan's proposed default (S, "refuse
until built"); the reason is in the Rationale, and PR
[#2852](https://github.com/Loom-Harness/Loc/pull/2852) is already open on `main`
taking this option.

**Rationale.**

- **A wrapper would contradict a PINNED decision.** D-ENVELOPE fixes every HTTP
  response to one of four shapes — bare value, `Paged<T>`, ProblemDetails,
  event-frame `{ kind, occurredAt, correlationId, data }`. An `{ id, ts, body }`
  wrapper is a fifth shape, and the event-frame is already the carrier for "an
  event plus its metadata".
- **Nothing supplies the carrier's own fields.** `GENERIC_SHAPES.envelope`
  (`src/ir/stdlib/generics.ts:74-77`) declares `{ id: string, ts: datetime,
  body: P }` and `monomorphizeGenericInstances` (`src/ir/enrich/enrichments.ts:1446-1458`)
  synthesizes an `OrderEnvelope` payload from it — but **no emitter has a single
  arm for the ctor**: `grep '"envelope"' src/` matches only the grammar, the
  `GenericCtorName` union and that shape table. Java and .NET render it
  structurally through their `TypeTarget` as `Envelope<T>`
  (`java/render-expr.ts:1007`, `dotnet/render-expr.ts:1221`); .NET declares the
  record exactly once (`dotnet/emit/common.ts:191`) and returns a bare `T` from a
  `Task<Envelope<T>>` signature (CS0029), java declares it **nowhere** (three
  references, zero definitions), elixir returns a JSON array. Building the
  carrier means inventing a `ts` value five times.
- **Refusal costs the same emitter surgery as ratification** and still leaves the
  grammar, the stdlib shape table and `docs/generators.md:66`'s five ticks
  promising a carrier no author can use. Zero `.ddd` in the repo uses the keyword
  (the reason every compile gate was blind), so ratification breaks no model
  either.

**Consequences.** `X envelope` means one row — the bare aggregate/payload wire
shape, 404 when absent. The `envelope` arm of `GENERIC_SHAPES` and its
monomorphized `<Arg>Envelope` payload go with the emitter change, or reduce to an
`envelopeReturn()` recogniser beside `pagedReturn`; leaving the `{id, ts, body}`
field list in the stdlib while no backend emits it is exactly the drift this
ruling removes. Java/.NET drop `Envelope<T>` from ports and impls (and delete the
now-dead record); elixir's find-controller reads and serialises ONE record
instead of `Repo.all`. A corpus fixture (`test/fixtures/corpus/envelope.ddd`)
enters the compile matrix in the same PR, because the gates cannot see the
carrier without one (rule 13). If a real event-envelope carrier is wanted later
it is a NEW ctor with a designed `ts` source, not this one.

**Unblocks.** M-T6.57 (P0) → wave **C1 packet 1c**; retires M-T6.14's DEBT-08
`envelope` deferral.

**Sources.** [`T6-backend-parity.md`](new-plan/T6-backend-parity.md) M-T6.57 +
its 2026-09-09 fleet note (F57);
[`2026-09-03-language-docs-audit-findings.md`](audits/2026-09-03-language-docs-audit-findings.md)
F21; PR #2852; `src/ir/stdlib/generics.ts`, `src/ir/enrich/enrichments.ts`,
`src/generator/{java,dotnet}/render-expr.ts`,
`src/generator/dotnet/emit/common.ts`.

---

## D-HANDLE-REMOVAL — workflow `handle` and named `create` are removed, not routed

**Status:** proposed — **owner-only, no default.** Nothing proceeds on M-T6.58
without a signature; this entry deletes surface syntax.

**Question.** Does the workflow `handle name(...) { … }` declaration become a
shipping HTTP entry point on all five backends, or is it removed as redundant
with `commandHandler`?

**Options.** (a) emit a route per `handle` on all five and design the addressing
surface it lacks; (b) remove the declaration — grammar, lowering, and the
diagnostic that promises it — and point authors at `commandHandler`; (c) keep it
parsing behind an honest refusal.

**Decision (proposed).** (b) — remove. (c) is the acceptable transitional step in
the same PR if the grammar removal cannot land in one go.

**Rationale.**

- **The addressing surface does not exist.** `HandleDecl`
  (`src/language/ddd.langium:1488-1491`) is
  `'handle' name '(' params ')' ('requires' gate)? '{' body '}'` — **no `by`
  clause**, unlike its sibling `WorkflowCreateDecl` (`:1473-1476`, which carries
  `('by' correlation=CorrelationExpr)?`) and unlike `OnDecl`, whose `by` was
  deferred *with a written reason*. `HandleIR`
  (`src/ir/types/loom-ir.ts:1361-1368`) carries `name`/`params`/`statements`/
  `savesAtExit` and no correlation. So even a fully built route cannot say WHICH
  saga instance it runs against: option (a) is not "write five emitters", it is
  "design a correlation surface first, then write five emitters".
- **`commandHandler` already covers the use case**, with a full emitter on all
  five and an explicit-handler route surface.
- **Three places promise routing and zero deliver.** Lowering fills
  `WorkflowIR.handlers` (`src/ir/lower/lower-workflow.ts:124-174`),
  `test/ir/workflow-handle.test.ts` pins it, and `loom.duplicate-handler`
  (`src/diagnostics/messages.ts:314-317`) tells the author that
  "a `route -> <Ctx>.<name>` would be ambiguous" — while every emitter drops it
  through the same fail-open `if (!h) continue;`. Named `create` is dropped by a
  different mechanism (`lowerWorkflow` picks one primary).
- **Owner-only** because a default must never take a keyword out of the language
  unattended.

**Consequences.** `handle` and the named `create` form stop parsing; `HandleIR`,
`WorkflowIR.handlers` and `lowerHandle` are deleted; `loom.duplicate-handler`
loses its workflow-`handle` clause and keeps the handler-vs-handler arm; the
removal ships with a migration note naming `commandHandler` as the replacement.
If the owner picks (a) instead, the correlation surface (`handle f(…) by <expr>`)
is designed FIRST as its own mission and this tag is superseded rather than
edited. Either way the work is **blocked behind M-T6.62** — option (a) would be
built on a workflow-`create` path that miscompiles on all five backends.

**Unblocks.** M-T6.58 → wave **C1 packet 1a**.

**Sources.** [`T6-backend-parity.md`](new-plan/T6-backend-parity.md) M-T6.58 + its
2026-09-09 fleet note;
[`2026-09-03-language-docs-audit-findings.md`](audits/2026-09-03-language-docs-audit-findings.md)
F13; `src/language/ddd.langium`, `src/ir/types/loom-ir.ts`,
`src/ir/lower/lower-workflow.ts`, `src/diagnostics/messages.ts`.

---

## D-FOR-IN-DOMAIN — `for` in a domain body is an honest gap with a successor; `variant-match` and `if let` outside their home are permanent refusals

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** `for`, `if let` and `variant-match` all parse inside an operation
body but lower only inside a workflow (or a page) — is each a permanent refusal,
or a refusal today with lowering promised?

**Options.** Gate all three permanently; lower all three; or split them.

**Decision.** Split, as the 2026-09-09 fleet recommended. **`variant-match`
outside a ui action → permanent refusal. `if let` outside a workflow → permanent
refusal. `for` in a domain body → honest gap: a refusal code today, with a NAMED
successor mission to lower it.**

**Rationale.**

- **All three are silent today, so a code is the floor under every option.**
  `src/ir/lower/lower-stmt.ts` (the domain-body lowerer) has no `ForStmt` or
  `IfLetStmt` arm at all and ends in
  `return { stmt: { kind: "call", target: "function", name: "<unknown>", args: [] } }`
  (`:374-378`), so `operation touch() { for n in notes { owner := n } }` reports
  `0 error(s), 0 warning(s)` and emits `this.<unknown>();`. `variant-match`
  reaches `src/generator/_stmt/target.ts` and throws.
- **`for` differs in KIND, not only in cost.** `ForStmt` sits in the shared
  `Statement` union (`ddd.langium:2075-2091`), and `lower-workflow.ts:588`
  already lowers it with a per-iteration save — iterating a collection inside an
  operation is an ordinary domain shape the language cannot otherwise express.
  `variant-match` is frontend-shaped by construction (its arms render event
  handlers) and `if let` is the workflow's `repo-let` narrowing; both have a home
  the author is being pointed back to, and `for` does not.
- A "permanent" refusal on `for` would be re-opened the first time somebody
  models a bulk operation. Naming the successor now costs one heading and stops
  the code being read as a decision that iteration is unwanted.

**Consequences.** Three codes in `src/diagnostics/messages.ts` (C1 packet 1b is
the only packet permitted to mint), each with a `code-docs.ts` anchor and a
firing fixture. The `for` code's message says *not yet lowered in a domain body*
and names its successor; the other two say *by design* and name the construct's
home. Neither message may recommend the .NET/Java `match`-error form until
M-T6.61's binding fix is in. The `<unknown>` fallback in `lower-stmt.ts` is
itself a silent sentinel of the M-T9.55 class and is routed through the give-up
gate in the same wave.

**Unblocks.** M-T5.28 → wave **C1 packet 1b**.

**Sources.** [`T5-language-core.md`](new-plan/T5-language-core.md) M-T5.28;
[`2026-09-03-language-docs-audit-findings.md`](audits/2026-09-03-language-docs-audit-findings.md)
F1/F4; `src/ir/lower/lower-stmt.ts`, `src/ir/lower/lower-workflow.ts`,
`src/generator/_stmt/target.ts`, `src/language/ddd.langium`.

---

## D-NUMERIC-INGRESS-STRICT — request-side numeric lenience is narrowed to match the strict majority

**Status:** proposed — **owner-only, no default.** It is a breaking narrowing on
a shipping wire; no client can be signed up to it by a timer.

**Question.** python and elixir accept request values the other three refuse — a
stringified number for an `int` field, and (elixir alone) a JSON number for a
`money` field. Narrow them, or ratify the lenience?

**Options.** (a) strict everywhere — refuse a string where a number is declared,
refuse a JSON number where `money` is declared; (b) lenient everywhere — widen
node/.NET/java to coerce; (c) leave the skew and document it.

**Decision (proposed).** (a) strict, on **both** rows.

**Rationale.**

- **The contract is already strict on the majority and in the published schema.**
  node emits `z.number().int()`, .NET's `System.Text.Json` refuses String→Number
  without `AllowReadingFromString`, and java's `WireNumberStrictness` fails the
  `LogicalType.Integer` string coercion — the one backend that was *moved* there
  deliberately, by M-T6.48. python's acceptance is pydantic 2 lax mode and
  elixir's is `Ecto.Type.cast(:integer, "5")`: two framework defaults nobody
  chose.
- **The money row is worse than a skew.** Four backends type a `money` request
  field as a STRING (`z.string()`, `string Price`, `String price`,
  `Annotated[str, …]`), so a JSON number never reaches a guard. Elixir's
  create/update path casts straight onto the `:decimal` column, so nothing types
  the wire value and `Ecto.Type.cast(:decimal, 12.5)` succeeds. RS-12 governs the
  RESPONSE direction only — it says how money serializes, not what a request may
  carry — which is why no existing gate saw this.
- **Owner-only** because a client sending `{"qty":"5"}` to a python or elixir
  deployable starts getting a 4xx it did not get before. Nothing in the repo can
  make that call for a downstream consumer.

**Consequences.** `ConfigDict(strict=True)` on python request models — or
per-field `Strict()`, which is narrower and leaves datetime parsing alone — and a
pre-`cast/3` wire-type guard on the elixir changeset path
(`__loom_int_field` / `__loom_money_field`, answering through the existing
`__loom_param_error` responder the op-param arm already emits). The
characterization pins in the second `describe` of
`test/conformance/numeric-ingress-parity.test.ts` are deleted and replaced by the
same assertions inverted, in the same diff, so the contract is visibly moving;
the file's header measurement table is **re-measured against the real
deserializers**, not edited.

**Not in this ruling — the third divergence is an ordinary defect.** M-T6.60 also
records a 40-digit money string parsing on node/java/python/elixir, reaching
`NUMERIC(19,4)`, and 500-ing from the database (only .NET refuses it, because
`decimal.TryParse` stops at ~29 significant digits). A 500 is never the right
answer, so there is nothing to rule: it is a **defect**, bounded from
`MONEY_WIRE_SCALE` + the `NUMERIC(19,4)` precision in
`src/generator/money-scale.ts` so one constant governs both the wire guard and
the column, and it drains with wave **C1 packet 1e**'s `G2644` numeric-ingress
residue row rather than waiting on a signature.

**Unblocks.** M-T6.60 → wave **C2 packet 2f**; Schemathesis F11.

**Sources.** [`T6-backend-parity.md`](new-plan/T6-backend-parity.md) M-T6.60;
[`numeric-types-audit-2026-08-23.md`](audits/numeric-types-audit-2026-08-23.md)
F12 annex; M-T6.48 and `test/conformance/numeric-ingress-parity.test.ts`; RS-12,
RS-24.

---

## D-DECIMAL-EXACT-MOMENT — decimal exactness ships as ONE PR with every wire golden re-captured

**Status:** proposed (default applies 48 h after merge unless overridden). The
*semantic* ruling was already given by the owner on 2026-09-07 (`decimal`
arithmetic is EXACT) and is **not** re-opened here; what this entry rules is the
rule NUMBER and the shipping shape.

**Question.** The owner ruled `decimal` arithmetic exact — under which RS number,
and how does a change that MOVES the oracle every other backend is compared
against actually land?

**Options.** (i) node first, then python, re-capturing goldens twice; (ii) one PR
carrying node + python + every re-captured golden; (iii) freeze the goldens and
compare against a second oracle.

**Decision.** (ii) — **one coordinated PR**, and mint **RS-35** (not RS-31; see
Consequences).

**Rationale.**

- **The oracle is not one golden's property, it is every golden's.**
  `jq -r .oracle test/behavioral/wire-golden/*.json` answers `node` for **all 54
  files** (measured 2026-09-10). Any PR that changes node's decimal arithmetic
  moves all 54 at once, so a partial landing leaves the differential tier
  comparing four backends against an oracle that no longer describes node —
  green exactly where it should be red.
- Splitting by backend also splits the review. The mission demands the goldens be
  reviewed diff-by-diff and never as a drive-by rebaseline; that review is only
  meaningful once, against the final oracle.
- `LOOM_WIRE_UPDATE=1` is the capture path, and it is a single command over the
  whole set — sequencing buys nothing it does not cost twice.

**Consequences.**

- **The plan's "mint RS-31" is stale.** `docs/conformance-semantics.md` already
  carries RS-31 (code-point `.length`), RS-32, RS-33 and RS-34. Under that file's
  own *"Claim the NUMBER before you build"* protocol the next free number is
  **RS-35**, and no open PR claims it (checked against the 11 open PRs on
  2026-09-10). RS-36 and RS-37 are claimed inside this same batch by
  D-FIRST-ON-EMPTY and D-ABSENT-JOIN-DATETIME-WIRE — take RS-38 next.
- The PR body states that **historical rows are not rewritten**, so values
  persisted before the change may disagree with values persisted after, and it
  carries the migration note.
- The blast-radius items the mission attached ride the same PR: node's
  `decimal.js` running at the default 20 significant digits (no `Decimal.set`
  emitted) against 28+ elsewhere, the inbound decimal precision-acceptance skew
  (java unlimited / .NET 28–29 / double-clamped), and the
  `sum → decimal` catalog signature in `src/util/collection-ops.ts` disagreeing
  with `type-system.ts`'s body-type rule.
- Scope the node implementation BEFORE writing it and report the finding: python
  already has `Decimal` on the column side (M-T6.45), so its gap may be narrow,
  while node likely needs a decimal library threaded through the domain layer and
  the derived-field evaluator.

**Unblocks.** M-T5.22 → wave **C2 packet 2f**.

**Sources.** [`T5-language-core.md`](new-plan/T5-language-core.md) M-T5.22 (the
2026-09-07 ruling);
[`numeric-types-audit-2026-08-23.md`](audits/numeric-types-audit-2026-08-23.md)
F11 + annex; [`conformance-semantics.md`](conformance-semantics.md) RS-24 and the
claim-the-number protocol; `test/behavioral/wire-golden/*.json`.

---

## D-WRITE-TX — one write transaction: state + outbox + audit + provenance; dispatch after commit

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** Which writes and which emits share a transaction, and what does a
write path with no enclosing transaction do instead?

**Options.** (a) one transaction per aggregate save carrying the outbox, audit
and provenance rows, with in-process dispatch after the commit; (b) a transaction
per statement, relying on the relay to repair; (c) leave it per adapter, as
today.

**Decision.** (a). **The rule, stated once:** an aggregate save opens exactly ONE
database transaction; the durable-event outbox rows, the audit rows and the
provenance rows written for that save commit INSIDE it; the remaining (ephemeral)
events are dispatched in-process AFTER the commit, never inside it. A write path
with no enclosing transaction — a workflow step, an `extern` handler, a timer —
opens one for the same set rather than inserting outside one.

**Rationale.**

- **The shape already exists and is proven; the ruling ratifies the majority
  rather than inventing a rule.** node/drizzle drains `aggregate.pullEvents()`
  BEFORE the write transaction, records the durable ones on that same `tx`
  handle, and dispatches only the remainder after commit
  (`src/generator/typescript/repository-save-builder.ts:247-255`). .NET's
  relational path does the same, with the reason written into the emitter:
  *"DispatchAsync AFTER the commit, on a second SaveChangesAsync, loses an
  event"* (`src/generator/dotnet/emit/repository.ts:455-463`).
- **Dispatch-inside-the-transaction is the worse failure.** A handler that throws
  rolls back a write that had already succeeded, and a handler that reads sees
  rows the caller can still roll back.
- **Implementers: half of M-T4.3 item 5's text is stale on this head.** The
  mikroorm save now wraps in
  `this.em.fork({ keepTransactionContext: true }).transactional(async (em) => …)`
  and records durable events on that callback's own `em`
  (`src/generator/typescript/emit/mikroorm.ts:1022-1067`,
  `MIKRO_OUTBOX_DRAIN_LINES` / `MIKRO_OUTBOX_RECORD_LINE`) — `G2667-C4` landed.
  What still reproduces: **.NET's document and event-sourced repositories**
  dispatch after `SaveChangesAsync` with no `RecordDurableAsync` at all
  (`dotnet/emit/repository.ts:909-921` and `:1155-1178`); node's workflow-step /
  extern-handler / timer emits are deliberately fenced outside any transaction
  (`src/platform/hono/v4/workflow-builder.ts:1239-1244`); and java's
  class-`@Transactional` command handlers against .NET/node's per-`SaveAsync`
  commit is the §D5 asymmetry. Verify each before fixing (RUNBOOK §1).

**Consequences.** `G2667-C4` / `G2667-C5` / `G2667-D5` close against a written
contract, so every remaining deviation is a defect rather than an undecided fork.
A cross-backend gate asserts the ORDER in the emitted source per adapter
(record-before-commit, dispatch-after-commit) and, wherever a runtime leg exists,
a booted-app proof of the crash window (rule 10) — a constant read back out of
the emitter proves consistency, not correctness (rule 12).

**Unblocks.** M-T4.3 item 5 → wave **C2 packets 2b / 2c**.

**Sources.** [`T4-eventing-temporal.md`](new-plan/T4-eventing-temporal.md) M-T4.3
item 5; [`generator-code-review-2026-08-24.md`](audits/generator-code-review-2026-08-24.md)
§Follow-up register rows 2–3 and §D5; ledger rows `G2667-C4` / `G2667-C5` /
`G2667-D5`; [`dispatch-delivery-semantics.md`](old/proposals/dispatch-delivery-semantics.md).

---

## D-CROSSTENANT-ACK — `policy { deny on X }` is the `crossTenant` acknowledgment; `allow global` stays refused

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** What does an author write to acknowledge that a `crossTenant`
aggregate is deliberately unscoped, so that a `loom.crosstenant-needs-policy`
gate has something to require?

**Options.** (a) relax `loom.policy-target-not-tenant-owned` so
`policy { allow global on ExchangeRate }` is accepted as acknowledgment-only;
(b) accept an explicit `policy { deny on X }` (and any ordinary authorization
rule naming the target); (c) mint a new clause
(`crossTenant acknowledged` / `unscoped:`).

**Decision.** (b).

**Rationale.**

- **(a) carries a live trap.** The ladder's `allow global` lowers to a `scope`
  sentinel over the `dataKey` and `tenantId` COLUMNS — columns the `tenantOwned`
  capability provides and a `crossTenant` aggregate does not have. Admitting the
  rule therefore ALSO requires teaching enrichment to treat it as
  acknowledgment-only and derive no filter; miss that and the emitters reference
  columns that are not in the table (a codegen crash, or worse, DDL-valid but
  wrong SQL). `deny`'s always-false sentinel touches no column, so (b) has no
  such half.
- **(c) adds surface for a statement the policy block can already make**, plus a
  grammar rule, a printer arm and a per-backend no-op.
- **(b) keeps `loom.policy-target-not-tenant-owned` meaning what it says** — the
  read/write ladder is for tenant-owned targets — instead of acquiring an
  exception whose semantics differ from identical syntax on the next aggregate.

**Consequences.** A new `loom.crosstenant-needs-policy` requires every
`crossTenant` aggregate under a `tenancy by` system to carry an explicit
authorization rule naming it; a `deny` rule satisfies it, and so does any
`allow`/`policy` rule that names the target. Two fixtures gain the line
(`tenancy-owned.ddd`, `policy-deny.ddd`). D-TENANCY-SCOPE's safety note —
*"`crossTenant` is fail-open at the tenancy layer"* — finally gets its
enforcement: the fail-open stance becomes unwritable by accident, which is the
whole point of the acknowledgment.

**Unblocks.** M-T3.6 item (6) → wave **C6**.

**Sources.** [`T3-security-governance.md`](new-plan/T3-security-governance.md)
M-T3.6 (6); [`tenancy-authorization-final-surface.md`](old/proposals/tenancy-authorization-final-surface.md);
`src/diagnostics/messages.ts` `loom.policy-target-not-tenant-owned#read|#write`;
D-TENANCY-SCOPE, D-TENANCY-DEFAULT.

---

## D-READ-SURFACE-ORDER — projection masking first, then the two small gates, then the system-read construct

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** M-T3.15 has sat at `plan (awaiting sequencing sign-off)` while its
premise moved under it — in what order do its remaining items land?

**Options.** Masking first; the system-read construct first; the two small
security gates first.

**Decision.** In this order: **(1) re-verify the mission body against the merged
head** — #2523 landed the read-gate slice and #2766 moved more of it; **(2)
projection masking** (the `loom.field-mask-projection-source` launder, what is
left of root cause B); **(3) the two small, independent, security-relevant items
in the same wave** — gating the workflow-instance reads and the
`commandHandler`/`queryHandler` route gate; **(4) the system-read construct
last**, as its own mission.

**Rationale.**

- **Masking is what other work waits on.** Whether `sensitive-wire-unsupported`
  becomes M-T3.8 phases 2–4 or a recorded `scope` decision depends on whether a
  gated projection can carry `mask unless` at all — and that is a row in wave C2
  packet 2f. Masking first unblocks a drain; masking second means a second wave.
- **The launder is a security bug wearing documentation clothes.**
  `loom.field-mask-projection-source` makes gated projections and `mask unless`
  mutually exclusive, and *its own remedy points authors back at the ungated CRUD
  routes*. That should not sit behind a new-surface design.
- **The system-read construct is the only item that ADDS surface.** Under the
  standing owner directive (gaps and bugs outrank architectural improvements,
  which outrank new surface area) it goes last — and it is cheaper once masking
  has settled what a compiler-owned read may return.
- **(1) is not ceremony.** The mission header already says "premise partly
  stale", and two of its four root causes have been closed by merged PRs. The
  RUNBOOK requires the re-verification before any of (2)–(4).

**Consequences.** M-T3.15's status line carries this order, and the two small
gates may be split into their own headings if the wave needs the tree fence. If
the re-verification in (1) finds masking already resolved, the order collapses to
(3) then (4) and this tag is amended, not ignored.

**Unblocks.** M-T3.15 → wave **C6**; and the `sensitive-wire-unsupported` row in
wave **C2 packet 2f**.

**Sources.** [`T3-security-governance.md`](new-plan/T3-security-governance.md)
M-T3.15; [`M-T3.15 plan`](new-plan/missions/M-T3.15-read-surface-and-system-reads-plan.md);
PRs #2523, #2766; `src/diagnostics/messages.ts`
`loom.field-mask-projection-source`.

---

## D-LONG-AVG-DEFAULTS — `long` gets a declared 2^53 ceiling; projection `avg` over money is typed `money`

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** Two numeric rows whose proposed defaults were recorded but never
signed off: what is `long`'s contract, and what type does a query-time
projection's `avg` over a money column carry?

**Options (`long`).** (a) declare and enforce a 2^53 safe-integer ceiling now;
(b) upgrade the representation (BigInt / string wire) on node and python; (c)
leave it. **Options (`avg`).** (a) retype to `money`; (b) keep `decimal` and
document the divergence from the in-memory `avg`.

**Decision.** (a) and (a).

**Rationale (`long`).**

- Today node stores `long` as a JS `number`
  (`bigint(col, { mode: "number" })` in `src/generator/typescript/emit/schema.ts`;
  mikroorm `ts: "number"`) and python routes declared int/long sums through
  `float()` — both corrupt **silently** past 2^53, while .NET/Java/Elixir carry
  int64 exactly. There is no validator and no doc caveat.
- Aggregate overflow is three-way divergent for one `.ddd`: java's
  `((Number) x).intValue()` **wraps silently**, .NET's `(int)` cast **throws**
  (a 500), the rest pass the too-big value through. The unification takes .NET's
  behaviour: a value that does not fit is an ERROR. Java's silent wrap is the one
  shape that produces a wrong ANSWER instead of a failure.
- The ceiling is the honest floor at **S** cost: it converts silent corruption
  into a refusal today. The representation upgrade (b) is a wire change on two
  backends for a bound nobody has yet hit — it becomes a named follow-up mission
  only if the ceiling pinches.

**Rationale (`avg`).**

- `src/ir/lower/lower-projection.ts` stamps query-time `avg → decimal` even over
  a money column, so the mean of exact money crosses the wire as a float64 JSON
  number — while the **in-memory** `avg` of the same field types `money?`
  (`type-system.ts`) and ships the RS-12 four-decimal string. One word, two
  semantics, no gate.
- The retype is a lowering change, not five emitters: `aggregateCoercion`'s
  `isMoney` arm (`src/ir/util/projection-aggregate.ts`) already knows how to
  format money on all five backends.

**Consequences.** python's declared-int/long aggregates route through `int()`; a
`> 2^53` witness fixture proves the exact backends carry it and the ceiling
refuses on the others. The `avg` retype MOVES wire goldens, so it rides
D-DECIMAL-EXACT-MOMENT's single re-capture if both land in the same wave —
otherwise it carries its own reviewed re-capture, never a drive-by rebaseline.
Each arm is mutation-proved by file-copy revert.

**Unblocks.** M-T5.23 and M-T5.24 → wave **C2 packet 2f**.

**Sources.** [`T5-language-core.md`](new-plan/T5-language-core.md) M-T5.23,
M-T5.24; [`numeric-types-audit-2026-08-23.md`](audits/numeric-types-audit-2026-08-23.md)
F13, F14; RS-12; `src/ir/lower/lower-projection.ts`,
`src/ir/util/projection-aggregate.ts`, `src/generator/typescript/emit/schema.ts`.

---

## D-DAPPER-ALTER — dapper and mikroorm get a real ALTER path in phase ⑨; the widened refusal lands first

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** `persistence: dapper` (and its mikroorm twin) has no ALTER path at
all — is that a permanent `scope` row, or a phase-⑨ build?

**Options.** (a) a permanent `scope` row with a D-tag: "self-provisioning
adapters are CREATE-only by design"; (b) widen the honest gate so any
post-baseline schema change refuses; (c) render the `MigrationsIR` chain for
these adapters.

**Decision.** (c) — **build it** — with (b) landing FIRST, in the same wave, as
the interim.

**Rationale.**

- **(a) is not honest for a shipping adapter.** `renderDapperSchema`
  (`src/generator/dotnet/emit/dapper.ts:2229-2233`) is documented as "a
  self-applied CREATE TABLE IF NOT EXISTS per aggregate", and
  `grep -c 'ALTER TABLE|ADD COLUMN' src/generator/dotnet/emit/dapper.ts` is
  **0**. So on a dapper deployable: add a field to a live database and the column
  is never created (the app 500s); drop one and it lingers; change a type and
  nothing happens.
- **And the existing gate mostly does not fire.**
  `validateMigrationAdapterSupport`
  (`src/ir/validate/checks/migration-checks.ts:203-260`) raises
  `loom.dapper-unsupported#migrations` only when the model DECLARES a `migration`
  block — it indexes the rename/backfill/SQL-step intents and returns early when
  they are all empty. The common case is silent.
- **The build is bounded.** `emitDotnetMigrations` already produces
  platform-neutral Postgres through `src/generator/sql-pg.ts`. What is missing is
  emitting it as an ordered `.sql` set applied by `DbSchema.EnsureAsync` behind a
  `__loom_migrations` ledger, then flipping
  `const hasMigrations = !usingDapper && …` (`src/generator/dotnet/index.ts:990`).
  The mikroorm twin is `!usingMikro` at `src/platform/hono/v4/emit.ts:1067` and
  is ruled the same way here.
- **(b) first because (c) is L and a user can lose a column today.** The widened
  gate fires when a self-provisioning deployable is regenerated against an
  existing baseline whose derived diff is non-empty — the snapshot store is
  already threaded into phase ⑨ via `fsSnapshotStore(outDir)`.

**Consequences.** A named **T2 mission** owns the build, with a
`test:migration-evolution-dapper` (and `-mikroorm`) leg added to
`migration-evolution-e2e.yml` — today all five legs run on the default
efcore/drizzle adapters. `loom.dapper-unsupported#migrations`,
`loom.mikroorm-unsupported#migrations` and the ledger row
`dapper-no-schema-evolution` close when that leg is green, **not** when the gate
widens. Note what the widened gate replaces: today a second generate exits 1 on
snapshot drift with an error that names neither the adapter limitation nor a
remedy, and `--allow-rebaseline` does not clear it.

**Unblocks.** `dapper-no-schema-evolution` → wave **C2 packet 2b** (the mikroorm
arm in **2c**); M-T6.35's `#migrations` sub-code.

**Sources.** [`targets-completeness-2026-08-30.ledger.json`](audits/targets-completeness-2026-08-30.ledger.json)
row `dapper-no-schema-evolution` (fix field: both options, sized);
[`T6-backend-parity.md`](new-plan/T6-backend-parity.md) M-T6.35;
`src/ir/validate/checks/migration-checks.ts`, `src/generator/dotnet/emit/dapper.ts`,
`src/generator/dotnet/index.ts`, `src/platform/hono/v4/emit.ts`.

---

## D-PROJECTION-IMPLICIT-SUB — an `on(Event)` handler subscribes in-process whether or not a channel carries the event

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** Does a `projection … { on(e: E) { … } }` whose `E` is carried by no
declared `channel` fold, or not? (Today node folds it; python, java, .NET and
elixir never subscribe. This is register/ledger row B20 /
`G2646-open-projection-on-event-no-channel`.)

**Options.** (a) it folds — a channel is TRANSPORT, the `on` declaration is the
subscription; (b) it does not, and node's leniency becomes a refusal; (c) a
diagnostic requires the channel.

**Decision.** (a) — **implicit in-process subscription on every backend.**

**Rationale.**

- **(b) removes a working behaviour from a shipping backend to reach parity** —
  the shape D-WHEN-GATE-DOMAIN already rejected for the same reason.
- **`on(e: E)` reads as the subscription.** Nothing in the projection's own
  syntax mentions transport, and requiring a `channel` makes a read model's
  correctness depend on a declaration in a different block whose stated purpose
  (`docs/channels.md`) is cross-deployable delivery and durability.
- **The mechanism is one early return.** `deriveEventSubscriptions` opens with
  `if (!channels || channels.length === 0) return []`
  (`src/ir/enrich/enrichments.ts:1303`) and then keeps only events some channel
  `carries:`, so python emits no `app/dispatch.py` at all and java/.NET/elixir
  emit no fold, while `src/generator/typescript/emit/routes.ts` folds off the
  projection directly. The divergence is not a considered position on four
  backends; it is a guard nobody revisited.
- **Scope, stated so it is not re-litigated per handler kind.** The same
  derivation feeds workflow reactors (`on` and `create … by`), so the rule is
  written once for both: *an in-process handler in a deployable that also hosts
  the emitter subscribes implicitly.* A `channel` remains required for delivery
  ACROSS deployables and for durability (`retention:`) — which is what it is for.

**Consequences.** The early return is replaced by an implicit subscription
carrying no channel, and every backend's dispatcher builder learns the
channel-less subscription (python must emit `dispatch.py` in that case). No
diagnostic is needed on either side: the losing behaviour disappears rather than
being refused. A corpus fixture carrying a projection with NO channel — the shape
the audit had to construct by deleting a block from `projection.ddd` — enters the
fixture set in the same wave (rule 13), because a compile gate over a corpus that
lacks the shape proves nothing.

**Unblocks.** `G2646-open-projection-on-event-no-channel` (B20) → wave **C2
packets 2b / 2c / 2d / 2e**.

**Sources.** [`behavioral-parity-bugs-2026-07.md`](audits/behavioral-parity-bugs-2026-07.md)
B20; [`language-gaps-2026-08.md`](audits/language-gaps-2026-08.md) (the
"needs a semantics decision" row); `src/ir/enrich/enrichments.ts:1284-1340`;
`src/generator/typescript/emit/routes.ts`.

---

## D-FIRST-ON-EMPTY — `first` is partial and fails on an empty collection; `firstOrNull` is the total form

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** `.first` on an empty collection throws on three backends and yields
an `undefined`/`nil` typed as non-optional on two — which is the contract?

**Options.** (a) `first: T` is PARTIAL and fails on empty everywhere;
(b) `first` becomes `T?` (total), and every model reading `.first.x` must change;
(c) leave it per target.

**Decision.** (a). `first: T` keeps its non-optional type and **fails** on an
empty receiver on every target; `firstOrNull: T?` is the total form, and the
failure message names it.

**Rationale.**

- **(b) contradicts the declared signature.** `src/util/collection-ops.ts:23`
  already declares `first` as returning a non-optional `T`, and (b) would break
  every `lines.first.sku` in the language for a case authors can already express
  with `firstOrNull`.
- **The two degrading targets are the ones violating their own declared type.**
  node renders `${recv}[0]` (`src/generator/_expr/js-collection-ops.ts:67` →
  `undefined`) and elixir renders `List.first(${recv})` for **both** `first` and
  `firstOrNull` (`src/generator/elixir/render-expr.ts:905-906` — literally the
  same snippet), so a `string`-typed getter returns `nil`/`undefined` and the
  wrong value flows onto the wire or dies later somewhere that does not mention
  the collection. The three that fail — dotnet `.First()` (`:948`), java
  `.get(0)` (`:634`), python `[0]` (`:577`) — at least fail at the point of the
  mistake.
- **A failure at the read is diagnosable; a null that ships is not.** This is the
  same argument RS-34 makes for the absent-join case, reaching the opposite
  conclusion only because there the absent value has a MEANING (no joined row)
  and here it does not — the model asserted a first element exists.

**Consequences.** Mints **RS-36** in `docs/conformance-semantics.md` (RS-35 is
claimed by D-DECIMAL-EXACT-MOMENT in this batch). elixir moves `first` to `hd/1`
and keeps `List.first/1` for `firstOrNull`; node emits an explicit guard that
throws instead of `[0]`. The failure surfaces as the sanitized **500** RS-28
already governs — it is not a domain-floor 422, because the request was valid and
the model's assumption was not. The frontends follow the same rule under
`frontend-collection-op-unsupported` (wave C2 packet 2g) rather than degrading to
`undefined` in a page body; the seven emitters render the raise and the error
boundary shows it. The contract is pinned in `src/util/collection-ops.ts` the way
`src/util/intrinsics.ts` pins scalar edge behaviour, plus a per-backend arm test.

**Unblocks.** ledger row `F2-EXPR-7` → wave **C2 packet 2g** (frontend half:
M-T1.20).

**Sources.** [`targets-completeness-2026-08-30.ledger.json`](audits/targets-completeness-2026-08-30.ledger.json)
row `F2-EXPR-7` (its `fix` field poses exactly this fork);
[`conformance-semantics.md`](conformance-semantics.md) RS-28, RS-34;
`src/util/collection-ops.ts`, `src/util/intrinsics.ts`, the five
`render-expr.ts` leaf tables and `src/generator/_expr/js-collection-ops.ts`.

---

## D-ABSENT-JOIN-DATETIME-WIRE — an absent join value is wire `null` on every target; sub-second datetimes ship as milliseconds

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** Two wire-form questions the `G2667-D3` row left open: what does a
LEFT-JOINed field carry when the join target is absent, and what fractional-second
form does a `datetime` take on the wire?

**Options (join).** wire `null` everywhere / each language's own zero default /
drop the source row. **Options (datetime).** node's minimal-digit trim (`.12Z`) /
exactly three digits when a fraction is present (`.120Z`) / microseconds
(`.120000Z`).

**Decision.** **Join = wire `null`, on every backend and every field type** —
RS-34 already pins this and is ratified here, *including* the .NET value-typed
case its own "Open" section leaves unfixed. **Datetime = milliseconds: at most
three fractional digits, and a whole-second instant carries no fraction at all**
(RS-4's canonical `…00Z` is preserved).

**Rationale (join).** RS-34 is already in the registry with all five arms landed
and mutation-proven; the only fork left is .NET's `default!` on a value-typed
joined field, where a joined `int`/`bool`/`decimal`/`datetime` reads
`0`/`false`/`DateTime.MinValue` instead of `null`. That is not a second
semantics, it is an unfinished arm — and RS-34's own reason (wire `null` is the
only value that means the same thing on every backend and needs no per-type
default table) already decides it.

**Rationale (datetime).**

- **The observed triple has one mechanism per backend.** node canonicalises with
  `${date}.toISOString().replace(/\.?0+Z$/, "Z")`
  (`src/generator/typescript/repository-wire-builder.ts:139`), which strips ALL
  trailing zeros, so `.120` spells `.12Z`; java's `Instant.toString()` emits
  digits in groups of three (`.120Z`); python's `isoformat()` emits six
  (`.120000Z`); elixir emits none at all, because its column is `:utc_datetime`
  (second precision) where every other backend's is `TIMESTAMP WITH TIME ZONE`
  (ledger `F2-W-06`).
- **Milliseconds is the only precision every target can carry end to end.** node's
  `Date` is millisecond-resolution by construction, so a microsecond contract
  needs a NEW datetime carrier on node (a string or a decimal) — a far larger
  change than truncating four backends.
- **Three digits rather than node's minimal trim**, because `.12Z` and `.120Z`
  are the same instant spelled two ways: a differential tier comparing strings
  then has to normalise, and normalisation is exactly what hid `F2-W-05` and
  `F2-W-06`.
- **Correction to the plan's proposed default.** "millisecond precision, three
  digits, on every backend" as written contradicts **RS-4**, which is PINNED,
  conforming on all five, and says a whole-second instant spells `…00Z` with the
  zero fraction trimmed. This ruling therefore keeps RS-4's whole-second form and
  applies "exactly three digits" only when a fraction is present.

**Consequences.** Mints **RS-37** for the datetime wire form (RS-35 and RS-36 are
claimed elsewhere in this batch). RS-34 gains its .NET value-typed arm and its
"Open" section closes — the absent branch stops being `default!` and the
Response schema widens that joined member to nullable. Elixir moves declared
datetime columns to `:utc_datetime_usec` with the matching `timestamptz`
migration column **and deletes the truncation machinery that exists only because
of the old type** (`__truncate_dt/1` in `vanilla/context-emit.ts`,
`stampFieldIsDatetime` in `stamp-emit.ts`, the operation-returns `force_change`
wrap) — leaving it in place would truncate on the wider column and half-fix the
row. Sub-millisecond input is **truncated at ingress, not rounded**, so the
stored value and the wire value agree and a read-back equals the write (RS-4);
rounding can carry a value into the next second. The `<timestamp>` normalisation
that masks this in the differential tier is narrowed in the same PR, or the fix
cannot be seen.

**Unblocks.** `G2667-D3` (.NET value-typed arm) → wave **C2 packet 2d**;
`F2-W-06` → wave **C2 packet 2a**.

**Sources.** [`conformance-semantics.md`](conformance-semantics.md) RS-4, RS-34
(its Open section); [`targets-completeness-2026-08-30.ledger.json`](audits/targets-completeness-2026-08-30.ledger.json)
rows `G2667-D3-projection-join-unguarded-index` and `F2-W-06` (with the W1b
elixir note that sizes it);
`src/generator/typescript/repository-wire-builder.ts`,
`src/generator/dotnet/query-projection-emit.ts`,
`src/generator/elixir/vanilla/context-emit.ts`.

---

## D-FLUTTER-BEARER — Flutter native authenticates with a bearer token; Flutter web keeps the cookie

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** RULE 2 of the realtime contract says a stream carries the same
HttpOnly `session` cookie as an ordinary API call from the same frontend — a
mobile client cannot hold one. What credential does Flutter use?

**Options.** (a) bearer on native, cookie on web — two credentials in one client;
(b) bearer everywhere, so the Flutter web build drops the cookie too; (c) a
short-lived query-param token for the stream on native.

**Decision.** (a) — recorded as a **plan amendment to RULE 2**, not a port.

**Rationale.**

- An HttpOnly cookie **cannot exist** on an Android/iOS client, so RULE 2's
  stated credential is unavailable there by construction. RULE 2's own reasoning
  ("the SPA never sees the raw token") does not hold for a native app, whose OIDC
  client necessarily holds the token itself.
- **Server-side the change costs nothing.** Four of five backends already accept
  the `session` cookie *alongside* `Authorization: Bearer`, and node grew the
  cookie read in the same wave — bearer is the credential every backend has
  always accepted.
- **(c) puts a credential in URLs**, and therefore in access logs, proxies and
  `Referer` — the reason the query-param token lost the first time.
- **(b) would make the web build of a Flutter app diverge from every other
  generated SPA** for no gain; `BrowserClient()..withCredentials = true` is one
  line.

**Consequences.** The fix is **upstream of the stream**: Flutter's ORDINARY API
calls are bare top-level `http.get`/`http.post` with no client at all
(`src/generator/flutter/reads-emit.ts`, `forms-emit.ts`, `auth-gate.ts:90`,
`flutter-target.ts:621`), so there is no credential path for the stream to
inherit and fixing only the stream would be theatre. Order: **(i)** an
authenticated http client — `BrowserClient()..withCredentials = true` on web, a
bearer store fed by the app's OIDC client on native; **(ii)** thread the
credential into `renderFlutterRealtime` and emit
`web.EventSource(uri.toString(), web.EventSourceInit(withCredentials: true))` in
the web transport plus the bearer header in the IO transport (so
`REALTIME_SOURCE_WEB_DART` / `REALTIME_SOURCE_IO_DART` stop being const strings);
**(iii)** `realtimeStreamCredential` (`src/ir/util/realtime-rooms.ts`) gains the
native value, so the gate stays ONE predicate rather than two. `auth: none`
deployables stay byte-identical.

**Unblocks.** M-T4.12 item (1) → wave **C2 packet 2j**.

**Sources.** [`T4-eventing-temporal.md`](new-plan/T4-eventing-temporal.md)
M-T4.12 (Wave 1 packet 1g note, RULE 1 / RULE 2 and "Still open under this ID"
item 1); [`auth.md`](auth.md) ("Session depth");
`src/ir/util/realtime-rooms.ts`, `src/generator/_frontend/realtime.ts`,
`src/generator/flutter/realtime.ts`.

---

## D-MISC-C0 — four small rulings that needed a name, not a debate

**Status:** proposed (default applies 48 h after merge unless overridden).

**Question.** Four rows whose proposed answers nobody disputes, but which no tag
records — so each is re-decided by whoever picks the row up.

**Decisions.**

1. **`generateDotnetForContexts` (M-T9.52).** The boundary **stays where M-T9.49
   drew it**: the ratchet gates the WRAPPER (`generateDotnet`), mirroring Hono's
   (which gates `generateHono`, not `generateTypeScriptForContexts`). Sequence
   M-T9.42's corpus promotion of `generator-dotnet.test.ts` FIRST — it is 66 of
   the 150 pinned .NET call sites and M-T9.42's largest single candidate, so
   doing it first shrinks this row by nearly half and shrinks the ratchet's pins
   in the same move. Re-measure the remaining direct `ForContexts` importers
   afterwards, and only then decide whether the rung below needs its own
   assertion. Verification is **two-sided** per M-T9.40 (re-seed the
   `enumName: undefined` mutation and report the count with AND without the new
   assertion) — a one-sided "N tests fail" number does not distinguish a working
   instrument from an unrelated string assertion.
2. **`connection:` on a `storage` (M-T7.9) — the two semantics.** *(a)*
   `service(x)` **names** a service the composer is already synthesising; it
   selects and labels, it does not create a second one, so `service(db)` and no
   clause at all describe the same topology and the declaration's only effect is
   on the emitted reference (the secret/env key). *(b)* Where the declared source
   **contradicts** the derived topology, **the declaration wins** and the
   composer emits what was declared — a heuristic that silently overrides an
   explicit author statement is unexplainable at the point of failure, and the
   current `Host=db;` classifier in `src/system/kubernetes.ts` is exactly such a
   heuristic. `literal("postgres://user:pass@…")` stays legal and keeps its
   warning (it is a real escape hatch for an already-public external endpoint);
   revisit only if a model needs it silenced.
3. **OpenAPI tag grouping (M-T6.13), decision (f).** Emit an explicit lowercase
   per-op `tags: ["<slug>"]` on **.NET and Java too**. They emit no explicit
   per-op tag today, so this is not a regression — it aligns them with the other
   three. Without it, Swashbuckle/springdoc default the per-op tag to the
   CONTROLLER name (`"Orders"`), which `x-tagGroups`'s `"orders"` reference does
   not match, so the feature would silently not group on exactly two of five
   backends. **Verify the default-tag value on a booted app**, not from the
   framework docs — the proposal itself flags the value as extrapolated
   (rule 12).
4. **`scopeId` (M-T3.11).** `scopeId` denotes the **business boundary** a frame
   belongs to; `parentId` denotes **call structure** ("who invoked me") — the two
   axes `execution-context.md` separates and that are easy to conflate. Loom pins
   the DEFAULT rather than leaving it to configuration: **one scope per inbound
   request, or per workflow RUN, whichever opened the outermost frame; a
   sub-workflow opens its own scope, a helper call does not.** Leaving it "to the
   system author" is what let five backends differ. Not author-configurable in
   v1. The ambient carrier keeps its D-CTX-SHAPE field set (`correlationId`,
   `scopeId`, `parentId`, plus `currentUser`/`locale`/`startedAt`); the genealogy
   detail (`operationId`, `nodeId`, `kind`, `timestamp`) stays on the emitted
   scope event.

**Rationale.** Each of the four has a recorded leaning that survived a
code-check, and none has a second defensible answer that anyone has argued for;
what they lack is a NAME, so each is re-litigated by the next agent to open the
row. Item 4 is the most judgement-laden of the four — the proposal explicitly
left it open — and is the one most worth an owner glance.

**Consequences.** Four mission bodies stop carrying an undecided fork. Item 1
imposes a SEQUENCE (M-T9.42's promotion before M-T9.52), which the C3 packet must
honour. Item 2 deletes the `storage-connection` row from `RESERVED_SURFACES` when
the wiring lands, and the k8s emitter's `Host=db;` classifier is replaced by the
declared source rather than extended.

**Unblocks.** M-T9.52 → wave **C3 packet 3d**; M-T7.9, M-T6.13 and M-T3.11 →
wave **C6**.

**Sources.** [`T9-toolchain-health.md`](new-plan/T9-toolchain-health.md) M-T9.52;
[`T7-deployment-ops.md`](new-plan/T7-deployment-ops.md) M-T7.9;
[`api-openapi-tag-grouping.md`](old/proposals/api-openapi-tag-grouping.md)
§Open decisions (f);
[`T3-security-governance.md`](new-plan/T3-security-governance.md) M-T3.11 and
[`execution-context.md`](old/proposals/execution-context.md) §Open questions;
D-CTX-SHAPE.
