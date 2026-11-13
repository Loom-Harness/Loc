# Capabilities — `capability`, `filter`, `stamp`, `implements`

A **`capability`** is a first-class, pure-mixin declaration — a named
bundle of **fields + `filter` + `stamp`** that an aggregate opts into
with `with <Cap>` / `implements <Cap>`.  It is the typed successor to the
stringly-typed surface (`implements "X"` / `filter for "X"` /
`stamp for "X"`), which was **removed** — see
[`proposals/typed-capabilities.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/typed-capabilities.md) and
[`plans/typed-capabilities-implementation.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/typed-capabilities-implementation.md).

```ddd
capability softDeletable {
  isDeleted: bool internal
  deletedAt: datetime? managed
  filter !this.isDeleted            // behaviour the capability provides
}

aggregate Order with softDeletable { subject: string }   // gains the field + filter
```

`softDeletable`, `auditable`, `tenantOwned`, `tenantRegistry`, and `versioned`
ship **built in** (the toolchain prelude, `src/macros/prelude.ts`) — available by
name with nothing declared.  The prelude also declares `shareable`, a
member-less marker whose declarations the macro layer unfolds (see
[Relationship to macros](#relationship-to-macros)). The `softDelete()`/`restore()` operations stay in the `softDelete`
macro (operations aren't part of a pure-mixin capability): `with softDeletable,
softDelete`. Because the capability adds no operation, it does not change
`crudish`'s `destroy` either: on `with softDeletable, crudish`, `DELETE /{id}`
stays a hard delete (the advisory `loom.crudish-hard-delete` says so; see
[`scaffold-macros.md`](scaffold-macros.md#crudish-delete-under-softdeletable--loomcrudish-hard-delete)).
`tenantOwned` (tenant column + claim stamp + tenant read filter)
additionally requires a system-level `tenancy by` declaration — see
[`tenancy.md`](tenancy.md).

`auditable` **requires a principal**, for the same reason: it stamps
`createdBy`/`updatedBy` from `currentUser`, so the system needs a `user { ... }`
block and the hosting deployable needs `auth: required`. Without them there is
nothing to stamp from and the model is rejected
(`loom.stamp-principal-without-auth`):

```ddd
system Shop {
  user { id: string  email: string }                       // the principal …
  subdomain S { context S {
    aggregate Widget with crudish, auditable { code: string }
    repository Widgets for Widget { }
  } }
  deployable api { platform: node  contexts: [S]  …  auth: required }   // … and auth
}
```

`createdBy: User id` names that **principal**, not a domain aggregate — there is
no `aggregate User` and none is needed. The two fields are `managed`, so they
never appear as form inputs, and a scaffolded list/detail page renders them as
read-only stamped values rather than as links to an aggregate detail route.

`versioned` (optimistic concurrency) adds a single `rowVersion: int token = 1`
field (SQL column `row_version`, wire key `rowVersion`). Every backend's save
path emits a guarded write (`UPDATE … WHERE id = $1 AND row_version = $2`,
bumping `row_version`) and returns HTTP
**409 Conflict** when zero rows match — a lost-update guard with no explicit
version handling in the domain body. The counter counts **persisted commands**,
not changed columns: a command that only mutates a `contains` child, or that
re-assigns a value the row already holds, still bumps it (RS-20,
[`conformance-semantics.md`](conformance-semantics.md)) — which is why java maps
the column plainly and drives the bump itself rather than delegating to JPA
`@Version`:

```ddd
aggregate Order with versioned { subject: string }
```

The predicate `aggregateIsVersioned()` (`src/ir/util/versioned-capability.ts`) is
the shared gate the five backend repositories and the migrations builder read;
the counter's spellings come from one place, `src/util/row-version.ts`.

The counter is deliberately **not** called `version`: `version` is an ordinary
domain name (a rule set's version, a document revision), and a model may
declare `version` with any type as plain data. A user field that would land on
the counter's member or column — a non-`int` `rowVersion`, or another spelling
that snake-cases to `row_version` — is the error `loom.version-field-collision`.
The one exception is the exact field the capability splices, `rowVersion: int`:
it is what the structural printer and the "unfold macro" action eject for an
expanded aggregate, so it re-parses as the counter itself:

```ddd
aggregate RuleSet with crudish {
  version: int immutable = 1   // plain data — fine
  rowVersion: string           // loom.version-field-collision (`rowVersion: int` is the counter)
}
```

**Two guards, not one.** The `UPDATE … WHERE version = $2` above is *write-time*
CAS: it catches an interleave between the load and the save **inside one
request**. The guard that catches the user-visible lost update — two people open
the same record, both save, the second overwrites — needs the version the client
was *looking at*, and the client sends that as an `If-Match` entity-tag. The tag
is **quoted** (RFC 9110 §8.8.3): `If-Match: "3"`, byte-identical to the `ETag`
the read answered with. All five backends parse it; with the header absent each
falls back to the version it just loaded, so the write-time guard still runs and
the think-time one silently does not.

**Which write paths check which version** is one derived fact,
`checksVersion` (`src/ir/enrich/version-check.ts`), that the emitters render
rather than decide:

| Write path | `checksVersion` | Guard |
|---|---|---|
| any named operation of a `versioned` aggregate — `update`, every other command, value-returning or not, any saving shape | `if-match` (the header, falling back to the loaded version) | the row's `row_version` column |
| an operation of a `persistedAs: eventLog` aggregate | `handle` (the stream version the fold reached) | the `(stream_id, version)` key (RS-41) |
| a workflow / handler save of a row or stream the body **loaded** | `handle` | as above |
| a `create`, or a workflow save of a row the body **created** | `none` (an insert) | the primary key |
| the canonical `destroy` of a `versioned` aggregate | `if-match` (a stale tag is a 409 before the delete; no tag, or `*`, checks against the loaded version) | the row's `row_version` column |
| the canonical `destroy` of an event-sourced aggregate | `none` | — |

A write that loses its check answers 409 whether or not it carried a tag; the
client decides whether to retry, and the server never re-runs the command on its
own. Two simultaneous writers carrying the same tag yield exactly one 2xx and one
409 (RS-46). Node renders the fact (a census, `node-version-check-census.test.ts`,
keeps it that way); the other backends' gaps are tracked expected failures of
the `concurrency-two-writers` corpus case.

The generated **React, Vue, Svelte and Angular** clients send it on the `update`
operation, reading the version out of the by-id query cache — the row the user is
looking at, under the key the mutation already invalidates on success. **Feliz
and Flutter do not yet**: neither keeps the loaded record where the mutation can
reach it, so a hand-written client on those targets should send the header
itself. Which frontends send it is pinned by
`test/generator/if-match-client-parity.test.ts`, and that the five backends
accept the same grammar by `test/generator/if-match-grammar-parity.test.ts`.

## Surface

`filter` / `stamp` are also usable directly (the building blocks a
capability body is made of); `implements <Cap>` / `with <Cap>` apply a
capability:

| Where | What you write | Effect |
|---|---|---|
| Inside a `capability` | `<field>`, `filter <expr>`, `stamp <event> { … }` | Provided to every implementor. |
| Inside an `aggregate` | `filter <expr>`, `stamp <event> { … }`, `with <Cap>`, `implements <Cap>` | Applies to that aggregate. |
| Inside a `context` | `filter <expr>`, `stamp <event> { … }`, `with <Cap>`, `implements <Cap>` | `filter`/`stamp` propagate to **every** aggregate in the context; `with`/`implements <Cap>` apply the capability to every aggregate. |

The grammar rules are `Capability`, `FilterDecl`, `StampDecl`, and
`ImplementsDecl` in `src/language/ddd.langium`.

## `filter <expr>`

Declares a query-filter predicate the backend applies to every read
of the host aggregate.  The expression has `this` in scope and is
type-checked exactly like an invariant body.

```ddd
aggregate Order {
  isDeleted: bool
  subject: string

  filter !this.isDeleted          // every read excludes soft-deleted rows
}
```

To apply a filter to *some* aggregates in a context but not others,
bundle it in a `capability` and opt in per aggregate — the typed
replacement for the old `filter for "<name>"` string-group form:

```ddd
capability softDeletable {
  isDeleted: bool
  filter !this.isDeleted
}

context Sales {
  aggregate Order  with softDeletable { subject: string }  // gains the filter
  aggregate Public { name: string }                        // no filter
}
```

### Principal terms

A filter may also test the **principal alone**: a `==` / `!=` between
`currentUser.<claim>` and another claim, a literal or an enum value, with no
column on either side.  This is how a filter branches on role — "agents see
every ticket, customers see their own":

```ddd
aggregate Ticket {
  customer: Customer id
  filter currentUser.role == "agent" || this.customer == currentUser.customerId
}
```

The term's truth depends only on who is asking, so each backend decides it
against the request principal in the host language and drops the result into
the query as a constant:

| Backend | `currentUser.role == "agent"` renders as |
|---|---|
| node / Drizzle | `(requireCurrentUser().role === "agent" ? sql\`true\` : sql\`false\`)` |
| node / MikroORM | `{ [raw(requireCurrentUser().role === "agent" ? "1 = 1" : "1 = 0")]: [] }`, inside the entity's default schema filter (`cond: () => (…)`, evaluated per query) |
| .NET / EF Core | `_currentUser.User.Role == "agent"` inside `HasQueryFilter` (EF binds it as a parameter) |
| .NET / Dapper | `@__pt_<hash>`, bound to `(RequestContext.Current!.CurrentUser!.Role == "agent")` |
| Java / JPA | `:#{@currentUserAccessor.user() != null and (@currentUserAccessor.user().role() == 'agent')} = true` (`cb.conjunction()` / `cb.disjunction()` in a Criteria `Specification`) |
| Python / SQLAlchemy | `literal(user.role == "agent")`, built in the read-scope hook from the request principal |
| Phoenix / Ecto | `^(not is_nil(current_user) and current_user.role == "agent")` |

Null semantics are Loom's on every backend (a null claim equals `null` and
differs from every value — which a SQL `$1 <> 'agent'` over a null claim would
not give, so no backend leaves the comparison to SQL), and the term is never
true without a principal.  Because a capability filter is installed on every
read of the aggregate, the synthesised `GET /<plural>/{id}` included, a
principal term is the way to scope single-record reads by role today (the
by-id route has no `requires` surface; see `loom.default-deny-by-id-ungated`
in [auth.md](auth.md)).  A filtered-out row reads 404 there.

A typed `kind: api` call to another deployable forwards the caller's own
credential ([auth.md](auth.md#calling-an-api-that-requires-auth)), so the
callee's capability filters and stamps (`currentUser` included) run against
that forwarded principal.

Only `==` / `!=` qualify — an ordering between two host values has no single
meaning across the host languages — and only in a capability `filter` (inline,
or through a named `criterion` installed as `filter <Criterion>`).  A `find` /
`retrieval` `where` still refuses a column-free comparison
(`loom.find-where-not-queryable` / `loom.retrieval-where-not-queryable`): a
per-read principal test is what `requires` is for.

### Backend emission

All five backends — .NET, Hono, Java, Phoenix, and Python — reify
capability filters on every persistence shape (relational, `shape: document`,
`shape: embedded`), both non-principal and principal-referencing (tenancy).
There is no per-backend deferral table; the one gate is shape- and
backend-independent (see *What the validator gates* below).

- **.NET / EF Core 10** — every aggregate that has any propagated
  `contextFilters` gets one **named** `b.HasQueryFilter("<Name>", x => …)`
  per filter inside its `EntityConfiguration.Configure(...)` method
  (EF Core 10 *named query filters*).  Names are derived from the
  reified `criterion` name (`activeOnly` → `"ActiveOnlyFilter"`) or, for
  anonymous predicates, from the single column they touch
  (`!this.isDeleted` → `"IsDeletedFilter"`), falling back to a positional
  `"Filter<n>"`.  Naming matters: pre-EF-10 a second `HasQueryFilter`
  call **silently overwrote** the first, so an aggregate carrying two
  capability filters (e.g. `softDelete` + a tenancy `filter`) lost one at
  runtime — named filters make all of them additive again, and let a
  query selectively bypass just one via `IgnoreQueryFilters(["<Name>"])`.
  Emission is per-entity-type; the filter applies to *every* query of that
  aggregate (capability application was resolved earlier, at expansion +
  lowering).  **Under `sharedTable` (TPH) inheritance the entity type is the
  hierarchy ROOT** — EF accepts a filter nowhere else.  A filter the root
  declares is registered there once and reaches every subtype, so a subtype's
  `ignoring <rootCap>` names the root's filter; a subtype's own filter is
  registered on the root config, type-guarded
  (`!(x is Car) || (!((Car)x).IsDeleted)`) — so it may read a column only that
  subtype declares — and prefixed (`"Car_IsDeletedFilter"`) so two subtypes
  carrying the same capability keep distinct keys.  Every read of a TPH
  concrete starts from the root set (`_db.Vehicles.OfType<Car>()`), the source
  over which EF translates the guard (docs/inheritance.md).  EF Core resolves the
  DI-scoped principal and queries jsonb transparently, so .NET has no other
  further gates.  See
  `src/generator/dotnet/emit/efcore.ts`.
- **Hono / Drizzle** — Drizzle has no global query filter, so the
  repository builder AND-s each predicate into every root-table read
  site (`src/generator/typescript/repository-find-predicate.ts`).  A
  **principal** predicate renders against the ambient
  `requireCurrentUser()` accessor (the analog of EF Core's
  DI-resolved principal); a **non-relational** aggregate filters in-app
  over the rehydrated `document`, or AND-s into the SQL read for an
  `embedded` root (whose scalars are real columns).
- **Python / SQLAlchemy** — SQLAlchemy's native global-criteria hook: one
  `do_orm_execute` listener (`app/db/read_scope.py`,
  `src/generator/python/read-scope-builder.ts`) adds each restriction to every
  ORM SELECT as `with_loader_criteria(<Row>, …)`, so no repository read
  spells one.  `ignoring` is the `loom_ignoring` execution option.  A
  **principal** predicate is built from the request principal on each
  execution (`false()` with none); a TPH subtype's own filter is hosted on
  the root row class, guarded by `kind`; by-id reads run a `select` with
  `populate_existing` so the identity map cannot answer for the hook.  A
  `document` aggregate filters in-app over the rehydrated instance.
- **Java / Hibernate** — a static `@SQLRestriction("…")` on the
  entity for the non-principal predicate (`src/generator/java/emit/entity.ts`);
  a **principal** predicate (tenancy) is an auto-enabled `@Filter` whose
  claims are `@ParamDef` parameters, each resolved from the request
  principal per query (`CurrentUserAccessor.currentOrNull()`; no principal
  binds null and matches no row) — so it scopes every query of the entity,
  Spring Data's `findAll`/`existsById` and the `bumpVersion` update
  included, and no `@Query` spells it.  A write scope narrower than the read
  scope is a `<Agg>_writeScope` filter the command load enables.  A
  **non-relational** aggregate filters in-app via `findAll().stream()`
  for `document`, or rides the same `@SQLRestriction` for an `embedded`
  root.  A capability some read `ignoring`s is instead an auto-enabled,
  by-key named filter (`@FilterDef(autoEnabled = true, applyToLoadByKey =
  true)` + `@Filter`) that the bypassing read disables.  Under TPH every
  restriction is hosted on the ROOT entity: the root's own unguarded, each
  concrete's own guarded by `kind` (a subtype's filter is named
  `<Concrete>_<cap>`), because Hibernate refuses `@SQLRestriction` on a
  SINGLE_TABLE subclass and applies a subclass `@Filter` only to queries of
  that subclass, never to `from <Base>` or `find(<Base>.class, id)`
  (`src/generator/java/capability-filter.ts` `restrictionHostFor`).  A
  restricted aggregate's `findById` is a JPQL query: a primary-key `find` of
  a row the session already manages runs no SQL, so no restriction applies.
- **Phoenix / Ecto** — the schema module hosts the read scope
  (`src/generator/elixir/vanilla/read-scope-emit.ts`): `base_query/0`
  carries the TPH `kind` and the restrictions no `ignoring` can drop, and
  every repository read, retrieval and query projection starts from it;
  each bypassable or principal-bound filter is a `__loom_filter__/3` clause
  the generated `Repo.prepare_query/3` applies to every query of the schema
  (preloads excepted), so no read spells one.  `ignoring` is the
  `skip_filters:` Repo option (`[:soft_deletable]`, or `:all`).  A
  **principal** predicate pins `^(current_user && current_user.<claim>)`
  against the read's `current_user:` option or the ambient principal
  (`default_options/1`, Ecto's multi-tenancy guide) and **raises** when
  neither is set; `Repo.async/1` carries the principal into a task.  A TPH
  root's schema hosts its subtypes' own filters guarded by `kind`.  A join
  is not reached by `prepare_query`, so a joined read keeps an explicit
  predicate.  An **`embedded`** root rides the same scope; a `document`
  aggregate filters in-app over the rehydrated embed.

A filter that is *exactly* one named `criterion` (`filter NotDeleted`)
**reifies** rather than inlining: the IR carries the reference in
`contextFilterRefs` (index-aligned with `contextFilters`), and Hono
calls the module-level `<name>Criterion` predicate fn while Phoenix
references a shared Ecto query fragment (a `<name>_criterion/0` dynamic,
e.g. `dynamic([r], r.active)` / `dynamic([r], r.region == "EU")`) —
deduped with any find/retrieval consumers of the same criterion.  Behaviour-identical
to the inline form; only the generated code is organised around the
criterion as a first-class, reusable predicate.

### What the validator gates

One model-level rule remains (`validateContextFilterSupport`, code
`loom.context-filter-no-principal`): a principal-referencing filter needs a
request principal, so a deployable **without** `auth: required` (and a system
`user {}` block) that hosts one is refused.  It holds on every backend and
every shape.  A query-time `projection` aggregating in SQL over a filtered
`shape: document` aggregate has no column to name
(`loom.projection-document-source-capability-filtered`); per-row reads still
apply the filter on hydration.  Chapter 11 of the
[language reference](language-reference/11-capabilities-filters-stamps.md)
carries the per-shape detail.

## `stamp <event> { … }`

Declares lifecycle assignments to run on every create or update of
the host aggregate.  `<event>` is `onCreate` or `onUpdate`; the body
is the same `AssignOrCallStmt*` shape as an `operation` body, with
`this` in scope.

```ddd
aggregate Order {
  subject: string
  createdAt: datetime
  updatedAt: datetime

  stamp onCreate {
    createdAt := now()
  }
  stamp onUpdate {
    updatedAt := now()
  }
}
```

To apply stamps to some aggregates and not others, bundle them in a
`capability` (the built-in `auditable` is exactly this) and opt in per
aggregate with `with auditable`, which contributes the four audit fields
(`createdAt`, `updatedAt`, `createdBy`, `updatedBy`) and both stamps — nothing
is declared by hand. The principal-typed `createdBy` / `updatedBy` come only
from `auditable`: a hand-written `createdBy: User id` does not resolve.

### Stamp targets are server-owned wire fields

A field assigned by any `stamp` block is server-populated at persist
time, so it is **never client input** — on create *or* update — while
staying readable everywhere:

- Enrichment promotes a stamp target that is still create-writable to
  `access: managed` (`promoteStampTargets`), which drops it from the
  create-input contract (`forCreateInput`) every backend's Create
  request DTO, the frontend api-module schema, the scaffolded
  create-form inputs, and the Playwright page-object fill derive from.
- The `crudish` `update` operation excludes stamp targets from its
  params (`writableUpdateFields`), so the Update request DTO — which is
  shaped from those params on every backend — cannot mass-assign a
  stamped column (often the very one a row-security `filter` reads).

Read surfaces (responses, views, detail/list pages) keep the field —
`managed` is readable.  Pinned cross-backend by
`test/conformance/stamp-request-no-leak-parity.test.ts`.

### Backend emission

- **.NET / EF Core** — context stamps are emitted as a
  `SaveChangesInterceptor` (`AuditableInterceptor`) registered on
  the `DbContext`.  The interceptor fires during `SaveChangesAsync`
  with a per-entity-type switch — one arm per aggregate that has
  any stamping rules — and applies the `onCreate` / `onUpdate`
  assignments based on `entry.State`.  The interceptor body
  renders through the same expression machinery operation bodies
  use, so `currentUser` / `now()` / etc. resolve normally.  See
  `src/generator/dotnet/emit/auditable-interceptor.tpl.ts`.  Note
  that this means stamps fire at *save time*, after the operation
  body has already run.
- **Java / JPA** — a bare `now()` / bare `currentUser` stamp rides Spring
  Data auditing (`@CreatedDate`/`@LastModifiedDate`,
  `@CreatedBy`/`@LastModifiedBy`); every other value (a claim read, or a
  computed value such as `now() + hours(slaHours())`) is assigned in the
  entity's `@PrePersist _stampOnCreate()` / `@PreUpdate _stampOnUpdate()`
  hooks against `this`.
- **Hono** (`node`) — context stamps are applied persist-time by
  `db/audit-stamp.ts`, which holds one `stampInsert<Agg>` / `stampUpdate<Agg>`
  pair per stamping aggregate; the repository `save()` wraps its insert row
  and update set in its own aggregate's pair.  A `now()` value renders to
  `new Date()`; a bare `currentUser` value resolves to the ambient
  `ctx.actorId`; a value reading the aggregate renders against the domain
  instance the save site passes (`aggregate.slaHours()`).
- **Python / FastAPI** — context stamps are applied right before the
  repository persist: the domain class gets `_stamp_on_create` /
  `_stamp_on_update` methods (`now()` → `datetime.now(UTC)`; a `currentUser`
  value → `current_user.id`, threaded from `request.state.current_user`) that
  the route handler calls before save.  The in-process save sites — workflow
  command routes, explicit command handlers, event reactors — call the same
  methods (`src/generator/python/stamp-call.ts`): a `let x = X.create(…)`
  binding takes the create stamp, a loaded one the update stamp, and a
  principal stamp reads the ambient principal (`app.auth.user.current_user()`);
  a save with no principal in scope (an outbox-relayed reactor) persists
  unstamped, as Hono's does.
- **Phoenix** (`elixir`, plain-Ecto foundation) — context stamps
  are applied as `Ecto.Changeset.put_change` pipe lines on the changeset right
  before `Repo.insert` / `Repo.update` (threaded through the context
  `create_<agg>` / `update_<agg>` delegate into the repository).  `now()`
  renders to `DateTime.utc_now()`, and a `currentUser` value resolves to the
  principal id read off the threaded `current_user` map (`current_user.<idKey>`,
  nil-safe) — the controller pulls it from `conn.assigns.current_user` (the Auth
  plug populates it) and threads it on the write call.  `onCreate`
  stamps apply on insert only and `onUpdate` stamps apply on BOTH insert and
  update, so a NOT-NULL `updated_*` audit column is filled on the initial insert.
  The audit `createdAt`/`updatedAt` become real Ecto schema fields (replacing the
  bundled `timestamps()`), and the managed `createdBy`/`updatedBy` are excluded
  from the changeset cast.  See `src/generator/elixir/vanilla/stamp-emit.ts`.

### Validator-gated stamp cases

Stamp refusals read only the model, so they are the same on every backend:
`loom.stamp-principal-without-auth` (a `currentUser` stamp on a deployable
without auth), `loom.stamp-on-event-sourced-invalid` (a lifecycle stamp on an
event-sourced aggregate), `loom.stamp-read-before-flush` and, for one elixir
shape, `loom.stamp-reads-aggregate-unsupported`.  See chapter 11
([Validator-gated stamp cases](language-reference/11-capabilities-filters-stamps.md#validator-gated-stamp-cases)).

## `implements <Cap>` / `with <Cap>`

Apply a capability to the host: the expander deep-clones the
capability's members (fields + `filter` + `stamp`) into the aggregate
(or, at context scope, into every aggregate in the context).  `with` and
`implements` are synonyms for this; `with` additionally drives macros.

```ddd
aggregate Order with softDeletable, auditable { subject: string }
// or, equivalently for capabilities:
aggregate Order { subject: string  implements softDeletable  implements auditable }
```

A `with`/`implements` naming neither a macro nor a declared capability
is an **error** — the existence check the old free-string form lacked.
References resolve against the expander's document-wide capability
inventory (built-ins + user `capability` declarations), not a Langium
cross-reference.

## Propagation rules

At expansion time the typed `with`/`implements <Cap>` is spliced into
the host (`src/macros/expander.ts`); at lowering time
(`src/ir/lower/lower-capabilities.ts`) context-level `filter`/`stamp`
members propagate to every aggregate in the context:

| Declaration | Applies to |
|---|---|
| `filter <expr>` at context scope | every aggregate in the context |
| `stamp <event> { … }` at context scope | every aggregate in the context |
| `with <Cap>` / `implements <Cap>` at context scope | the capability is applied to every aggregate in the context |
| `with <Cap>` / `implements <Cap>` at aggregate scope | the capability is applied to that aggregate |
| any of the above on an `abstract` base | every concrete that `extends` it, transitively (enrich pass, `src/ir/enrich/inherited-capabilities.ts`) |

A base's capabilities apply to every subtype (D-INHERITED-CAPABILITIES): the
concrete inherits the base's filters (ancestors' first, then its own), stamps,
capability tags and `crossTenant` stance, so `ignoring <baseCap>` is valid on a
subtype read. A subtype repeating a capability its base applies gets that
filter once. See [`inheritance.md`](inheritance.md#capabilities-and-inheritance--a-bases-capabilities-apply-to-every-subtype).

### The read-scope fact

What a read of an aggregate applies is one derived IR fact,
`readScopeFor(agg, pool, { ignoring })` (`src/ir/enrich/read-scope.ts`). It
lists, in order: the TPH `kind` discriminator, then every filter — inherited
first, then the aggregate's own. Each filter is tagged with its kind
(`tenancy` / `capability` / `deny` / bare `filter`), the capability that
contributed it, whether `ignoring` can drop it, where it is declared, and, for
`tenancy`, its stance (`tenant` — the flat `tenantId ==` floor — or `self`, the registry's own-row scope). For a TPH root, the
fact also gives each concrete's own filters in root-hosted form, guarded by the
discriminator (`kind <> 'Car' OR <pred>`). A read that declares no order is ordered
by `id` (`readOrderFor`). Today the node/drizzle read paths take their
restrictions and their default order from this fact, and Java/Hibernate takes
its entity restrictions from it. The other backends still derive them from the
IR arrays.

## Relationship to macros

The two mechanisms split by what they add:

| | Capability | Macro |
|---|---|---|
| Adds | fields, plus `filter` (read path) and `stamp` (save path) contributions | declarations and behaviour: operations, aggregates, events, policies, workflows, pages |
| Applied with | `with Cap` / `implements Cap` on an aggregate (or context) | `with Macro(...)` on its target (aggregate, context, ui, api) |
| Defined in | `capability Name { … }` (`.ddd`), or the prelude | TypeScript via `defineMacro` ([`macro-api.md`](macro-api.md)), or the stdlib |
| `unfold` shows | the mixed-in fields, filter and stamps | the generated source |

A `capability` subsumes the field/filter/stamp macros: `auditable`,
`softDeletable`, `tenantOwned`, `tenantRegistry` and `versioned` are built-in
capabilities, not macros.  Macros remain for **operations and structure** —
`softDelete` (operations), `crudish`, `scaffold*`.  See
[`scaffold-macros.md`](scaffold-macros.md).

A feature that needs both halves pairs them: `with softDeletable, softDelete`
is the capability (field + filter) next to the macro (the `softDelete()` /
`restore()` operations).

`shareable` is the one built-in that is **both under one name**: the prelude
declares it as a member-less capability *marker*, and the macro layer
(`src/macros/stdlib/shareable/`) unfolds, for every aggregate carrying the
marker, the share declarations into its context — the `<X>Share` aggregate,
the `<X>Shared` / `<X>Unshared` events, the `GranteeIsMe` / `SharedWithMe`
policy functions and the sharing rules ([`auth.md`](auth.md#sharing--shareable)).
So `with shareable` reads like a capability, but what it adds is macro output:
`unfold` ejects it as editable source, and an authored member of the same name
wins.

## Validation rules

- A `with`/`implements` naming no macro and no declared capability is an
  error.
- A capability with no implementors is allowed (declared but unused).
- Field references inside a capability's `filter` / `stamp` body
  type-check against each implementing aggregate, so a capability whose
  `stamp onCreate { createdAt := now() }` assigns `createdAt`
  requires every implementor to have a `createdAt: datetime` field — a
  missing field is an IR-validation error.

## Feature compositions

A capability composes with how its aggregate persists and where the aggregate sits in an
inheritance hierarchy. Each such pair has a verdict per backend in the capability table,
`src/util/target-capabilities.ts` (`FEATURE_AXES` × `COMPOSING_AXES`). A pair is either
supported, which means a behavioural corpus fixture runs it on that backend, or refused
at the aggregate with `loom.target-unsupported`:

| pair | verdict |
|---|---|
| `persistedAs: eventLog` with `versioned` | refused on every backend (`#feature-composition-broken`). The stream is the concurrency control, and nothing folds the spliced `version`. |
| `persistedAs: eventLog` with `softDeletable` | refused on every backend (`#feature-composition-broken`). No event-sourced read filters `isDeleted`. |
| `persistedAs: eventLog` with `auditable` | refused by `loom.stamp-on-event-sourced-invalid`. |
| `persistedAs: eventLog` with `tenantOwned` | supported, except on node's `persistence: mikroorm`: the stream carries its tenant as stored-event metadata ([`tenancy.md`](tenancy.md#event-sourced-aggregates--the-tenant-lives-on-the-stream)). |
| `shape: document` with `softDeletable` | supported, except on elixir (`#feature-composition-broken`): the declared create there demands `isDeleted`. |
| `persistedAs: eventLog` / `shape: document` with a `provenanced` field; `shape: document` with `auditable`; `auditable` or a `provenanced` field anywhere in a hierarchy; `softDeletable` on an abstract base | refused on every backend (`#feature-composition-unwitnessed`): no behavioural fixture runs the pair yet. |

Every other pair of these axes is supported on all five backends.

Pairs whose features meet at a deployable, a resource or a field, rather than on one aggregate, are rows of the same table (`BackendConstruct` / `RefusableUiConstruct`). Each is refused where noted:

| pair | refused on |
|---|---|
| an event-sourced aggregate emitting an event a broker-bound channel carries | node, dotnet (the event append and the outbox row commit separately); python, java, elixir (unwitnessed) |
| a `timerSource` whose event rides a broker-bound channel | node (the tick is dispatched in-process); the other four (unwitnessed) |
| a value object field whose type is a value object with an invariant | elixir (the inner invariant never runs) |
| an event carrying a `mask unless` value on a channel | every backend (`loom.field-mask-event-channel`) |
| a unique key over a `mask unless` field whose create is not gated on the mask | every backend (`loom.field-mask-unique-oracle`) |
| an operation answering `<payload> or <error>`, served to a ui | react, vue, svelte, angular (the api client does not compile) |

```ddd
event Opened { account: Account id, owner: string }
aggregate Account persistedAs: eventLog, with versioned {
  owner: string
  create open(owner: string) { emit Opened { account: id, owner: owner } }
  apply(e: Opened) { owner := e.owner }
}
// loom.target-unsupported: aggregate 'Account' (`persistence:eventLog` with
// `capability:versioned`) — deployable 'd' (backend 'node') generates code for
// this combination that compiles but does not behave as either feature promises.
```

Nothing is generated for a refused pair. To support a pair on a backend, add a corpus fixture
that reaches it and runs a `test e2e` block there. Then name the fixture in the cell.
`test/system/feature-composition-table.test.ts` checks that the fixture reaches the pair.
