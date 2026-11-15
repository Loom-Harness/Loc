# D-ONE-SCHEMA — every backend maps the one schema the shared migrations derive

**Status:** PINNED.

**Problem.** Deployables bound to one postgres `storage` share its database,
and only the first of them applies migrations; every other deployable reads and
writes tables a different backend created. That is sound only if every backend
maps the same physical layout. The SQL backends render the schema through one
renderer, but the Ecto emitter projected it onto a layout of its own (bundled
`timestamps()` columns, a synthetic id on value-collection rows, its own index
names, a value object folded into one json column), so a Phoenix deployable
beside any other backend failed every read and write on the other side's
tables.

**Decision.** In the relational shape there is ONE schema per database, derived
once as `MigrationsIR` in phase ⑨. Every backend and persistence adapter maps it
exactly: the same tables, columns, column types, keys, constraints and index
names, and no extra columns. A value object is its prefix-named leaf columns; a
value-object collection is a child table keyed by `(parent_fk, ordinal)`; an
index carries the shared name. An emitter whose ORM wants a different layout
adapts its mapping, never the schema.

json columns appear only where the model asks for them: a `shape: document`
aggregate's tree, an embedded aggregate's parts, the `json` field type, the audit
before/after snapshots and file references. Those columns are part of the one
schema too, so every backend creates them identically; the shared-database leg
measures `shape: embedded` and `shape: document` cases like any other.

An adapter that does not map the shared schema is honest about it: a
`loom.<adapter>-shared-database` diagnostic refuses it beside a deployable of
another layout. Each such adapter is a tracked gap, not a supported variant:
MikroORM and Dapper (value objects as json, MikroORM's boot-time sync), and Ecto
for a value object on a saga-state or projection row (as one `:map` column).

An ORM whose schema type cannot span several columns maps a value object as its
leaf columns plus an in-memory value composed from them: Ecto declares the leaf
fields and a virtual value-object field, and the generated `<App>.Repo.Records`
composes it on every read and decomposes it on every write.  `<App>.Repo` stays
the plain Ecto repo; the seam is a module of its own, so nothing about the repo
behaves differently from what a Phoenix developer expects.  Hand-written Elixir
beside the generated code (an `extern` body, an ejected file) reads and writes
an aggregate through `<App>.Repo.Records` for the same reason the emitters do:
a raw `Repo.all` returns the struct with its value objects unset, and a raw
`Repo.insert` of a changed value object writes none of its columns.

Reading an optional value object back from its leaf columns, Ecto takes it as
absent when every required leaf is NULL (when it has no required leaf, when
every leaf is NULL).  The shared null-consistency CHECK makes the backends agree
on every row except one it still admits — required leaves NULL while an optional
leaf is set — where the backends answer differently; that disagreement is
tracked on GitHub, not decided here.

**Mechanism.**

- `OWN_LAYOUT_PERSISTENCE` (`src/platform/adapter-metadata.ts`) lists the
  adapters that still lay tables out their own way; each has its
  `loom.<adapter>-shared-database` refusal.
- `test/system/shared-database-layout-census.test.ts` reads every
  database-bearing backend and persistence adapter off the registry. An adapter
  not in the list must emit the shared DDL statement for statement; one in it
  must have its refusal.
- `test/system/elixir-records-seam-census.test.ts` forbids a raw `Repo` read or
  write in the elixir emitters outside `<App>.Repo.Records`, the one place a stored
  value object is composed from and decomposed into its leaf columns.
- The booted shared-database leg (`LOOM_BH_ELIXIR_SCHEMA=shared`,
  `test/behavioral/shared-schema.mjs`) runs every elixir behavioural case as a
  non-owner on the schema a node deployable's migrations create, and requires
  the elixir migrations to create the identical catalog — every table, the
  machinery tables (outbox, audit and provenance history, timer claim, consumer
  inbox) included; only each migrator's own bookkeeping table is left out.

**Affects.** `docs/migrations.md`,
`docs/language-reference/02-systems-and-topology.md`, the Ecto migration and
schema emitters, `src/ir/validate/checks/orm-adapter-checks.ts`.

**Enforced by:** `test/behavioral/shared-schema.mjs`, `test/system/shared-database-layout-census.test.ts`, `test/system/elixir-records-seam-census.test.ts`
