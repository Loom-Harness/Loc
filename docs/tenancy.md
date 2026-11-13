# Multi-tenancy — `tenancy by`, `tenantOwned`, `crossTenant`

First-class B2B tenant isolation. One system-level declaration names the
tenant claim and the tenant registry; every aggregate then declares its
stance explicitly, and the toolchain applies the read scope to every
generated query — the "forgot the filter on one query" cross-tenant leak
becomes a compile error instead of an incident.

One clause opts a read out of it, and it is the only one: `ignoring
tenantOwned` / `ignoring *` (the deliberate platform-admin cross-tenant
report — see [`ignoring` and the tenant filter](#ignoring-and-the-tenant-filter)
below).  It is not silent: every read that drops a tenancy filter raises
`loom.tenancy-filter-bypass`, in every `auth { enforcement: }` mode.

Design record: [`proposals/multi-tenancy-design-note.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/multi-tenancy-design-note.md)
(R1–R5); data visibility is flat by
[D-TENANCY-FLAT](decisions.md#d-tenancy-flat--data-visibility-is-flat-the-org-tree-manages-sub-tenants-the-operating-org-and-its-ancestors-are-resolved-per-request).

## Surface

```ddd
system Billder {
  user { id: guid  email: string  tenantId: string }

  tenancy by user.tenantId of Organization      // claim + registry, one line

  subdomain Billing {
    context Catalog {
      aggregate Plan crossTenant { code: string  monthlyPrice: decimal }
    }
    context Invoicing {
      aggregate Invoice with tenantOwned { number: string  amountDue: decimal }
    }
    context Accounts {
      // The registry — named in `of`, no tenancy marker.  `with crudish` is not
      // decoration: the signup bootstrap two sections down turns on `POST
      // /organizations` existing, and an aggregate with no `create` emits a
      // read-only API.  `tenancy-owned.ddd` — the fixture that pins the
      // bootstrap end-to-end — declares it the same way.
      aggregate Organization with crudish { name: string }
    }
  }
  // deployables need `auth: required` — the filter/stamp read the principal
}
```

- **`tenancy by user.<claim> of <Registry>`** — a `system` member (peer of
  `user {}` / `auth {}`). Names the user-shape field that carries the tenant id
  and the one aggregate that is the tenant registry. At most one per system;
  the claim field must exist on `user {}`; the registry must exist.
- **`with tenantOwned`** — a built-in prelude capability
  (`src/macros/prelude.ts`, next to `auditable` / `softDeletable`). Unfold it
  and you get exactly:

  ```ddd
  aggregate Invoice {
    number: string
    amountDue: decimal
    // — what `with tenantOwned` expands to —
    tenantId: string internal
    stamp onCreate { tenantId := currentUser.tenantId }
    filter this.tenantId == currentUser.tenantId
  }
  ```

  The `tenantId` column lands in the migrations automatically — **with a
  derived non-unique `(tenant_id, id)` index, `<table>_tenant_id_id_idx`**
  (every tenant read prefixes on `tenant_id`, and a list orders by `id`, so the
  composite serves the page in index order; derived in the shared
  `MigrationsIR`, so all DB backends emit it); `internal` keeps the column out of create inputs (the client can
  never pass it); the filter is AND-ed into **every** generated read on all
  five backends; the stamp copies the claim at create.

  **The two `tenantId`s are different things.** The one on the row is the
  COLUMN this capability provides — always spelled `tenantId`, not the
  author's to rename. The one it is compared against is the **declared
  claim**, whatever `tenancy by user.<claim>` named. They coincide in the
  examples here only because those declare the claim as `tenantId`. Under
  `tenancy by user.orgId`, node emits
  `eq(t.tenantId, requireCurrentUser().orgId)` and stamps
  `tenantId: currentUser.orgId`. The capability itself cannot see the
  declaration (a prelude definition has no system in scope), so enrichment
  binds the principal side in phase ⑥ — the same pass that derives the
  registry self-scope, which is why both halves agree on one claim.

  The node stamp, for the `Invoice` above:

  ```ts
  // db/audit-stamp.ts (generated)
  export function stampInsertInvoice<T extends Record<string, unknown>>(row: T): T {
    const ctx = requestContext();
    if (!ctx) return row;
    const currentUser = ctx.currentUser as User | null;
    if (!currentUser) return row;
    if (currentUser.tenantId == null || currentUser.tenantId === "") {
      throw new ForbiddenError("Forbidden: the access token carries no \"tenantId\" claim, which this system stamps into tenantId on every write. Obtain a token whose \"tenantId\" claim is set.");
    }
    return { ...row, tenantId: currentUser.tenantId };
  }
  ```

  ```sql
  -- db/migrations/…_billing_initial.sql (generated)
  CREATE TABLE "invoicing"."invoices" (
    …
    "tenant_id" TEXT NOT NULL,
    …
  );
  CREATE INDEX "invoices_tenant_id_id_idx" ON "invoicing"."invoices" ("tenant_id", "id");
  ```

  `tenantId` is the only column tenancy adds to a row. Where an org sits in
  the registry tree takes no part in a data read: a row is visible to its own
  org only.
- **`crossTenant`** — an aggregate-header modifier, for shared reference data
  (`Plan`, `Country`). A stance marker: attaches nothing, generates nothing — it
  exists so "no tenant filter" is a declared decision, never an accident. It sits
  in the header region **after** the aggregate name, alongside the realization
  axes (`persistedAs:` / `shape:` / `inheritanceUsing:`) and order-independent
  with them — `aggregate Plan crossTenant { … }`. It is deliberately *not* a
  leading adjective like `abstract`: `abstract` says what the aggregate **is**,
  while `crossTenant` declares how it **participates** in the `tenancy by`
  facility.
- **The registry** gets no marker — it is self-keyed (its "tenant" IS its own
  id), so neither stance fits it. It does get generated read behavior: the
  **derived self-scope filter** (below). Who may read or edit
  organizations beyond that is authorization's job.

## The registry: derived self-scope + claim-less bootstrap

`tenantId ≡ <Registry>.id` is a **derived type link**:
from the `tenancy by` declaration alone, every read of the registry is scoped
to the caller's own org. You never write this filter — enrichment appends it
to the registry's capability filters, so it rides the exact pipeline
`tenantOwned`'s predicate uses:

```ddd
aggregate Organization { name: string }   // you write only this
// derived by the toolchain (never in source):
//   filter this.id == currentUser.tenantId
```

```ts
// node — db/repositories/organization-repository.ts (generated)
async all(): Promise<Organization[]> {
  const rootRows = await this.db.select().from(schema.organizations)
    .where(eq(schema.organizations.id, requireCurrentUser().tenantId));
  ...
}
```

So `GET /organizations/<own id>` → 200, `GET /organizations/<other id>` →
404 (existence hidden), and the list contains exactly your own org.

**Claim-less signup bootstrap.** Filters never gate creates and the registry
carries no stamp, so `POST /organizations` works for any authenticated
principal — including one whose token has **no (or a foreign) tenant claim**.
The created org's `id` is then a valid `tenantId` claim value (that's the
identity), closing the signup loop: create org → issue token with
`tenantId = <org id>` → read it back. Pinned end-to-end by
`test/e2e/tenancy-isolation.test.ts` (`LOOM_TENANCY_E2E=1`).

**The id-vs-claim type rule.** The registry id is usually `guid`; JWT claims
are usually strings. The comparison binds the claim **as the id's value type
at each backend's accessor site**:

| Claim type vs `ids` | Result |
|---|---|
| same-typed (`guid`/`guid`, `string`/`string`, …) | compared directly on every backend |
| `string` claim, `guid` aggregate id | **parsed** to the id's value type at each backend's accessor site, yielding null when it doesn't parse (see below) |
| anything else | `loom.tenancy-claim-type-mismatch` (error, with the fix spelled out) |

A **malformed** tenant claim (an authenticated token carrying
`tenantId: "not-a-guid"`) is an ordinary empty read on every backend — the
same 200-with-an-empty-list / 404-by-id a foreign-but-well-formed claim gives,
never a 500. That is what the parse-to-null accessor buys: the `string` claim
is coerced in the host language *before* it reaches the database, so a value
the `guid` id cannot represent binds NULL and matches no row. A **missing**
principal claim takes the same path, for the same reason.

Pinned on every behavioural leg by `corpus/tenancy-owned` (the harness
principal's claim is not a uuid, so the registry reads 404 / empty, never 500),
by the remaining .NET and Java `tenancy-registry-self-scope` generator suites
for the guid-claim and Criteria arms, and end-to-end by
`assertCrossTenantIsolation` (the `tenancy-e2e` matrix, every backend).

Per-backend registry read scope (all five compile-gated, and all five
runtime-gated by the isolation e2e):

| Backend | Registry read scope | Malformed claim |
|---|---|---|
| node (Hono/Drizzle) | `eq(schema.organizations.id, requireCurrentUser().tenantId)` AND-ed into every root read, behind a UUID-shape ternary | falls to the always-false term (`and(isNull(id), isNotNull(id))`) |
| .NET (EF Core) | `HasQueryFilter("IdFilter", x => x.Id == __SelfScopeId_Organization_0)`, a hoisted `OrganizationId?` member | `Guid.TryParse(…) ? new OrganizationId(g) : null` → `= NULL` |
| elixir (Ecto) | `fragment("? = ?", record.id, ^…)` — cast in Elixir, compared on the uuid column so the PK index still serves it | `Ecto.UUID.cast/1` → `nil` → `= NULL` |
| python (SQLAlchemy) | `OrganizationRow.id == user.guid_claim("tenant_id")`, a `with_loader_criteria` the read-scope hook (`app/db/read_scope.py`) builds from the request principal on every ORM read (`false()` with no principal) | `guid_claim` → `None` → `IS NULL` |
| java (Spring/JPA) | an auto-enabled, by-key `@Filter(name = "Organization_tenancy", condition = "id = :__cuTenantIdAsUuid")` on the entity, the claim a `@ParamDef` whose resolver reads the request principal per query — so every query of the entity carries it, `@Query` finds, Criteria and Spring Data's own `findAll`/`existsById` alike | `<claim>AsUuid()` → `null` → `= NULL` |

The derived filter is provenance-tagged `tenancy` in
`contextFilterOrigins`. `tenancy` is not a capability, so a named
`ignoring tenancy` is rejected (`loom.filter-bypass-unknown-capability`);
only an explicit `ignoring *` read — the same authored escape hatch that
drops `tenantOwned`'s filter — bypasses it.

### The bundled dev Keycloak's demo tenant

Because the self-scope matches only a uuid claim, the demo user of the bundled
dev Keycloak (bundled for any `auth { oidc … }` block, whatever the provider) is seeded
with a **uuid** tenancy claim, `00000000-0000-4000-8000-00000000de40`
(`DEMO_TENANT_ID`, `src/ir/util/demo-tenant.ts`) — not `demo-<claim>`, which
matched no registry row ever (eval-closure #26). A matching first-boot registry
row ships through the ordinary seed path: enrichment appends a `raw` seed row
(`id` = that uuid, a synthetic value for every other required scalar
column) in its own dataset, `loomDemoTenant`, and the generated dev compose
sets `LOOM_SEED: "loomDemoTenant"` on the backend hosting the registry. Like
every non-`default` dataset it runs only when `LOOM_SEED` names it, so a
production boot never inserts a demo tenant. A registry whose required columns
have no obvious synthetic value (a value object, an `X id` reference, a list),
or that is inherited, event-sourced, non-relational or not on Postgres, gets no
row — the realm claim is still the uuid. The demo user's `permissions` are
deliberately not seeded, so denial stays demonstrable. The allow path is a
second seeded user, `demo-admin` / `demo-admin`, emitted whenever the system
declares a `permissions { }` block: it carries every declared permission (the
`<subdomain>.<name>` runtime strings) through whichever claim `permissions`
reads — the flat user attribute, or realm roles when it is mapped onto
`realm_access.roles`. Every other id-typed claim (`agentId: Agent id?`) is
seeded with the all-zero uuid the dev stub uses, and the realm's user profile
sets `unmanagedAttributePolicy: ENABLED`, so a claim attribute granted later
through the admin console survives into the token.

## `ignoring` and the tenant filter

`ignoring tenantOwned` (and `ignoring *` on a tenant-scoped aggregate, which
subsumes it and the registry self-scope above) is the ONE way to read across
tenants, and it is a real, supported shape: the platform-admin report that has
to total every tenant's rows. What it is not is a quiet one — it removes the
boundary the whole feature exists to provide, and the emitted query then
carries no tenant predicate at all:

```ddd
projection PlatformRevenue {          // every tenant's revenue, to any caller
  revenue: money
  from WorkOrder as w ignoring tenantOwned
  select revenue = sum(w.amount)
}
```

```ts
// the emitted read — no `where`, where the un-bypassed sibling carries
// `.where(eq(schema.workOrders.tenantId, requireCurrentUser().orgId))`
const [row] = await db.select({ revenue: sum(schema.workOrders.amount) }).from(schema.workOrders);
```

So every such read raises **`loom.tenancy-filter-bypass`** (a warning, naming
the read, the aggregate and the claim that no longer applies). Three
properties of that gate are deliberate:

- **It does not consult `auth { enforcement: }`.** The language default is
  `enforcement: opt`, which gates nothing at all; and under `denyByDefault`,
  `requires true` satisfies the ungated-read check while leaking exactly as
  hard. The question this gate asks is "does this read drop the tenant
  filter", not "does this read have some gate".
- **It is a warning, never an error.** The escape hatch keeps working — the
  model still compiles and the cross-tenant read is still emitted.
- **It fires only on a TENANCY bypass.** `ignoring softDeletable` widens a
  read to rows the caller's own tenant already owns and stays silent, as does
  `ignoring *` on an aggregate with no tenancy filter in scope.

If the cross-tenant read is deliberate, gate it behind an explicit
platform-admin `requires` and keep it off tenant-facing APIs; the warning
stays, as the standing record that this read crosses the boundary.

## The explicit-stance rule (the safety story)

Under a system with `tenancy by`, **every persisted aggregate must declare a
stance** — `with tenantOwned` or `crossTenant` (the registry and abstract
bases are exempt; a subtype inherits its base's stance). An unmarked aggregate is a hard error:

| Code | Fires when | Severity |
|---|---|---|
| `loom.tenancy-stance-unmarked` | unmarked aggregate under a `tenancy by` system | error |
| linking error (`Could not resolve reference …`) | `user.<claim>` not on the `user {}` shape, or `of` names a non-existent aggregate — both bindings are real cross-references (navigation / rename / find-refs work) | error |
| `loom.tenancy-duplicate` | more than one `tenancy by` | error |
| `loom.tenant-owned-without-tenancy` | `with tenantOwned` but no `tenancy by` | error |
| `loom.cross-tenant-without-tenancy` | `crossTenant` but no `tenancy by` | warning |
| `loom.tenancy-conflicting-stance` | both markers on one aggregate (or a marker on the registry) | error |
| `loom.tenancy-inherited-stance-conflict` | a subtype declares the OPPOSITE stance from the abstract base it `extends` | error |
| `loom.tenancy-claim-type-mismatch` | the claim's type can't bind against the registry's `ids` type (see the id-vs-claim rule above) | error |
| `loom.tenant-owned-claim-type` | a `tenantOwned` aggregate exists but the claim isn't `string` (the capability's field is `tenantId: string`; a `guid` claim mis-compiles typed backends — declare the claim `string`, guid values round-trip as text) | error |
| `loom.tenancy-filter-bypass` | a read (`find` / query-time `projection` / inline `Repo.all`) whose `ignoring` clause drops the tenant floor or the registry self-scope — see [`ignoring` and the tenant filter](#ignoring-and-the-tenant-filter). Independent of `auth { enforcement: }` | warning |
| `loom.tenancy-folded-projection-mixed` | a folded projection whose events come from a `crossTenant` aggregate AND a tenant-scoped producer — see [Folded projections](#folded-projections--rows-carry-the-events-tenant); split it in two | error |
| `loom.tenancy-projection-over-scoped-fold` | a query-time projection `from <P>` over a tenant-scoped folded projection `P`: the query path reads its rows without the fold's tenant scope | error |

### Inheritance: a subtype inherits its base's stance

An abstract base is exempt from the rule because it persists no rows; its
stance reaches every subtype (D-INHERITED-CAPABILITIES). `abstract aggregate
Vehicle with tenantOwned` makes each `… extends Vehicle` tenant-owned — the
column, the stamp that fills it and the filter that scopes reads by it — with
no marker of its own. Writing `crossTenant` on such a subtype is
`loom.tenancy-inherited-stance-conflict`: the subtype would be both tenant data
and shared data. A `crossTenant` base makes its subtypes `crossTenant` the same
way.

There is deliberately **no severity knob**: the escape hatch is writing
`crossTenant` — one keyword, intent declared. This is fail-closed without
magic: nothing is ever injected by the distant `tenancy by` line; the
capability the aggregate *wrote* carries the fields (unfoldable, reviewable).

## What each backend emits

The filter and stamp ride the standard capability-filter/stamp pipeline —
tenancy adds **no bespoke backend code**:

The principal-side spellings below assume the common `tenancy by
user.tenantId` declaration; under any other claim name the `currentUser.…`
half follows the declaration while the row column stays `tenantId`.

| Backend | Read scope | Create stamp (`tenantId`) |
|---|---|---|
| node (Hono/Drizzle) | `.where(and(…, eq(t.tenantId, requireCurrentUser().tenantId)))` on every repository read | `stampInsert<Agg>` copies the claim off the ambient principal — `{ ...row, tenantId: currentUser.tenantId }` (no-op for system/seed saves) |
| .NET (EF Core) | `HasQueryFilter(x => x.TenantId == RequestContext.Current!.CurrentUser!.TenantId)` | the `AuditableInterceptor` (a `SaveChangesInterceptor`) sets `Property(x => x.TenantId).CurrentValue = RequestContext.Current!.CurrentUser!.TenantId` on `Added` |
| elixir (Ecto) | a `Repo.prepare_query/3` clause on the schema, fail-closed `^(current_user && current_user.tenant_id)` against the read's `current_user:` or the ambient principal; raises when neither is set (`Repo.async/1` carries it into a task) | `Ecto.Changeset.put_change(:tenant_id, current_user && current_user.tenant_id)` |
| python (FastAPI/SQLAlchemy) | one `do_orm_execute` hook (`app/db/read_scope.py`) adds `with_loader_criteria(<Row>, <Row>.tenant_id == user.tenant_id)` to every ORM read; `false()` with no principal | `self._tenant_id = current_user.tenant_id` in the create factory |
| java (Spring/JPA) | an auto-enabled `@Filter(condition = "tenant_id = :__cuTenantId")` on the entity (a TPH hierarchy's on its root), the claim a per-query `@ParamDef` resolver; `ignoring tenantOwned` disables it for that read | `@PrePersist` hook reading `CurrentUserAccessor.currentOrNull()`, setting `this.tenantId = currentUser.tenantId()` |

Every stamp refuses a create whose principal carries an empty claim with a 403
(`ForbiddenError` / `ForbiddenException`), so a row never lands with no tenant.

Frontends need nothing: enforcement is server-side, and `tenantId` never
appears in create forms. `tenantId` (like `softDeletable`'s `isDeleted`) is
wire-visible on reads — internals aren't hidden from read DTOs by default.

Cross-tenant reads of another tenant's row return **404** (existence hidden),
falling out of the filter semantics: the row simply isn't found.

The isolation is assertable from the model: a context integration test switches
tenant mid-body with an `as { … }` line, and the read comes back empty.

```ddd
test "beta cannot read acme's note" as { tenantId: "acme" } {
  let n = Note.create(text: "acme only")
  as { tenantId: "beta" }
  let r = Note.find(n.id)
  expect(r).toBeNull()
}
```

Each backend runs it under the principal its auth middleware would bind
(`runAsUser` / `current_user_var` / a `RequestContext` frame /
`CurrentUserAccessor.actAs` / the threaded actor) — see the
[testing reference](language-reference/18-testing.md#running-as-a-principal).

## Reference admission

A row that stores an `X id` stores it from a request: a create or update body,
an operation parameter, a workflow or handler parameter.  When `X` is
`tenantOwned`, the id must name a row the caller can read; an id naming another
tenant's row is refused **exactly as an id naming no row at all** — same status,
same problem body — so the refusal reveals nothing about other tenants' rows.

```ddd
aggregate Invoice with tenantOwned, crudish { number: string }
aggregate Plan crossTenant with crudish { code: string }
aggregate Payment with tenantOwned, crudish {
  invoice: Invoice id      // probed: must be readable by the caller
  plan: Plan id?           // crossTenant: any existing plan (the FK decides)
  operation relink(to: Invoice id) { invoice := to }
}
```

```
POST /api/payments {"invoice": "<another tenant's invoice>", "amount": 1}
422 {"title": "Unprocessable Entity", "code": "problem.dangling-reference",
     "detail": "The request references a record that does not exist."}
```

The decision is one fact on the enriched IR (`src/ir/plan/ref-scope.ts`), read
off the referenced aggregate (D-REF-ADMISSION):

| Target | Scope | At write time |
|---|---|---|
| `tenantOwned`, table beside the row | `row-tenant` | probed under the target's read scope |
| `crossTenant`, or no `tenancy by` | `global` | the foreign key alone |
| the registry | `global` | the foreign key alone — a row may name another org (a share's grantee) |
| `tenantOwned` in another context | `unresolvable` | no check is possible: `loom.tenancy-ref-unresolvable` is an error under `enforcement: denyByDefault`, a warning under `opt` |

Every backend renders the probe at the repository **save**, inside the write
transaction and before the row is written, so it covers every path that
persists the reference — the routes, workflows, handlers and reactors alike.
It reads the target the way any read of it does, through the target's read
scope (the `tenantOwned` floor on the operating org, plus any row rules,
shares or `deny`), and a miss raises the backend's existing dangling-reference
refusal:

| Backend | Probe | Refusal |
|---|---|---|
| node (Drizzle / MikroORM) | `tx.select(…).where(and(inArray(t.id, ids), <target>Scope()))` / `em.count(<Target>Row, { id: { $in: ids } })` under the Row's schema filters | an error carrying SQLSTATE 23503, answered by the 23503 arm of every router |
| .NET (EF Core / Dapper) | `_db.<Targets>.CountAsync(x => keys.Contains(x.Id))` under the named query filters / the target's `<Target>Scope.Where` | `Npgsql.PostgresException` 23503, answered by `DomainExceptionFilter` |
| java (JPA) | JPQL `select count(e) from <Target> e where e.id in :ids` with the entity's auto-enabled `@Filter`s | `DataIntegrityViolationException` caused by 23503, answered by the integrity advice |
| python (SQLAlchemy) | `select(<Target>Row.id).where(id.in_(…))`, narrowed by the read-scope hook | `IntegrityError` with SQLSTATE 23503, answered by the integrity handler |
| elixir (Ecto) | `Repo.aggregate(where id in ^ids)` through `Repo.prepare_query/3` | the changeset's `foreign_key_constraint` error: 422 `problem.field-invalid`, its field entry `problem.dangling-reference` |

A reference persisted by an event-sourced, `shape: document` or `shape:
embedded` aggregate has no probe: the model
is refused with `loom.target-unsupported#reference-admission-unrealized`.

## Event-sourced aggregates — the tenant lives on the stream

An event-sourced aggregate (`persistedAs: eventLog`) has no state row to carry
a `tenantId` column, so `with tenantOwned` puts the tenant **on its stream**,
as metadata of every stored event. Event payloads stay pure domain data.

```ddd
event Opened { ledger: Ledger id }
aggregate Ledger persistedAs: eventLog with tenantOwned {
  opened: bool
  create open() { emit Opened { ledger: id } }
  apply(e: Opened) { opened := true }
}
```

- **Storage.** The context's event log (`<ctx>_events`) gains one nullable
  metadata column, `tenant_id`, through the ordinary migration chain. A log
  holding no tenant-scoped stream is unchanged; the rows of its other streams
  (a `crossTenant` aggregate, an `eventSourced` workflow) leave it null.
- **Stamp.** The creation command stamps the new stream from the principal —
  the capability's own `onCreate` stamp (`tenantId := currentUser.<claim>`).
  Every later append copies the loaded stream's tenant forward, never the
  caller's.
- **Scope.** Every stream load — by id, the list, and the load an operation
  (append) runs first — applies the tenant floor over the metadata column
  (`tenant_id = currentUser.<claim>`). A foreign tenant's
  `GET /api/ledgers/<id>` is a 404, its list never shows the stream, and it
  cannot append to a stream it cannot load. `ignoring tenantOwned` drops the
  scope for that read only, as on a table (and raises
  `loom.tenancy-filter-bypass`).
- **Events.** A folded event's tenant is its stream's: the stored-event row
  carries it, and so does the CloudEvents channel envelope (`tenantid`), so a
  reactor or a cross-deployable consumer runs in the stream's tenant.
- **Fold.** A load adopts the metadata onto the aggregate's `tenantOwned`
  field, so the folded instance answers exactly like a `tenantOwned` row.

The fact is `streamTenancyFor` / `eventTenantMetadataFor`
(`src/ir/enrich/stream-tenancy.ts`). On node (context `Invoicing`) it renders
as:

```ts
// db/read-scopes.ts
export function ledgerStreamScope(use: ScopeUse = {}): SQL | undefined {
  return and(
    drops(use, "tenantOwned") ? undefined : eq(schema.invoicingEvents.tenantId, requireCurrentUser().tenantId),
  );
}

// db/repositories/ledger-repository.ts — findById
.where(and(eq(schema.invoicingEvents.streamType, "Ledger"), eq(schema.invoicingEvents.streamId, id as string), ledgerStreamScope()))

// save — a new stream is stamped, an append carries the stream's tenant
const meta = aggregate._streamVersion === 0
  ? stampInsertLedger({ tenantId: aggregate.tenantId })
  : { tenantId: aggregate.tenantId };
```

`loom.stamp-on-event-sourced-invalid` still refuses a genuine lifecycle stamp
(`stamp onCreate { openedAt := now() }`) on an event-sourced aggregate; the
tenancy capability's stamp is not one.

**Backend coverage.** Every backend carries the stream tenant: node (its default
Drizzle persistence), `dotnet` (EF and Dapper), `java`, `python` (through the
repository's `_stream_scope`) and `elixir` (the scope lives on the aggregate's
event-log schema, where `Repo.prepare_query/3` applies it).  node's
`persistence: mikroorm` event store does not carry it, so there a
`tenantOwned` event-sourced aggregate is refused with `loom.target-unsupported`
(`#tenant-owned-event-sourced`) rather than emitted as an unscoped stream.

## Folded projections — rows carry the event's tenant

A folded projection (`projection P keyed by k { on(e: Ev) { … } }`) writes
rows no tenant command owns. Under `tenancy by`, a fold over events raised by a
`tenantOwned` aggregate — state or event-sourced — is **tenant-scoped**:

- **Stamp.** The fold reads the event's tenant from its metadata — the event
  origin of the frame the event is dispatched in (the raising request, the
  stream tenant's frame for an event-sourced append, the row tenant's frame
  for a state `tenantOwned` row a principal of another org wrote through a
  write share, or the frame the outbox relay / broker consumer opens from
  `tenantid`) — and stamps the row's
  `tenant_id`, the column a `tenantOwned` table carries. An event with no
  tenant (raised outside any principal) folds into no row.
- **Key.** The row is keyed by `(tenant_id, <key>)`, so two tenants folding
  the same business key get two rows. The migration chain adds the column
  and the composite primary key.
- **Scope.** Every read — `GET /api/projections/<p>`, the by-key read, and so
  any page `QueryView` over it — applies the fold row's read scope
  (`foldRowReadScope` in `read-scope.ts`): the tenant floor
  `tenant_id = currentUser.<claim>`.

```ddd
aggregate Acct with tenantOwned, crudish {
  owner: string
  operation pay(amount: int) { emit Paid { acct: id, amount: amount } }
}
projection Totals keyed by acct {
  acct: Acct id
  paid: int
  on(e: Paid) { acct := e.acct  paid := e.amount }
}
```

```ts
// node — http/projections.ts
const __origin = currentEventOrigin();
const __tenant = __origin?.tenant;
if (__tenant == null) return;
const state = (await loadTotals(db, __key, __tenant)) ?? { acct: __key, tenantId: __tenant };
// GET /projections/totals
const rows = await db.select().from(schema.totalses).where(eq(schema.totalses.tenantId, String(requireCurrentUser().tenantId)));
```

```sql
-- the fold table: one row per (tenant, key)
"tenant_id" TEXT NOT NULL,
PRIMARY KEY ("tenant_id", "acct")
```

A fold whose events all come from `crossTenant` aggregates is **exempt**: no
tenant column, unscoped reads. A fold mixing `crossTenant` and tenant-scoped
producers is refused (`loom.tenancy-folded-projection-mixed`): a
`crossTenant` event carries no tenant, so its rows could be neither shared nor
tenant-owned. Every other fold (a workflow or registry producer, or none
found) is scoped — fail-closed. A query-time projection over a scoped fold
(`from Totals`) is refused (`loom.tenancy-projection-over-scoped-fold`).

The fact is `foldTenancyVerdict` / `foldTenancyFor`
(`src/ir/enrich/fold-tenancy.ts`); every backend (node Drizzle and MikroORM,
`dotnet` EF and Dapper, `python`, `java`, `elixir`) renders it.

## Reactors and timers — the system principal's tenant

An event reactor runs as the **system principal** ([D-REACTOR-SYSTEM-PRINCIPAL](decisions.md#d-reactor-system-principal--event-reactors-run-as-a-tenant-scoped-system-principal)), and filters and
stamps inside it use the **triggering event's tenant**: the system principal
takes the operating org of the request that raised the event (its home org, or
the org an admitted `x-org-context` switch named), so a reactor reads and
writes in exactly the tenant its event came from.
A `timerSource` tick has no originating request and therefore **no
tenant** — a tenant-owned read in a timer-driven reactor would match nothing —
so it must be explicitly cross-tenant: widen the read with `ignoring
tenantOwned` (`Repo.all(C) ignoring tenantOwned`, `Repo.getBy(…) ignoring
tenantOwned`), or `loom.timer-tenant-read` (error) refuses it.

```ddd
repository Jobs for Job
criterion ByCode(c: string) of Job = this.code == c
workflow sweepRun {
  sweep: Sweep id
  create(t: SweepTick) by t.sweep {
    let js = Jobs.all(ByCode("x")) ignoring tenantOwned   // without `ignoring`: loom.timer-tenant-read
    for j in js { j.close() }
  }
}
```

An event that crosses the transactional outbox or a broker carries its
**origin** — `{tenant, causedBy}` — on the outbox row and as the envelope's
`tenantid` / `loomcausedby` attributes, and the relay / consumer delivers it as
the system principal of that tenant, so a relay- or broker-fed reactor reads
and writes in the event's tenant too
([`channels.md` § Event origin](channels.md#event-origin--the-reactors-tenant-across-the-outbox-and-the-broker)).

```ts
// node — the stream's reactors run in the stream's tenant
await runAsEventOrigin({ tenant: aggregate.tenantId, causedBy: origin?.causedBy ?? null }, dispatchAll);
```

## The registry tree — `implements tenantRegistry`

The tenant registry becomes a tree of orgs by carrying `implements
tenantRegistry` — a built-in prelude capability (`src/macros/prelude.ts`, next
to `tenantOwned`). It **provides** one field, which the author does not write
(unfold the capability to see it):

```ddd
tenancy by user.tenantId of Organization

aggregate Organization with crudish {
  name: string
  implements tenantRegistry
  // — what `implements tenantRegistry` provides —
  //   parent: Organization id?               // self-FK; null = a top-level org

  // Re-parenting is an operation the author writes; the capability generates none.
  operation move(to: Organization id) requires currentUser.role == "admin" {
    parent := to
  }
}
```

```sql
-- db/migrations/…_billing_initial.sql (generated, node)
CREATE TABLE "accounts"."organizations" (
  …
  "parent" UUID NULL,
  …
  FOREIGN KEY ("parent") REFERENCES "accounts"."organizations" ON DELETE RESTRICT
);
CREATE INDEX "organizations_parent_idx" ON "accounts"."organizations" ("parent");
```

- **`parent: Self id?`** — an ordinary, mutable, nullable self-FK (`Self`
  resolves to the registry aggregate). A child org's signup passes it at
  create; an author-written operation (`parent := to`) moves an org later. A
  move is one `parent` update — nothing positional is stamped on any other row.
  It lands in migrations as a nullable self-referential FK plus a
  `<table>_parent_idx`.
- **No generated `move`.** Guarding a move against cycles or against moving an
  org under another customer is the author's operation's job (its `requires`
  and `policy`). The generated code stays correct whatever the author's move
  allows: the ancestors walk terminates on a cycle
  ([`organizationContext.ancestors`](#organizationcontext--the-operating-scope-and-its-switch-gate)).
- **The tree is for managing sub-tenants, not for reading data.** It records
  which org sits under which, so the author's registry operations and
  workflows can create and administer child orgs. It takes no part in a data
  read: a `tenantOwned` row stays visible to its own org only, and a parent
  org does not see its child orgs' rows (nor a child its parent's). Who may
  create or administer a child org is the author's ordinary `requires` and
  `policy` on the registry — the capability gates nothing by itself.

A child-org signup is an ordinary create factory that loads the parent and
creates the child with its `parent` FK:

```ddd
workflow signUpChild {
  create(nm: string, seg: string, par: Org id) {
    let loaded = Orgs.get(par)
    let child = Org.create(name: loaded.name + "." + seg + "." + nm, parent: par)
  }
}
```

Structural verification (`src/ir/validate/checks/tenancy-checks.ts`): only under
a `tenancy by` system (`loom.tenant-registry-without-tenancy`), **exactly one**
aggregate (`loom.tenancy-registry-duplicate`), and it must be the `of <Registry>`
target (`loom.tenancy-registry-not-target`). `parent`'s self-reference is
structural (`Self`), so it needs no check. A reference to `dataKey` — on a row, the registry or `currentUser` — is
`loom.tenancy-data-key-removed`: rows carry `tenantId` only.

## The `policy {}` block — levels, row rules and `deny`

A `policy {}` context member sets, per tenant-owned aggregate, what the caller
may read and write. Visibility composes per aggregate and per access (D-SHARING):

```text
scope   = (default ∨ row rule₁ ∨ row rule₂ ∨ …) ∧ ¬deny
default = the level the caller's `when` selects, else `local`
```

- **`local`** — the caller's own org, `tenant_id = currentUser.<claim>`: the
  default for an aggregate no level rule names.
- **`own`** — the rows of the caller's org the caller created: `local` AND
  `createdBy = currentUser.id`. It needs a creator column — `with auditable`.
- **`allow <level> on X when <cond>`** replaces the default for the callers
  `<cond>` admits. `<cond>` is decided per caller before the query: it compares
  `currentUser` claims with each other, literals or enum values. Callers no
  `when` admits keep `local`.
- **`allow [read|write] on X as x where <predicate>`** — a **row rule** — adds
  the rows its predicate admits. The predicate is compiled into the query.
- **`deny`** removes access and always wins.

```ddd
context Books {
  aggregate Memo with tenantOwned, crudish { label: string }
  aggregate Note with tenantOwned, crudish { label: string  hits: int }
  // …
  policy {
    allow local on Memo       // the floor, spelled out
    deny write on Note        // readable, never mutated
  }
}
```

| Rule | Effect |
|---|---|
| no rule / `allow local on X` | the tenant floor: `X` rows of the caller's own org, read and write. |
| `allow own on X [when …]` | the callers `when` admits read only the `X` rows they created in their org. |
| `allow write own on X [when …]` | the same for mutations. |
| `allow [read] on X as x where …` | the rows the predicate admits are readable too. |
| `allow write on X as x where …` | the rows the predicate admits are writable too, when they are also readable. |
| `deny write on X` | `X` stays readable; every mutation (update, delete, operation) answers the op route's 404. |
| `deny on X` | no read and no write of `X` at all. |

A read rule never widens the write scope: every mutation loads its row through
the read scope AND the write scope, so a shared row stays read-only until a
write rule admits it.

**Row rules.** `x` binds the candidate row. Relations are predicates: a field
of the row, an `exists <Aggregate> as s where …` over another aggregate of the
context (its own read scope applies inside the subquery), or a named policy
function called on the row or on an `X id`, inlined into the predicate:

```ddd
context Catalog {
  aggregate Category with tenantOwned, crudish { name: string }
  aggregate CategoryShare with tenantOwned, crudish {
    category: Category id
    grantee: string
    write: bool
  }
  aggregate Product with tenantOwned, crudish { name: string  category: Category id }
  aggregate Note with tenantOwned, auditable, crudish { body: string }

  policy GranteeIsMe(s: CategoryShare): bool = s.grantee == currentUser.tenantId
  policy SharedWithMe(c: Category id): bool =
    exists CategoryShare as s where s.category == c && GranteeIsMe(s)

  policy {
    allow read on CategoryShare as s where GranteeIsMe(s)
    allow on Category as c where exists CategoryShare as s where s.category == c.id && s.grantee == currentUser.tenantId
    allow write on Category as c where exists CategoryShare as s where s.category == c.id && s.grantee == currentUser.tenantId && s.write
    allow on Product as p where SharedWithMe(p.category)   // products follow their category
    allow local on Note when currentUser.role == "manager"
    allow own on Note when currentUser.role == "clerk"
  }
}
```

The composite takes the tenant floor's place in the read scope, so
`ignoring tenantOwned` still drops the whole tenant scope. On node:

```ts
// db/read-scopes.ts
export function productScope(use: ScopeUse = {}): SQL | undefined {
  return and(
    drops(use, "tenantOwned") ? undefined : or(eq(schema.products.tenantId, requireCurrentUser().tenantId), sql`exists (select 1 from ${schema.categoryShares} where ${and(and(eq(schema.categoryShares.category, schema.products.category), eq(schema.categoryShares.grantee, requireCurrentUser().tenantId)), or(eq(schema.categoryShares.tenantId, requireCurrentUser().tenantId), eq(schema.categoryShares.grantee, requireCurrentUser().tenantId)))})`),
  );
}

export function noteScope(use: ScopeUse = {}): SQL | undefined {
  return and(
    drops(use, "tenantOwned") ? undefined : or(or(and((requireCurrentUser().role === "manager" ? sql`true` : sql`false`), eq(schema.notes.tenantId, requireCurrentUser().tenantId)), and((requireCurrentUser().role === "clerk" ? sql`true` : sql`false`), and(eq(schema.notes.tenantId, requireCurrentUser().tenantId), eq(schema.notes.createdBy, requireCurrentUser().id)))), and(and((requireCurrentUser().role !== "manager" ? sql`true` : sql`false`), (requireCurrentUser().role !== "clerk" ? sql`true` : sql`false`)), eq(schema.notes.tenantId, requireCurrentUser().tenantId))),
  );
}
```

The `CategoryShare` arm inside the `EXISTS` is that aggregate's own read scope —
its floor OR its `GranteeIsMe` row rule — so a grantee in another org finds the
share rows addressed to it, and nothing else.

The read scope rides the same per-backend query seam as the floor (Drizzle
`.where`, EF `HasQueryFilter`, the SQLAlchemy `with_loader_criteria` hook, the
JPA `@Filter`, Ecto `prepare_query`). On node, `deny write on Note` keeps the
floor on reads and makes the mutation load find nothing:

```ts
// db/read-scopes.ts — reads: the floor
export function noteScope(use: ScopeUse = {}): SQL | undefined {
  return and(
    drops(use, "tenantOwned") ? undefined : eq(schema.notes.tenantId, requireCurrentUser().tenantId),
  );
}

// db/repositories/note-repository.ts — the load every mutation runs first
async getById(id: Ids.NoteId): Promise<Note> {
  const inScope = await this.db.select({ id: schema.notes.id }).from(schema.notes).where(and(eq(schema.notes.id, id), and(isNull(schema.notes.id), isNotNull(schema.notes.id)))).limit(1);
  if (inScope.length === 0) throw new AggregateNotFoundError(`Note ${id} not found`);
  …
}
```

A workflow that mutates every row a criterion read returns fails whole when one
row lies outside the caller's write scope: the op route's 404, and the
transaction rolls back.

**Reach beyond the own org is an explicit act**, never a consequence of where
an org sits in the registry tree. `allow deep on X` and `allow global on X`
(read or write) are refused with `loom.policy-level-removed`, naming the
replacement — a share or a row rule (D-SHARING):

```ddd
policy {
  allow deep on Account
}
```

```text
error: `allow deep on Account`: the 'deep' level no longer exists — data visibility is flat, so a tenant-owned row is visible to its own org only ('local', the default).  To reach rows of other orgs, grant them explicitly with a share or a row rule (D-SHARING); drop this rule or write `allow local on …`.
```

**Validation (fail closed).** The target must be a tenant-owned aggregate in
the same context (`loom.policy-unknown-aggregate`,
`loom.policy-target-not-tenant-owned`) outside an inheritance hierarchy
(`loom.policy-scope-inheritance-unsupported`); one level rule per aggregate and
`when` condition (`loom.policy-duplicate-target`). A row predicate must be
queryable and read the row (`loom.policy-row-not-queryable`); a `when` reads the
caller only (`loom.policy-when-not-caller-only`); `own` needs a `createdBy`
column (`loom.policy-own-no-creator`); read scopes that reach each other
through `exists` are refused (`loom.policy-row-cycle`); and a policy function
that calls itself is `loom.policy-fn-cycle`.

## `organizationContext` — the operating scope and its switch gate

`currentUser` is the **principal**: who is calling, their permissions, and —
through the tenancy claim — their home org. `organizationContext` is the
**operating scope**: the org this request acts *in*. It has two members:

- `organizationContext.org` — the operating org's **id**: the home org, unless
  the request sends an `x-org-context` header naming an org the gate admits.
- `organizationContext.ancestors` — the operating org **and** every org above
  it on the registry tree, typed `<Registry> id[]`.

In a row rule (or a policy function inlined into one),
`organizationContext.ancestors.contains(<column>)` is a query predicate: the
column is tested against the lineage (`<column> = ANY(<lineage>)`), so a row
whose column names an org is visible to that org and every org below it —
re-evaluated per request, so a move re-targets it with nothing rewritten
([row rules](language-reference/17-auth.md#row-rules-when-and-own)).
That is how a `shareable` aggregate's `Subtree` share reaches its grantee org's
whole subtree ([sharing](auth.md#sharing--shareable)).

Reads, writes and the tenant stamp **anchor on the operating org**: the
prelude `tenantOwned` filters and stamps on `organizationContext.org`.
`currentUser` is never rewritten by a switch — `currentUser.tenantId` still
names the home org.

```ddd
system OrgContext {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org

  subdomain Core {
    context Books {
      policy InLineage(org: Org id): bool = organizationContext.ancestors.contains(org)

      aggregate Account with tenantOwned, crudish {   // filter + stamp: organizationContext.org
        label: string
        lineage: int?
        underOrg: bool?
        operation probe(org: Org id) {
          lineage := organizationContext.ancestors.count()
          underOrg := InLineage(org)
        }
      }
      aggregate Org with crudish {
        name: string
        implements tenantRegistry
        operation move(to: Org id) { parent := to }
      }
    }
  }
  // … an `auth: required` deployable hosting Books
}
```

`organizationContext.org` lowers to the principal member
`currentUser.operatingOrg` and `.ancestors` to `currentUser.operatingAncestors`,
both set once per request by the auth middleware:

```ts
// node — auth/middleware.ts (generated)
async function orgContextFor(homeOrg: string, requested: string | undefined): Promise<string | null> {
  if (requested === undefined || requested === "") return homeOrg;
  if (homeOrg === "") return null;
  if (requested === homeOrg) return requested;
  return orgRegistry !== null && (await orgRegistry.canRead(requested)) ? requested : null;
}
// …
const homeUser: User = { ...claims, operatingOrg: homeOrg, operatingAncestors: [] };
const frame = requestContext();
if (frame) frame.currentUser = homeUser;           // the admission read runs as the caller
const operatingOrg = await orgContextFor(homeOrg, requestedOrgContext);
if (operatingOrg === null) return orgContextForbidden(c, requestedOrgContext ?? "", homeOrg);
const user: User = { ...homeUser, operatingOrg, operatingAncestors: await operatingAncestorsOf(operatingOrg) };

// db/read-scopes.ts — the floor anchors on the operating org
eq(schema.accounts.tenantId, requireCurrentUser().operatingOrg)
// db/audit-stamp.ts — so does the stamp
return { ...row, tenantId: currentUser.operatingOrg };
// domain/account.ts — probe()
this._lineage = (currentUser.operatingAncestors).length;
this._underOrg = (currentUser.operatingAncestors).includes(org);
```

**The gate.** A switch re-roots every read and the write stamp onto a value the
caller *submits*, so it is fail-closed and runs **once per request, before any
handler**. A requested org is admitted when the caller can **read that registry
row through the registry's own read rules** — the same read scope a `GET` of
the row applies, evaluated for the caller's home principal. The registry's
derived self-scope admits the home org; the registry's read rules decide what
else a caller may switch into.

| `x-org-context` | Caller's tenancy claim | Result |
|---|---|---|
| absent or empty | any | the home org (the claim) |
| equal to the claim | non-empty | admitted: the home org |
| an org id whose registry row the caller can read | non-empty | admitted: that org |
| any other value (unreadable, unknown, not a uuid) | non-empty | **403**, `org_context_denied` logged with `reason: "outside_scope"` |
| any value | empty (no tenancy claim) | **403**, `reason: "no_principal_scope"` |

A refused request never reaches a handler: nothing is written, and the 403 is
an RFC 7807 problem (`"title": "Forbidden"`). The deny is logged through the
neutral catalog (`org_context_denied`, `warn`, fields `org_context` / `reason`
/ `status`) on all five backends.

**The ancestors walk.** `organizationContext.ancestors` is resolved once per
request (memoized on the principal) by one recursive query over the registry's
`parent`, shared by all five backends (`src/generator/_persistence/registry-walk.ts`).
`UNION` — set semantics — is the cycle guard: an author-written move can close
a loop, and the walk stops the first time a row repeats. It is computed only
on a deployable that hosts a context reading it.

```sql
WITH RECURSIVE up(id, parent) AS (
  SELECT id, parent FROM "books"."orgs" WHERE id = $1
  UNION SELECT o.id, o.parent FROM "books"."orgs" o JOIN up ON o.id = up.parent)
SELECT id FROM up
```

| Backend | Where the gate runs | Admission read | Where the operating org / ancestors live |
|---|---|---|---|
| node (Hono) | `authMiddleware` | `registerOrgRegistry` in `boot.ts` (drizzle `orgScope()` / MikroORM filters) | `User.operatingOrg` / `User.operatingAncestors` |
| .NET | `UserMiddleware` | `I<Registry>Repository.GetByIdAsync` (EF query filters / Dapper scope) | `User.OperatingOrg` / `User.OperatingAncestors` |
| Java (Spring) | `UserFilter` | `OrgRegistry.canRead` → `<Registry>Repository.findById` (Hibernate filters) | record components `operatingOrg()` / `operatingAncestors()`, set via `User.inOrg(…)` |
| Python (FastAPI) | `AuthMiddleware` | an ORM `select` under the home principal (the `do_orm_execute` read scope) | `user.operating_org` / `user.operating_ancestors` (off `asdict()` / `/auth/me`) |
| Elixir (Phoenix) | the `Auth` plug, `org_context_gate/2` | `<Registry>Repository.find_by_id/2` with the home principal | `current_user.operating_org` / `.operating_ancestors` (seeded on every principal the plug builds) |

**A deployable that does not host the registry** has no registry table: its
gate admits the home org only — any other `x-org-context` is a runtime 403 —
and a context it hosts that reads `organizationContext.ancestors` is refused at
compile time
(`loom.tenancy-registry-remote-unsupported`, naming the fix — host the
registry's context there too). No registry copy is generated for it.

**Reactors.** An event reactor runs as the system principal, whose operating
org is the triggering event's tenant — the operating org of the request that
raised the event. It carries no ancestor set, so a reactor that reads
`organizationContext.ancestors` (directly, or through an operation it calls) is
`loom.org-context-ancestors-in-reactor`.

**Validation (fail closed).** `loom.org-context-surface` — a bare
`organizationContext`, any member but `org` / `ancestors`, or any read inside a
`ui` (a frontend has no switch gate). `organizationContext.orgPath` is
`loom.tenancy-principal-member-removed`, naming `organizationContext.org`.
`loom.org-context-gate-unmet` — a read in a context hosted by a backend
deployable without `auth: required`. A `tenantOwned` write whose request has no
operating org (a token without the tenancy claim) is a 403 naming the operating
organization, not a 500. The runtime proof is the `org-context` leg of
`tenancy-e2e` on all five backends (`npm run test:tenancy-org-context*`): an
admitted and a refused switch, the stamp and reads on the operating org, the
ancestors before and after an authored move, and a deliberate cycle that still
answers.
