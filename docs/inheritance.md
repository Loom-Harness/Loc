# Aggregate inheritance

Loom lets one aggregate **extend** another so subtypes share a common field set
and can be queried polymorphically. An `abstract aggregate` declares the shared
base; concrete aggregates `extends` it; the `inheritanceUsing: …` header modifier
picks how the hierarchy maps to tables.

> Design rationale, the full strategy comparison, and the deferred patterns live
> in [`proposals/aggregate-inheritance.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/aggregate-inheritance.md).
> This page is the reference for what ships today.

## Declaration surface

```ddd
context Parties {
  // The abstract base: shared fields, no table/repo/routes of its own.
  abstract aggregate Party inheritanceUsing: ownTable {
    name: string
    email: string
  }

  // Concrete subtypes inherit Party's fields and add their own.
  aggregate Customer extends Party inheritanceUsing: ownTable {
    creditLimit: decimal
  }
  aggregate Supplier extends Party inheritanceUsing: ownTable {
    rating: int
  }
}
```

- **`abstract aggregate <Name>`** — a base that is never instantiated directly.
  It owns no table, repository, controller, or routes. It may declare fields
  (and derived getters); it may **not** declare lifecycle behaviour
  (`create` / `operation`) or a `repository` (`loom.abstract-aggregate-behavior`,
  `loom.abstract-repository`).
- **`aggregate <X> extends <Base>`** — a concrete subtype. `<Base>` must be an
  `abstract aggregate` in the same context (`loom.extends-non-abstract`,
  `loom.extends-self`).
- **`inheritanceUsing: sharedTable|ownTable`** — the table-mapping strategy,
  declared on the base (and optionally each concrete). Allowed only on an
  abstract base or a concrete subtype (`loom.inheritance-modifier-misplaced`).
  When omitted it defaults to **`sharedTable`** (TPH).

### Field inheritance

A concrete's inherited fields are merged into its `wireShape` by the enrichment
pass: `id`, then the base fields (in declaration order), then the concrete's own
fields. An own field shadows a like-named base field (no override semantics — the
own declaration simply wins). Because the merge is backend-neutral, every backend
DTO for `Customer` carries the same `name` / `email` / `creditLimit` shape.

## Storage strategies

| | `ownTable` — TPC (Table-per-Concrete) | `sharedTable` — TPH (Table-per-Hierarchy) |
|---|---|---|
| Tables | one per concrete (`customers`, `suppliers`); no base table | one shared table named for the base (`parties`) |
| Columns | base + own columns duplicated on each concrete table | base columns + every concrete's columns, per-concrete columns forced nullable |
| Discriminator | none (the table identifies the type) | a non-null `kind` column; each repo filters/stamps it |
| Backends | **all five** (node/Hono, .NET, Phoenix, Python, Java) | **all five** (node/Hono, .NET, Phoenix, Python, Java) |
| `<Base> id` references | rejected (`loom.polymorphic-id-ref-unsupported` — ambiguous FK across N tables) | allowed (unambiguous single-table FK) |

The default is `sharedTable`, so a hierarchy with no `inheritanceUsing: …` is TPH.

### Polymorphic reads (`find all <Base>`)

Both strategies provide a polymorphic read home that returns the union of all
concrete subtypes. The abstract base owns no repository, so the reader is emitted
per backend as infrastructure.

The contract is **one native read**: every row comes back as
its real subtype, a row filtered by the base's restriction or by its own
subtype's is absent, and the order (`id`) and the page window are global across
subtypes — never per-subtype reads concatenated. The IR fact every backend
renders is `polymorphicReadFor` (`src/ir/enrich/read-scope.ts`): under TPH the
root's restrictions plus each concrete's own, root-hosted and guarded by its
discriminator (`kind <> 'Car' OR <pred>`); under TPC each concrete's full scope,
unioned or merged in the global order.

On the wire the read is `GET /api/<bases>?page=&pageSize=` answering the paged
envelope (`items`, `page`, `pageSize`, `total`, `totalPages`), each item the
tagged-union shape of [`payloads.md`](payloads.md): `{ "type": "Car", …Car's own
wire fields }`. Under TPH `GET /api/<bases>/{id}` answers one tagged row, or 404
when a restriction hides it. The route is served only where every concrete's own
list read is open — a concrete whose `all` carries a `requires` gate (including
the `denyByDefault` one) or whose wire masks a field keeps the reader unrouted.

| Backend (`platform:`) | polymorphic base reader |
|---|---|
| `node` (Hono / Drizzle) | a read-only `<Base>Repository`. TPH: one select over the shared table carrying the root's and every subtype's kind-guarded restrictions, ordered by `id`, paged in SQL, each row hydrated as its `kind`. TPC: each concrete repo's own read, merged in `id` order, then paged. Routed as `GET /api/<bases>` (+ `/{id}` under TPH) with a `<Base>Response` discriminated union. A query-time projection `from <TPH base>` applies the same guarded subtype restrictions |
| `node` (Hono / MikroORM) | a read-only `<Base>Repository` whose `findAll()` concatenates each concrete repo's `all()`; not routed |
| `dotnet` (.NET / EF Core) | `public abstract class <Base>` carrying the shared fields; concretes declare `: <Base>` and inherit them; EF excludes the base via `modelBuilder.Ignore<<Base>>()` so each concrete maps standalone; a read-only `I<Base>Repository` / `<Base>Repository` whose `FindAllAsync()` returns `IReadOnlyList<<Base>>` |
| `phoenix` (Ecto) | a read-only `<Base>Repository` whose `list` concatenates each concrete repository's `list` (draining a paged concrete's pages) and whose `find_by_id` tries each concrete in turn; the context's `list_<bases>` / `get_<base>` delegate to it and take `current_user \\ nil` whenever a concrete read does. TPH included: the `kind` conjunct and every capability / inline filter live in the concrete repositories. A `shape: document` concrete is flattened (`row.data`) before the base serializer runs |
| `python` (FastAPI / SQLAlchemy) | native SQLAlchemy single-table inheritance: the root row class is mapped `polymorphic_on` its `kind` (`polymorphic_abstract`), each concrete is a mapped subclass with its `polymorphic_identity`, and every restriction rides the read-scope hook (`app/db/read_scope.py`, a `do_orm_execute` listener adding `with_loader_criteria`), each subtype's own root-hosted and kind-guarded. TPH: a read-only `<Base>Repository` whose reads are one `select(<Base>Row)` ordered by `id` and paged in SQL, each row hydrated as its subclass. TPC: each concrete repo's own read, merged in `id` order, then paged. Routed as `GET /api/<bases>` (+ `/{id}` under TPH) with a `<Base>Response` discriminated union. A query-time projection `from <TPH base>` gets the guarded subtype restrictions from the same hook |
| `java` (Spring Boot / JPA) | a read-only `<Base>Repository` whose `findAll()` concatenates each concrete repo's reads; a `<Base>` union response type |

Under TPC, identity stays **per-concrete** (each concrete keeps its own
strongly-typed `<Concrete>Id`); there is no shared `<Base>Id`, and a polymorphic
`<Base> id` reference is rejected — so the readers expose `findAll` only, with no
polymorphic `findById` target. Under TPH the shared table does carry a
single identity, so `<Base> id` refs and a `findById` on the base reader are
available there.

## Backend gating

TPC emission is wired on every backend. TPH emission ships on all five backends
(node/Hono, .NET, Phoenix, Python, Java) — the gate fires only when **no DB
backend** hosts the context, which is an **IR-validate error** (not a warning):
there is no implemented emission target. The error names the offending
platform(s) and suggests either hosting the context on a DB backend deployable
or switching to `inheritanceUsing: ownTable` (which works everywhere).

> Platform-literal note (D-PHOENIX-SURFACE / D-NODE-PLATFORM): the canonical
> backend literals are `node` (the JS runtime, ex-`hono`), `dotnet`, and
> `phoenix` (ex-`phoenixLiveView`). The legacy spellings still parse as aliases.

## Unique keys on a TPC base — `loom.unique-tpc-not-hierarchy-wide`

A `unique (…)` key on an abstract base follows the base's table layout:

- **`sharedTable` (TPH):** the hierarchy has one table, so it gets one index
  (`parties_email_uq`), and the key is unique across every subtype. The enrich
  pass still copies the key onto each concrete, because the concrete's write
  surface has to know a duplicate can happen. The Hono per-router `23505` →
  409 arm and the Ecto `unique_constraint` gate on it. The Ecto constraint
  names the shared table's index. Without the copy, a duplicate posted
  through `/customers` answered 500.
- **`ownTable` (TPC):** the base owns no table. The enrich pass copies the key
  onto each concrete, beside the merged fields. Each concrete table then gets
  its own index, named for that table. Every per-table consumer of the key sees
  it: the migration on all five backends, the .NET Dapper `DbSchema` bootstrap,
  the Hono per-router `23505` → 409 arm, and the Ecto `unique_constraint`.

Both layouts are checked at runtime, on every SQL backend, by the
migration-evolution tier (`runUniqueIndexEvolutionGate`).

```ddd
abstract aggregate Party inheritanceUsing: ownTable {
  name: string
  email: string
  unique (email)
}
aggregate Customer extends Party inheritanceUsing: ownTable with crudish { creditLimit: decimal }
aggregate Supplier extends Party inheritanceUsing: ownTable with crudish { rating: int }
```
```sql
CREATE UNIQUE INDEX "customers_email_uq" ON "parties"."customers" ("email");
CREATE UNIQUE INDEX "suppliers_email_uq" ON "parties"."suppliers" ("email");
```

Each subtype rejects its own duplicates: a second `Customer` with the same
`email` answers 409. A `Customer` and a `Supplier` can still share an `email`,
because no index spans the two tables. When a TPC base with two or more
concretes declares a key, it raises a warning:

```text
loom.unique-tpc-not-hierarchy-wide warning: `unique (email)` on abstract aggregate 'Party' (inheritanceUsing: ownTable) is enforced per concrete table (customers, suppliers) — each subtype rejects its own duplicates, but the same value can still exist once in EACH sibling table.  If the key must be unique across the whole hierarchy, map it to one shared table: `inheritanceUsing: sharedTable`.
```

If the key must be unique across the whole hierarchy, use `inheritanceUsing:
sharedTable`. A concrete's own `unique (…)` keys stay as they are, and a
concrete that redeclares the same column list does not get a second copy. Before
this, a TPC base's keys reached no table, so no backend enforced them.

### A key declared on a TPH concrete

A `unique (…)` that a `sharedTable` **concrete** declares itself is an index on
the shared table, partial on the concrete's `kind` discriminator, and named
with it (`<table>_<kind>_<cols>_uq`):

```ddd
abstract aggregate Machine inheritanceUsing: sharedTable { serial: string  unique (serial) }
aggregate Lathe extends Machine with crudish { model: string  unique (model) }
aggregate Press extends Machine with crudish { model: string }
```
```sql
CREATE UNIQUE INDEX "machines_serial_uq" ON "floor"."machines" ("serial");
CREATE UNIQUE INDEX "machines_lathe_model_uq" ON "floor"."machines" ("model") WHERE kind = 'Lathe';
```

A second Lathe with the same `model` answers 409 on every backend (the Ecto
changeset names the scoped index). A `Press` may reuse a Lathe's `model`.

The index is partial because the table, and any column two concretes both
declare, is shared. `Lathe.model` and `Press.model` are the same `model`
column, so a full index would also refuse a Press whose model matches a
Lathe's, and nobody declared that constraint. `WHERE kind = 'Lathe'` limits the
index to the rows the declaration covers. A key declared on the **base** stays a
full index, because the base declared it for the whole hierarchy. (On a
`softDeletable` hierarchy the predicate gains `AND is_deleted = false`.)

Before this, only the base's keys were read, so a concrete's own key reached no
index and a duplicate answered 201. The migration-evolution tier checks both
the 409 and the cross-concrete 201 on all five SQL backends.

## Validation rules

| Code | Fires when |
|---|---|
| `loom.extends-non-abstract` | `extends` names an aggregate that is not `abstract` |
| `loom.extends-self` | an aggregate `extends` itself |
| `loom.inheritance-modifier-misplaced` | `inheritanceUsing: …` on an aggregate that is neither an abstract base nor a subtype |
| `loom.abstract-aggregate-behavior` | an abstract base declares `create` / `operation` lifecycle behaviour |
| `loom.abstract-aggregate-contains` | an abstract base declares `contains` — the base owns no repository and concretes do not inherit its parts, so the part's table would have no reader and no writer. Declare the containment on each concrete instead |
| `loom.abstract-repository` | a `repository` targets an abstract base |
| `loom.polymorphic-id-ref-unsupported` | a `<Base> id` reference to an `ownTable` (TPC) base |
| `loom.unique-tpc-not-hierarchy-wide` | **warning** — an `ownTable` (TPC) base with two or more concretes declares `unique (…)`. Each concrete table enforces the key on its own, but nothing spans the sibling tables (see [below](#unique-keys-on-a-tpc-base--loomunique-tpc-not-hierarchy-wide)) |
| `loom.es-tph-forced-own-table` | event-sourced / document / embedded opt-out forces `ownTable` on a TPH member (D-EMBEDDED-TPH) |
| `loom.tph-filter-unsupported` | **.NET only** — a TPH *subtype* carries a capability `filter` whose predicate reads a column the hierarchy ROOT does not declare (see below) |
| `loom.tenancy-inherited-stance-conflict` | a subtype declares the opposite tenancy stance from the base it inherits it from (`abstract … with tenantOwned` + `… extends … crossTenant`) |
| (storage gate) | a `sharedTable` (TPH) hierarchy whose context has no node/Hono, .NET, Phoenix, Python, or Java host |

## Capabilities and inheritance — a base's capabilities apply to every subtype

A `Car` is a `Vehicle`. When the abstract base applies a capability, every
concrete subtype gets all of it, not just its columns: the enrich pass merges
the base's fields, capability `filter`s and bare `filter` declarations, stamps,
capability tags and tenancy stance onto each concrete (D-INHERITED-CAPABILITIES). Under `ownTable`, its `unique (…)` keys are merged too
([above](#unique-keys-on-a-tpc-base--loomunique-tpc-not-hierarchy-wide)).

```ddd
abstract aggregate Vehicle with softDeletable { name: string  plate: string }
aggregate Car   extends Vehicle { seats: int }
aggregate Truck extends Vehicle { payload: int }
repository Trucks for Truck {
  find byPlateAll(plate: string): Truck[] where this.plate == plate ignoring softDeletable
}
```

```ts
// node — truck-repository.ts: every Truck read hides soft-deleted rows…
.where(and(eq(schema.vehicles.kind, "Truck"), not(eq(schema.vehicles.isDeleted, true))))
// …and `ignoring softDeletable` lifts exactly that filter
.where(and(eq(schema.vehicles.plate, plate), eq(schema.vehicles.kind, "Truck")))
```

- **`ignoring <baseCap>` works on a subtype.** The capability is the subtype's
  own as far as the bypass validator is concerned.
- **The tenancy stance is inherited too.** `abstract aggregate Vehicle with
  tenantOwned` makes every subtype tenant-owned (filter, stamp and stance); an
  unmarked subtype is fine. A subtype declaring the opposite stance (`crossTenant`
  under a `tenantOwned` base) is `loom.tenancy-inherited-stance-conflict`.
- **Repeating the base's capability on a subtype is harmless.** The inherited
  filter is applied once, not twice.
- **A subtype's `filter` reads through the hierarchy.** `criterion Live of Car =
  !this.retired` works when `retired` lives on the abstract base — the predicate
  is typed and lowered against the merged field set on every backend.

### The one .NET restriction

EF Core registers a query filter on the **root** entity type of a hierarchy
only. Loom therefore hosts every TPH filter on the root config. A filter the
root declares (and every subtype inherits) is registered once, unguarded, and
an `ignoring` on any subtype names that root filter. A subtype's own filter is
guarded with the discriminator so it constrains that subtype's rows alone, and
prefixed (`Car_LiveFilter`) so two subtypes carrying the same capability cannot
overwrite each other's key:

```csharp
// VehicleConfiguration.cs — `abstract … with softDeletable` + `criterion Live of Car = !this.retired`
builder.HasQueryFilter("IsDeletedFilter", x => !x.IsDeleted);
builder.HasQueryFilter("Car_LiveFilter", x => EF.Property<string>(x, "kind") != "Car" || (!x.Retired));
// TruckRepository.cs — `ignoring softDeletable`
_db.Trucks.IgnoreQueryFilters(["IsDeletedFilter"])
```

A predicate reading a **subtype-only** column cannot be hosted that way at all
(the root-typed lambda has no such member, and both workarounds — a CLR downcast
and `EF.Property` — fail as soon as the query source is a sibling subtype), so
it is rejected with `loom.tph-filter-unsupported`. Move the field to the
abstract base, switch to `inheritanceUsing: ownTable`, or host the context off
.NET. The other four backends have no such restriction.

## Deferred (gated, not emitted)

- **Mixed strategy (proposal Pattern 3)** — a per-concrete `inheritanceUsing: ownTable`
  override of a TPH base, and the `UNION ALL` `find all <Base>` it would require,
  are rejected (`loom.tph-own-override-unsupported`,
  `loom.polymorphic-id-ref-mixed-strategy`).
- **`contains` on a TPH concrete (proposal Pattern 4)** — now **supported**: the
  part emits its own table FK'd to the shared base table (TPT-via-`contains`,
  since a TPH concrete's id is the shared-table row id); `loom.tph-contains-unsupported`
  is no longer emitted. TPC concretes are unaffected — each is a standalone table
  and its parts join normally.
- **TPH on React** — N/A; the frontend consumes the concrete wire shapes, it
  does not own storage. TPH ships on node/Hono (`kind` column), .NET (EF Core
  `HasDiscriminator`), Phoenix (Ecto shared-table schemas self-filtering on
  the `kind` column), Python, and Java; see backend gating above.
