# D-DOCUMENT-AXIS — document storage as two orthogonal header axes

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
[`proposals/document-and-json-hierarchies.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/document-and-json-hierarchies.md).

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
