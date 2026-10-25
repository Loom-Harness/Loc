# Migrations

`MigrationsIR` is the schema delta a generated stack applies to bring its
Postgres database in line with the `.ddd` source. It is the **only secondary IR
in the compiler** — every backend consumes `LoomModel` directly for everything
else, but schema migration is the one place where (a) the table layout is a pure
function of the enriched IR that every DB backend needs identically, and (b) the
output is *stateful* (it diffs against the schema the committed migration
chain already builds). Deriving it
once in phase ⑨ and handing the same `MigrationsIR[]` to Drizzle, EF Core, Ecto,
Flyway, and the Python runner means a schema change is bit-for-bit equivalent
across all five backends — cross-backend consistency falls out of having one
canonical source rather than five hand-kept emitters.

> Builder: [`src/system/migrations-builder.ts`](../src/system/migrations-builder.ts).
> Type: [`src/ir/types/migrations-ir.ts`](../src/ir/types/migrations-ir.ts).
> SQL renderer: [`src/generator/sql-pg.ts`](../src/generator/sql-pg.ts).

## The shape

One `MigrationsIR` is produced **per generation of an owning module** — one per
entry of the [migration chain](#the-migration-chain--migrations-beside-the-source):

```ts
interface MigrationsIR {
  module: string;        // owning module
  storageName: string;   // physical storage binding (pg, analyticsDb), or ""
  baseline: SchemaSnapshot | null;   // the module's schema before; null for its Initial
  next: SchemaSnapshot;              // the module's schema after
  steps: MigrationStep[];            // ordered ops baseline → next
  version: string;       // chain version — unique across modules, strictly increasing
  name: string;          // "Initial", or the `migrate add` name ("AddOrderStatus")
}
```

A `SchemaSnapshot` is an alphabetically-sorted list of `TableShape`s
(`{ name, schema?, columns, primaryKey, foreignKeys, indexes, checks? }`).
`MigrationStep` is a closed union of `createTable` / `dropTable` / `renameTable` /
`addColumn` / `dropColumn` / `renameColumn` / `alterColumnNullable` /
`alterColumnType` / `alterColumnDefault` / `addIndex` / `dropIndex` /
`renameIndex` / `addCheck` / `dropCheck` / `sqlComment` /
`backfillColumn` / `sqlExec`. Backends only translate steps to native syntax —
they never re-derive the schema from the IR.

**Every delta step carries a `schema?`** — the owning bounded context's Postgres
schema, exactly as `createTable` carries it on the nested `TableShape`. Without it
an `ALTER`/`DROP`/`CREATE INDEX` on a schema-qualified system targets the wrong
relation or fails (`ALTER TABLE "sales"."orders" …`, not a bare `orders`). The
SQL renderer and the Ecto emitter both qualify the relation from the step's
schema.

## Phase ⑨ derivation

`buildMigrations(sys, snapshots)` (called by `ddd migrate add` and by the
system orchestrator, not by `ir/`) walks every module:

1. Skip modules with no `migrationsOwner` (frontend-only subdomains emit nothing).
2. Build `next = schemaFromModule(module, shapeOf, schemaOf)` — the table list
   the current source describes.
3. Read `baseline` from the `SnapshotStore` — the module's schema at the head of
   the migration chain (`headSnapshots`), or nothing when the module has no entry.
4. `steps = diffSchema(baseline, next)` — a pure diff. Same snapshot in ⇒ empty
   steps.

The result is a `MigrationDelta` — a `MigrationsIR` without a version. Only the
chain numbers a generation, when `ddd migrate add` records it (see
[The migration chain](#the-migration-chain--migrations-beside-the-source)).

`diffSchema` emits an **FK-safe global order**: drop indexes/columns (which
unblocks table drops) → drop tables in **reverse-topological (child-first)** order
so a parent is never dropped while a child still references it → create tables in
**topological (parent-first)** order (Kahn's sort with an alphabetical tiebreak) so
an inline `REFERENCES` never points at a not-yet-created table → add columns (their
FK targets now exist) → alter columns → add indexes. `CHECK` constraints bracket
the column work — dropped first (a Postgres constraint keeps its columns alive,
so it must go before they can be dropped or renamed) and added last (every column
it names then exists under its final name). Tables are matched by
schema-qualified name (`sales.orders` ≠ `billing.orders`); an old snapshot whose
tables predate schema-qualification (no `schema` field) is reconciled by bare name
against a single same-named next table, so a format bump reads as "same table, now
qualified" rather than drop+recreate.

Between the diff and the emitted steps, `applyDestructivePolicy` classifies the
delta and enforces the **destructive-change gate** (see below).

## Destructive changes — the `--allow-destructive` gate

A delta can silently destroy data. `applyDestructivePolicy` classifies each step
and, unless `ddd migrate add` is run with `--allow-destructive`, **aborts** with a
`loom.migration-destructive` error naming the offending steps. A module's
`Initial` is always exempt — nothing pre-exists to destroy. The decision is made
once, when the generation is recorded, and the chain entry records it
(`"allowDestructive": true`); `generate system` replays the chain and takes no
such flag.

- **Explicit rename intent (M-T2.1).** A top-level `migration "<name>" { Agg.old
  -> new }` block declares a rename directly, so the diff emits a
  `renameColumn` (plus an `alterColumnType`/`alterColumnNullable` when the column
  also changed) instead of drop+add — including the cases the heuristic below
  **cannot** collapse: **two renames on one table at once** and a
  **rename that also changes type**. The block is isolated from the domain model
  and ledger-style: it stays in source permanently and becomes a no-op once the
  rename is baked into the baseline snapshot (the next diff finds no old column to
  rename), so no separate applied-history file is needed. Structural checks reject
  a self-rename and duplicate rename source/target (`loom.rename-*`,
  `loom.migration-duplicate-name`). See
  [#3340](https://github.com/Loom-Harness/Loc/issues/3340).

  ```ddd
  migration "rename-order-qty" {
    Order.qty       -> quantity
    Order.shippedAt -> fulfilledAt
  }
  ```
  ```sql
  ALTER TABLE "orders" RENAME COLUMN "qty" TO "quantity";
  ALTER TABLE "orders" RENAME COLUMN "shipped_at" TO "fulfilled_at";
  ```
- **Table / aggregate rename (M-T2.1).** A bare `OldName -> NewAggregate` step in
  the same block renames a whole aggregate's table. Only the NEW aggregate is a
  cross-reference (the old name is gone); the diff emits a `renameTable` for the
  root table plus the full **owned-child cascade** — value-collection child
  tables and association join tables (each a `renameTable`), and the owner FK
  column on every child + contained-part table (each a `renameColumn`). The whole
  set is non-destructive; Postgres/Ecto keep FK constraints valid across a table
  rename, so no FK is re-emitted. Guarded on baseline existence, so it is a no-op
  once baked in. Derived FK-index names embed the renamed table/column, so the
  diff renames them **in place** via a `renameIndex` step (`ALTER INDEX … RENAME
  TO`; Ecto `execute/1`) — the same index (columns/uniqueness/predicate/opclasses
  match after mapping through the generation's column renames), just a new name,
  zero drop/create (M-T2.1 a). Renaming an aggregate that is the **target** of a
  *sibling* aggregate's reference collection (`Other.xs: Old id[]`) also renames
  that sibling join table's `targetFk` column (`old_id → new_id`), even when the
  sibling lives in another module (M-T2.1 b). A `persistedAs: eventLog` aggregate
  has no own table — its rename emits a ledgered `sqlExec` fix-up rewriting the
  stranded `stream_type` rows in `<ctx>_events` (M-T2.1 c), mirroring the TPH
  `kind` fix-up. The whole rename stays non-destructive across the system.

  ```ddd
  migration "rename-order" {
    Order -> PurchaseOrder
  }
  ```
  ```sql
  ALTER TABLE "orders" RENAME TO "purchase_orders";
  ALTER TABLE "order_charges" RENAME TO "purchase_order_charges";
  ALTER TABLE "order_tags" RENAME TO "purchase_order_tags";
  ALTER TABLE "lines" RENAME COLUMN "order_id" TO "purchase_order_id";
  ALTER TABLE "purchase_order_charges" RENAME COLUMN "order_id" TO "purchase_order_id";
  ALTER TABLE "purchase_order_tags" RENAME COLUMN "order_id" TO "purchase_order_id";
  ```
  ```elixir
  rename table(:orders), to: table(:purchase_orders)
  ```
  Renaming an aggregate that is the *target* of a sibling aggregate's reference
  collection (`Other.xs: Order id[]`) is not yet cascaded — that sibling join
  table's `targetFk` change falls under the destructive gate (never silent).
- **Rename detection (heuristic fallback).** With no explicit block, a table with
  *exactly one* `dropColumn` and *one* `addColumn` of **identical type *and*
  nullability** is an unambiguous rename → the pair collapses into a single non-destructive
  `renameColumn` (`ALTER TABLE … RENAME COLUMN a TO b`). Any other drop/add mix on
  one table — the two shapes the heuristic **cannot** collapse (a rename that also
  changes type, or two renames at once) — is *rename-shaped* but ambiguous. Rather
  than silently degrade to a data-losing drop+add, it **aborts** with the dedicated
  **`loom.migration-ambiguous-rename`** error, which names the drop/add columns and
  points at the explicit `migration "…" { Agg.old -> new }` block (the non-lossy
  remedy) — and says where it goes: at the **top level** of the `.ddd` file, a
  sibling of `system { … }`, never inside it (inside it is a parse error).
  As with every destructive step, `--allow-destructive` is the deliberate opt-in
  that accepts the drop+add (and its data loss).

  **The heuristic yields to the author.** It is a *guess*, and structurally it
  cannot be anything else: a rename (`binLocation` → `binCode`) and an unrelated
  drop+add (drop `binCode`, add `supplierRef`) produce a byte-identical diff —
  one `dropColumn`, one `addColumn`, same type, one table. Guessing wrong is not
  a failed migration but **silent misattribution**: every row's bin code becomes
  its supplier reference. So the collapse fires only where the author has given
  **no contrary signal**, and any contrary signal wins. Three signals count —
  the first says the two columns aren't even the same *shape*; the other two are
  the author positively asserting the added column is NEW (a renamed column
  arrives carrying its own data, so neither statement would mean anything about
  it):

  1. a **nullability change** between the two columns — a rename leaves a
     column's shape alone, so `binCode: string` becoming `note: string?` is a
     shape change on top of a name change, the same family as a rename that
     changes type. (It matters more than it looks: that shape needs neither a
     backfill nor a default to clear every other gate, so it was the last one
     that could collapse silently.)
  2. a **declared backfill** on the added column — `migration "…" { Agg.newField
     = <expr> }`. *A backfilled add is an explicit new column, never treated as
     a rename.*
  3. a **scalar-literal field default** on the added column — `supplierRef:
     string = "NO-SUPPLIER"` (§ Field defaults).

  No signal costs data when the author really did mean a rename: the uncollapsed
  `dropColumn` is destructive, so the run **aborts** and names the
  explicit-rename remedy rather than writing anything.

  **And when the collapse does fire, it says so** — `loom.migration-rename-inferred`,
  a warning naming the table and both columns (§ The inferred rename announces
  itself). The signals narrow the guess; the warning is what makes the guess
  it still has to make audible.

  **Expressing a genuine drop + unrelated add in one change** is therefore the
  ordinary destructive path — declare the new column's value and pass
  `--allow-destructive`:

  ```ddd
  migration "add-supplier-ref" { Part.supplierRef = "NO-SUPPLIER" }
  aggregate Part { sku: string  supplierRef: string }   // binCode deleted
  ```
  ```sql
  ALTER TABLE "ops"."parts" DROP COLUMN "bin_code";
  ALTER TABLE "ops"."parts" ADD COLUMN "supplier_ref" TEXT NULL;
  UPDATE "ops"."parts" SET "supplier_ref" = 'NO-SUPPLIER' WHERE "supplier_ref" IS NULL;
  ALTER TABLE "ops"."parts" ALTER COLUMN "supplier_ref" SET NOT NULL;
  ```

  The flag is doing exactly what it says — the old column's data is dropped,
  deliberately — and the new column is populated from the declared backfill
  rather than from the dropped column's rows.
- **Drops.** A `dropColumn` or `dropTable` that survives rename-collapse is
  destructive → blocked unless `--allow-destructive`.
- **Column type changes.** An `alterColumnType` is destructive (`USING col::t`
  can fail or truncate at apply time) — with one carve-out since money's DDL
  became `NUMERIC(19,4)` (#2575): a provably-total **decimal widening** (bounded
  → unbounded, or fractional *and* integer digits both grow) can neither fail
  nor change a value, so it needs no flag. The reverse — including the one-time
  **pre-#2575 money catch-up**, where an unbounded column becomes
  `NUMERIC(19,4)` — rounds >4-dp rows and stays behind `--allow-destructive`
  as a deliberate, reviewed step. Note `(19,4) → (19,8)` is a *narrowing in
  disguise*: scale grows but integer digits shrink 15 → 11, so it is gated too.
- **Required-column adds.** A NOT-NULL `addColumn` with no default on a
  previously-existing table fails on any populated table → blocked unless a
  **backfill step** covers it (see § Data migrations — the safe sequence with
  a real `UPDATE`, no flag needed), the field carries a **scalar-literal
  default** (below), or `migrate add` passes `--allow-destructive`.
  Under the flag it is rewritten into the safe sequence with a
  `-- TODO backfill …` comment in place of the `UPDATE`: add the column
  *nullable* → TODO → `SET NOT NULL` (`alterColumnNullable`). Fill in the
  backfill before applying to real data.
- **Value collections add empty.** A NOT-NULL inline collection column —
  `tags: string[]`, `skills: Skill[]`, any primitive or enum array — needs no
  backfill, no default and no flag: its empty value is derivable from the type,
  and an empty collection is the only value every existing row can honestly
  hold. It rides the same add-WITH-DEFAULT → DROP DEFAULT pair as a field
  default (below), on all five backends (Ecto through `fragment("'{}'")`):

  ```sql
  ALTER TABLE "ticketing"."tickets" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
  ALTER TABLE "ticketing"."tickets" ALTER COLUMN "tags" DROP DEFAULT;
  ```

  A `migration` block backfill of such a field is refused with
  `loom.backfill-target-invalid`, whose message says the step is unnecessary.
  Value-object, entity and `X id` collections live in child / join tables, so
  adding one adds a table, never a column.
- **Field defaults (M-T2.16).** A declared default — `status: string =
  "pending"` — makes the add above non-destructive on its own, with no
  `migration` block to write:

  ```sql
  ALTER TABLE "ord"."orders" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
  ALTER TABLE "ord"."orders" ALTER COLUMN "status" DROP DEFAULT;
  ```

  Postgres fills the existing rows from the DEFAULT as part of the ADD, and the
  DEFAULT is dropped again **in the same migration**. So the column ends up
  exactly as a fresh `CREATE TABLE` lays it down — a database grown by
  migration and one built from scratch are the same database — and the value
  the domain layer owns never becomes a second source of truth in the schema.
  Three consequences worth stating plainly:

  - the **initial** `CREATE TABLE` carries no `DEFAULT`, then or ever;
  - after the migration the column has no default, so an `INSERT` that omits
    it is refused exactly as it is on a fresh create — supplying the value
    stays the domain layer's job;
  - editing the default on a column that already exists emits nothing, because
    there is no DB default to alter.

  Restricted to the **scalar-literal** subset a column default can hold:
  string / int / long / decimal / money / bool literals and enum values.
  `now()`, `currentUser.*`, sibling-field references and value-object leaves
  are excluded — a column default is evaluated with no row in scope, so
  Postgres forbids any reference to another column. Those belong in a
  `migration` block backfill, whose subset is wider for exactly that reason.
  A backfill step **wins** where both could apply: it is the author's explicit
  statement about this one migration, and it is the only one of the two that
  can express a per-row value.
- **Capability columns on a populated table.** A built-in capability added to
  an aggregate whose table already holds rows adds columns the source never
  spells. Each is handled by whether its value for the EXISTING rows is
  knowable:

  | Capability | NOT NULL column | Existing rows | On a populated table |
  |---|---|---|---|
  | `softDeletable` | `is_deleted` | `false`, unambiguously (no row was ever soft-deleted before the capability) | added `DEFAULT false`, the default dropped in the same migration, as a field default (above). No flag, no block |
  | `versioned` | `version` | `1` | a real `DEFAULT 1` column, never blocking |
  | `tenantOwned` | `tenant_id` | unknown: which tenant owns a pre-tenancy row is a business fact, and a wrong guess leaks it | **refused**, with a line naming the capability and why |
  | `auditable` | `created_at`/`updated_at`/`created_by`/`updated_by` | unknown: the real creation time and author are lost | **refused**, same |

  The nullable ones (`deleted_at`, `data_key`) need nothing. A declared
  `migration "…" { Agg.field = <value> }` block still wins over the automatic
  `softDeletable` fill, and is the remedy for the two refused ones:

  ```text
  - ADD COLUMN l.accounts.tenant_id NOT NULL (no default) — contributed by `with tenantOwned`. Loom cannot infer which tenant owns a row written before tenancy, and a wrong guess hands it to another tenant, so there is no automatic backfill. Declare what the existing rows hold in a migration block (`migration "…" { <Agg>.<field> = <value> }`), or add the capability before the table holds data.
  ```

- **NULL → NOT NULL flips** (M-T2.3). Making an existing column required
  fails at apply time on any row holding NULL, so the flip is classified
  destructive too — unless a backfill step covers the column, in which case
  it becomes `UPDATE … WHERE … IS NULL` → `SET NOT NULL`, non-destructive.
- **Default changes.** An `alterColumnDefault` (G2.5) — a column's default
  literal added, removed, or edited with its type/nullability unchanged — is
  **never destructive**: it only changes what future `INSERT`s without an
  explicit value pick up (`SET DEFAULT <expr>` / `DROP DEFAULT`), so it needs
  no flag and touches no existing row.

```bash
ddd migrate add drop-legacy app.ddd                       # aborts on a destructive delta
ddd migrate add drop-legacy app.ddd --allow-destructive   # records it (drops; NOT-NULL → 3-step)
```

### The inferred rename announces itself — `loom.migration-rename-inferred`

The three contrary signals above narrow the guess; they cannot eliminate it,
because nothing can. A rename and an unrelated drop+add of the same shape reach
`applyDestructivePolicy` as a byte-identical diff, so whichever way the
heuristic jumps, one of the two authors is not being served. Collapsing is the
right default — the author who *did* rename would otherwise lose the column —
but it leaves a residual: the author who did **not** rename gets the old
column's rows under the new column's name.

What made that residual dangerous was not the guess, it was the **silence**.
The collapse used to fire and the run to report `0 error(s), 0 warning(s)`, so
nothing ever told that author to look. It now emits
**`loom.migration-rename-inferred`** every time it fires, naming the table, both
column names, and the way to declare the intent either way:

```
loom.migration-rename-inferred warning: migration for module "Cat": inferred a RENAME of
  shop.products.title -> description (one dropped column, one added column, same type and
  nullability, no backfill and no default). If these are unrelated columns, the old column's
  data will land under the new name. Declare the intent either way:
    migration "rename-…" { <Aggregate>.<oldField> -> <newField> }   // yes, a rename
    migration "backfill-…" { <Aggregate>.<newField> = <value> }     // no — a new column, and this is what its existing rows get
```

It is a **warning**, deliberately, and it does not gate the exit code: the
inference is load-bearing, so an error would break every model that relies on
it, and the migration *is* written. Declaring the intent — either way — silences
it, because both declarations are contrary signals the collapse already yields
to:

- `migration "…" { Agg.old -> new }` — yes, a rename. The explicit intent feeds
  `diffSchema`, so no drop+add pair ever reaches the heuristic and there is
  nothing left to guess.
- `migration "…" { Agg.new = <value> }` — no, a new column. The declared
  backfill is contrary signal 2, so the pair stays drop+add and falls under
  `--allow-destructive` (§ Rename detection, *Expressing a genuine drop +
  unrelated add in one change*).

A scalar-literal field default on the added column (contrary signal 3) silences
it for the same reason as the backfill. A nullability difference (signal 1)
never reaches the warning either — it raises
`loom.migration-ambiguous-rename` instead, which is an error.

## Data migrations (M-T2.3)

Structural DDL moves the *schema*; the `migration` block's **data steps** move
the *data* — through the same migration chain, versioned and history-tracked
like every DDL step. Two steps exist, both deliberately minimal:

**Backfill — `Agg.field = <expr>`** (keyword-free, like the `->` rename). The
expression is validated against a SQL-renderable subset (literals, enum
values, sibling *scalar* fields as column refs, arithmetic/comparison/boolean
operators, `?:`, `now()`, and `datetime ± days/hours/minutes(n)`; codes
`loom.migration-expr-unsupported`,
`loom.backfill-type-mismatch`, `loom.backfill-target-invalid`) and fires
whenever the diff adds that column or flips it NOT NULL:

```ddd
aggregate Order { placedAt: datetime  status: string }   // status added this generation
migration "order-status" { Order.status = "pending" }
```
```sql
ALTER TABLE "sales"."orders" ADD COLUMN "status" TEXT NULL;
UPDATE "sales"."orders" SET "status" = 'pending' WHERE "status" IS NULL;
ALTER TABLE "sales"."orders" ALTER COLUMN "status" SET NOT NULL;
```

A duration is admitted in exactly one shape — a direct `days(n)` / `hours(n)` /
`minutes(n)` operand of `+`/`-` on a datetime — and renders as Postgres
interval arithmetic, which adds the same absolute span every backend's runtime
adds. A bare duration, `duration ± duration`, or a duration on a non-datetime
stays refused (there is no duration column to write it to):

```ddd
migration "sla-deadline" { Ticket.dueAt = createdAt + hours(24) }
```
```sql
UPDATE "ticketing"."tickets" SET "due_at" = ("created_at" + make_interval(hours => 24)) WHERE "due_at" IS NULL;
```

Naturally **ledger-inert** like renames: once the column is baked into the
baseline snapshot the step matches nothing. That inertness is the *only*
silent outcome a backfill has: if the column is **not** in the baseline — so
this migration is adding it — and nothing consumed the step, the derivation
aborts with **`loom.migration-backfill-discarded`** rather than writing a
migration in which the author's declared value never runs. (That is a compiler
invariant, not a model error: it is what the rename heuristic used to produce
when it swallowed the `addColumn` the backfill was waiting for.)
Backfills target single scalar columns only — value-object leaves are excluded (Phoenix stores a VO as one
`:map` column, so a leaf UPDATE would not be portable).

**Raw SQL — `sql "…"`** — the escape hatch for one-shot DML the backfill
subset can't express. Emitted **exactly once**: the snapshot records each
step's `"<block>#<index>"` key in `appliedDataMigrations` (raw SQL has no
structural condition to be naturally inert against). Runs *after* the
generation's structural steps, in declaration order. On Ecto both data steps
render through `execute/1`; everywhere else they ride the same migration file
as the DDL (`renderBackfillSql` is shared, so the DML is bit-identical).

```ddd
migration "clear-legacy-notes" { sql "UPDATE sales.orders SET note = '' WHERE note IS NULL" }
```

**`sql before "…"`** — the opt-in modifier that emits the step *ahead* of the
generation's structural steps instead. It exists for the fix-up the new DDL
would otherwise reject — the canonical case is a dedupe that must run before
a new `unique (…)` index is created over a populated table. Same exactly-once
ledger, same declaration order among the `before` steps, same file (Ecto:
`execute/1` first in `change/0`). On a module's **Initial** generation there is
nothing to precede — none of its tables exist yet — so `before` keeps the
trailing position there, on every backend. `before` is a placement word, not a
reserved keyword — it stays usable as a field, workflow or `let` name — and any
other placement is rejected (`loom.migration-sql-placement`).

```ddd
aggregate Account { number: string  unique (number) }   // unique added this generation
migration "dedupe-account-numbers" {
  sql before "UPDATE banking.accounts SET number = number || '-' || left(id::text, 4) WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY number ORDER BY opened_at) rn FROM banking.accounts) x WHERE rn > 1)"
}
```
```sql
UPDATE banking.accounts SET number = number || '-' || left(id::text, 4) WHERE id IN (…);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_number_uq" ON "banking"."accounts" ("number");
```

Raw SQL is verbatim — **schema-qualify every relation** (`sales.orders`, not
`orders`): the generated DDL is schema-qualified, and the migration runners'
`search_path` does not include context schemas, so an unqualified name fails
at apply time (Flyway/Drizzle/psql alike).

**Moving data between tables is a raw `sql` step.** A backfill fills one column
from its *own* row, so a reshape that moves rows elsewhere — splitting a
contained collection into a new aggregate, say, or turning internal comments
into `InternalNote` rows — has no keyword form. Declare the new table, then
copy into it with `INSERT … SELECT` in the same generation (the raw step runs
after the generation's DDL, so the target exists), and drop the old column or
table in a later, destructive-gated generation:

```ddd
migration "split-internal-notes" {
  sql "INSERT INTO support.internal_notes (id, ticket_id, body) SELECT gen_random_uuid(), ticket_id, body FROM support.comments WHERE internal"
}
```

This is the intended pressure valve, not a gap awaiting syntax
(D-MIG-DSL-STEPS): a cross-table move is one-shot DML whose shape is specific
to the model, and the raw step already runs once, in order, on all five
backends.

A raw step is pinned to the module its block's *other* steps name; a block
with only `sql` steps targets the system's single owner module, and an
ambiguous scope (a block spanning modules, or no affinity in a multi-module
system) aborts with `MigrationSqlScopeError` — split the block per module.

**No transform clause — expand→migrate→contract.** A type change with a value
mapping needs no dedicated syntax, because backfills may reference sibling
columns: generation 1 adds the new column and fills it from the old
(`Order.totalCents = total * 100`); generation 2 drops the old column
(destructive-gated, deliberate). An in-place `alterColumnType` keeps the
blind `USING col::type` cast — Postgres fails loudly on impossible casts.

**TPH concrete renames.** Renaming a TPH concrete changes no DDL, but its
rows keep the old `kind` discriminator — the rename cascade emits a ledgered
one-shot fix-up:

```ddd
migration "vendor-to-sponsor" { Vendor -> Sponsor }   // Vendor is TPH under Party
```
```sql
UPDATE "parties" SET "kind" = 'Sponsor' WHERE "kind" = 'Vendor';
```

### A spent block says so — `loom.migration-block-applied`

A `migration` block is never re-run — renames and backfills are inert once the
baseline reflects them, and `sql` steps are ledgered — so it may stay in the
source forever. Once **every** step is already recorded in the baseline
snapshot of every module it touches, `generate system` prints a
**suggestion** (it never gates the exit code and is not counted as a warning):

```
loom.migration-block-applied suggestion: migration "sla-deadline" is fully applied: every step is
  already recorded in the schema snapshot (its renames and backfills are reflected in the schema,
  its sql steps are in the applied ledger), so it has no further effect. You may remove it from
  the source; the migration files already emitted keep its SQL.
```

What counts as recorded is read off the snapshot, never guessed: a column
rename's new column exists and its old one does not; a table rename's new
relation exists and its old one does not; a backfill's column exists and this
generation emits no `UPDATE` for it; a `sql` step's key is in
`appliedDataMigrations`. It stays silent on a first run, in the generation that
runs the block, and while any one step still has work to do. Removing the block
is safe because the emitted migration files are immutable and already carry its
SQL — a database that has not applied them yet still gets it.

### A unique index on a populated table — `loom.migration-unique-on-existing-table`

A diff cannot see the data. Adding `unique (…)` to an aggregate whose table
already exists in the baseline emits a `CREATE UNIQUE INDEX` that fails at boot
if any stored rows collide — the migration rolls back (cleanly; every backend
applies a generation in one transaction), the service does not come up, and
every later generation queues behind the failing one. So `generate system`
warns, at derivation time, beside the other phase-⑨ advisories:

```text
loom.migration-unique-on-existing-table warning: migration for module "Retail": adds unique index accounts_number_uq on existing table banking.accounts (number). Rows already stored may violate it — … dedupe them AHEAD of the index in this same generation (declaring one silences this warning):
    migration "dedupe-…" { sql before "UPDATE <schema>.<table> SET … WHERE …" }
1 warning(s) in derived migrations.
```

Declaring any `sql before` step for the module in the same generation is read
as "handled" and silences it; a plain (trailing) `sql` step does not — it runs
after the index. Not raised for a table created this generation (empty), a
module's first generation, or a rebuild of a unique index the baseline already
had over the same columns (the drop + add a column rename causes, or a full
unique narrowed to a partial one). A NEW partial unique (`softDeletable`'s
`WHERE is_deleted = false`) still warns — it is a uniqueness claim over the
live rows. A warning never changes the exit code.

### A unique index follows a `softDeletable` flip (partial ↔ full)

Under `softDeletable` the `unique (…)` index is **partial** (`WHERE is_deleted =
false`), so a live row may reuse a soft-deleted row's key. The index name
(`<table>_<cols>_uq`) depends only on the table and the columns, so flipping the
capability keeps the name and changes only the predicate. The index diff
compares the whole index (columns after renames, uniqueness, predicate,
opclasses), not only the name: a same-named index whose shape changed is
**rebuilt**, as a `DROP INDEX` + `CREATE … INDEX`, because Postgres cannot alter
an index predicate. The drop rides the leading index-drop bucket and the create
the trailing index-add bucket, so a predicate that names `is_deleted` is created
after that column's `ADD COLUMN`, and dropped before its `DROP COLUMN`. All five
backends render it: Ecto as `drop index(…)` + `create index(…, where: …)`, the
others as shared Postgres SQL.

```ddd
// generation 1: aggregate Account with crudish { number: string  unique (number) }
aggregate Account with softDeletable, crudish { number: string  owner: string  unique (number) }
```
```sql
DROP INDEX "ledger"."accounts_number_uq";
--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ALTER COLUMN "is_deleted" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_number_uq" ON "ledger"."accounts" ("number") WHERE is_deleted = false;
```

- **Full → partial (adding `softDeletable`)** relaxes the constraint: every row
  the full index admitted, the partial one admits too. The flip is not
  destructive and raises no warning. The NOT NULL `is_deleted` column fills
  itself (§ Capability columns on a populated table).
- **Partial → full (dropping `softDeletable`)** tightens the constraint. The
  formerly soft-deleted rows now count, so a live row that reused a deleted
  row's key makes the `CREATE UNIQUE INDEX` fail at boot. This raises
  `loom.migration-unique-on-existing-table`. Dedupe the rows with a
  `sql before` step, as described in the previous section. Dropping
  `is_deleted` itself is a `dropColumn`, so it needs `--allow-destructive`.

Before this, the diff paired indexes by name only. The flip emitted no index
step, and the database kept whichever index the first generation created.

The migration-evolution tier runs both directions against a populated database
on every SQL backend (`runUniqueIndexEvolutionGate`, `npm run
test:migration-evolution{,-python,-java,-dotnet,-elixir}`):
- full → partial: the migration applies with no backfill block and no flag
  (the pre-existing row still reads 200, `is_deleted = false`, and the column
  has no default left), a soft-deleted row's key is reused (201), and a live
  duplicate gets 409;
- partial → full: a `sql before` dedupe runs, the index is rebuilt full, and a
  duplicate gets 409.

### Amending a generation that never applied

A recorded generation is frozen: it is a file in `migrations/`, and the next
`migrate add` diffs against the schema it leaves. If that generation then FAILS
at boot (the unique-index case above), recording the fix as a new generation
puts it BEHIND the one that fails, so it never runs. A failed generation was
never recorded by the migrator — each backend applies a generation inside a
transaction on Postgres (Drizzle, EF `Database.Migrate()`, Flyway, Ecto, the
python runner's `__loom_migrations`), so a failure leaves no history row — and
it is therefore safe to **replace it**, as long as no database has applied it:

1. `ddd migrate remove app.ddd` — once per entry the failed generation
   recorded (one per module it changed); each run deletes the newest.
2. Amend the `.ddd` (e.g. add the `sql before` dedupe).
3. `ddd migrate add <name>` again, then `ddd generate system`.

If any database DID apply the generation, do not replace it — record a new one
instead. The other way out — running the fix by hand
(`docker compose exec db psql -U postgres -d <db> -c "UPDATE …"`) and
restarting the service so the frozen generation re-runs — works, but leaves the
fix outside the model.

**Down migrations are no-op by decision** (D-MIG-NO-DOWN): operators roll
forward; recovery is backup + roll-forward. And data steps live in the DSL,
not in per-backend stub files (D-MIG-DSL-STEPS) — one source, five backends.

## Reshape detection — the `loom.migration-shape-change` gate (M-T2.4)

Flipping an aggregate's `shape: relational|embedded|document` or its TPH/TPC
inheritance strategy **reshapes the physical table** — a full-table data move the
column diff can't express (a relational row becomes `(id, data, version)`; one
shared TPH table becomes one table per concrete). To detect it, the snapshot
`TableShape` carries two optional stamps: `savingShape` (aggregate root) and
`inheritance` (`{strategy, base}` on TPH-shared / TPC-concrete tables). Both are
optional — `schemaVersion` stays `1`, and an **unstamped pre-M-T2.4 baseline is
simply not compared** (the flip falls to the generic destructive gate, exactly as
before — backward-compatible grace).

`detectReshapes` finds a **saving-shape flip** (matched table, `savingShape`
changed) and an **inheritance-strategy flip** (TPH↔TPC, whose table *names*
change, grouped by root base across the drop/create sets). A flip raises the
dedicated **`MigrationShapeChangeError`** (`loom.migration-shape-change`) instead
of the generic destructive listing. Under `--allow-destructive` there is **no
drop**: the old table is renamed to `<table>__pre_reshape` (kept for the data
move), the new shape is created empty, and a `-- TODO reshape …` recipe marks the
`INSERT … SELECT` the operator runs. The backup is recorded in the written
snapshot, so its cleanup drop is destructive-gated the *next* generation.

```sql
-- relational Cart → `shape: document` Cart, under --allow-destructive
ALTER TABLE "carts" RENAME TO "carts__pre_reshape";
CREATE TABLE "carts" ("id" UUID NOT NULL, "data" JSONB NOT NULL, "version" INTEGER NOT NULL, PRIMARY KEY ("id"));
-- TODO reshape (…): copy data from "carts__pre_reshape" into the new shape (e.g. INSERT … SELECT), then drop the backup under --allow-destructive
```

## The migration chain — `migrations/` beside the source

Every generation a model has recorded lives beside its entry `.ddd`, in
`migrations/`, one JSON file per (generation, module):
[`src/system/migration-chain.ts`](../src/system/migration-chain.ts) owns the
format and every rule, `src/cli/migrate.ts` only moves the files. Each entry
carries the backend-neutral `steps` **and** the module's schema after them, so
`generate system` renders every backend's migration files — the whole chain,
every run — from `migrations/` alone. The output tree holds no migration state,
can be deleted, and regenerates byte-identically anywhere: CI, a fresh clone, a
second environment.

```text
app.ddd
migrations/
  20261025141500_sales_initial.json
  20261026141500_billing_initial.json
  20261102093000_sales_rename_order_qty.json
```

```bash
ddd migrate add initial app.ddd             # first recorded generation: each module's Initial
ddd migrate add rename-order-qty app.ddd    # every later schema change, kebab-case name
ddd migrate status app.ddd [--json]         # each module's head, and what is not recorded yet
ddd migrate remove app.ddd                  # delete the newest entry (one no database has applied)
ddd migrate rebase app.ddd                  # after a merge leaves two heads, re-record one on top of the other
ddd generate system app.ddd -o out          # renders the chain; never records anything
```

**Commit `migrations/`.** It is the record a database's migration history
is checked against.

**A model with no `migrations/` has nothing recorded.** `generate system`
then emits each owning module's initial migration, derived from the model and
numbered from `BASE_VERSION`, with nothing to drift from — every example and
fixture in this repository works that way. The first `migrate add` starts the
chain, and from then on `generate system` refuses a model that has moved past
the chain's head (`MigrationDriftError`, naming the modules) until the change
is recorded.

**Versions.** An entry's version is the UTC clock at `migrate add`
(`YYYYMMDDHHMMSS`), moved above the head when the clock is behind it, and above
`head + INITIAL_RESERVATION` (one "day", `1_000_000`) when the head is a
module's `Initial` — one initial expands into many files on Ecto, which numbers
one per table from the generation's version. So a version is unique across
modules and strictly increasing along the chain, and every backend's migrator
(Drizzle's watermark, Flyway's out-of-order refusal, Ecto's per-file versions)
sees a new generation above everything it already applied.

**One list.** Every entry names the entry recorded just before it, of any
module, by id (`<version>_<module>_<name>`, its file name without `.json`) —
an id rather than a version, because two branches recording on top of the same
head can draw the same version. Two entries naming the same predecessor are
**two heads**: what two branches that each recorded a migration look like once
merged. `generate system` and `migrate status` then refuse the chain
(`MigrationChainError`) and point at `ddd migrate rebase`, which deletes the
later-recorded branch's entries (`--move <version>` picks the other) and
records the merged model's changes again on top of the remaining head, under the
moved migration's name (`--name` to change it) and with its
`--allow-destructive` decision. The same error covers a missing predecessor, an
entry numbered at or below the one it follows, a file name that does not match
its contents, two entries of one module sharing a name, and unparseable JSON (an
unresolved merge conflict).

## `migrationsOwner` — one backend per module owns schema

Schema emission is assigned to exactly one deployable per module so two backends
sharing a module don't both create the tables. `assignMigrationsOwner`
([`enrichments.ts`](../src/ir/enrich/enrichments.ts)) walks `sys.deployables` in
declaration order and picks the **first deployable that hosts any context of the
module AND whose platform owns a database** (`PlatformSurface.needsDb`, read via
`descriptorFor` — no hardcoded platform list). Failing that, `migrationsOwner`
stays undefined and no migrations are emitted.

At distribution time (`migrationsForDeployable` in
[`system/index.ts`](../src/system/index.ts)), every `needsDb` deployable that hosts
a context of the module still *receives* that module's `MigrationsIR` (each
compose service has its own database, so each must run the migrations) — but only
the `migrationsOwner` derivation gates whether the slice is built at all.

## How IR maps to tables

`schemaFromModule` collects every aggregate in the module (alphabetical) and
produces tables. The shape depends on the aggregate's saving shape, persistence
mode, and inheritance:

**Aggregate → table.** `aggregate Order` → table `orders` (`plural(snake(name))`),
`id` PK typed from `idValueType`, one column per scalar/enum/`X id` field.

```ddd
context Sales {
  aggregate Order {
    placedAt: datetime
    customer: Customer id
    status: OrderStatus
  }
}
```

```sql
CREATE TABLE orders (
  id UUID NOT NULL,
  placed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  customer_id UUID NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (customer_id) REFERENCES customers ON DELETE RESTRICT
);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

A `Customer id` field becomes a `customer_id` FK (`ON DELETE RESTRICT`) plus a
covering index. Type mapping: `int→INTEGER`, `long→BIGINT`, `decimal→DECIMAL`
(unbounded), `money→DECIMAL(19, 4)` (the canonical bound every ORM layer also
declares — see `money-scale.ts`), `string→TEXT`, `bool→BOOLEAN`,
`datetime→TIMESTAMP WITH TIME ZONE`, `guid→UUID`, `json→JSONB`. Bounds are part
of the column's identity in the diff: a bare-`DECIMAL` baseline against a
bounded target emits an `alterColumnType` (see § Destructive changes).

**Containments → child tables.** A contained entity part gets its own table with
a `<parent>_id` FK (`ON DELETE CASCADE`) back to the owner. The FK-dependency
sort guarantees the parent is created first even though `pipelines` sorts before
`projects` alphabetically.

**Value objects → flattened columns.** A `price: Money` field destructures into
`price_amount`, `price_currency` (recursively for nested VOs), each tagged with a
`voGroup` so Phoenix/Ecto can regroup them into a single `:map`. Relational
backends emit the columns as-is.

**An OPTIONAL value object carries a null-consistency `CHECK`.** Flattening an
optional VO makes N *independent* nullable columns, but every backend reads the
group atomically — java's record compact constructor runs the VO's invariant,
node asserts each leaf non-null, python passes each leaf straight in. A
partially-null row therefore crashes the load, and nothing else in the schema
forbids one (a hand-written `UPDATE`, a bad backfill, a future partial-update
path). The builder emits one `CheckShape` per optional VO *node*:

```ddd
valueobject Geo  { lat: decimal  lng: decimal }
valueobject Addr { line1: string  line2: string?  city: string  geo: Geo? }
aggregate Order { shipTo: Addr? }
```

```sql
CONSTRAINT "orders_ship_to_null_consistent" CHECK (
  ("ship_to_line1" IS NULL     AND "ship_to_city" IS NULL) OR
  ("ship_to_line1" IS NOT NULL AND "ship_to_city" IS NOT NULL)),
CONSTRAINT "orders_ship_to_geo_null_consistent" CHECK (
  ("ship_to_geo_lat" IS NULL     AND "ship_to_geo_lng" IS NULL) OR
  ("ship_to_geo_lat" IS NOT NULL AND "ship_to_geo_lng" IS NOT NULL))
```

The grouping rules, each of which exists to keep the constraint from rejecting
*valid* data:

- **Optional nodes only.** A required VO's leaves are already `NOT NULL`, so the
  constraint would be a tautology. (A `NOT NULL`-only group is dropped, which is
  also the safety net for builders that derive nullability their own way.)
- **A subfield that is itself optional is excluded.** `line2: string?` is a
  legitimately-null column of a *present* address.
- **Whole tree, one constraint per optional node.** A required nested VO
  (present exactly when its parent is) folds into the parent's group; an
  optional nested VO gets its own and leaves the parent's. They compose — when
  the outer node is absent every leaf is null, which satisfies the inner
  constraint too.
- **Fewer than two required leaves ⇒ nothing.** One column makes the predicate a
  tautology; zero means an absent VO and a present all-null one are the same row.

On an EXISTING database the `ALTER` path renders `NOT VALID`: stored rows may
already violate the constraint (nothing enforced it before), so validating
retroactively would abort the migration on exactly the database that most needs
the guard. Every future `INSERT`/`UPDATE` is enforced immediately; the emitted
comment names the `ALTER TABLE … VALIDATE CONSTRAINT …` an operator runs to
back-check the old rows deliberately. A `createTable` carries its checks inline,
where there is nothing to validate.

Phoenix emits none of *this kind* — Ecto stores a value object as one `:map`
cell, so the group cannot be half-written and the leaf columns the constraint
names do not exist. It does emit the enum kind below.

Checks are derived for the **domain** tables only: the aggregate root, its TPH
shared table, its contained-part tables, and its value-collection child table —
the rows a repository hydrates back into a real value object. The projection
read-model and workflow-state tables also flatten, but both make their non-key
columns nullable *on purpose* (a fold or a workflow step upserts only the fields
the event it is handling carries), so a half-filled row there is the designed
state and a constraint could fail on legitimate data.

**An `enum` column carries its VALUE SET as a `CHECK`.** An enum persists as
`TEXT` on every backend, so without this the set of legal values is not part of
the schema at all — and two ordinary evolutions were therefore complete
no-ops, emitting **no migration, no constraint and no warning**:

| change | before | now |
|---|---|---|
| `skill: string` → `skill: Skill` | column type unchanged (`TEXT` → `TEXT`) ⇒ empty diff | `addCheck` |
| `enum Skill { physio, gp, dentist }` → `{ physio, gp }` | the enum is not in the schema ⇒ empty diff | `dropCheck` + `addCheck` |

In both cases the database went on accepting a value the model had just
outlawed, while the *same generation's* OpenAPI `$ref`-ed the field to the enum
and the *same generation's* zod / pydantic client refused it — the server
serving data its own published contract forbids.

```ddd
enum Skill { physio, gp, dentist }
aggregate Appt { skill: Skill  backup: Skill? }
```

```sql
CONSTRAINT "appts_skill_enum"  CHECK ("skill" IN ('physio', 'gp', 'dentist')),
CONSTRAINT "appts_backup_enum" CHECK ("backup" IS NULL OR "backup" IN ('physio', 'gp', 'dentist'))
```

The same `NOT VALID` rule as above is what makes this safe to land on a
populated database: the `ALTER` leaves already-stored rows alone (so narrowing
an enum can never fail a deploy) while refusing every future write of a removed
value; the emitted comment names the `VALIDATE CONSTRAINT` an operator runs to
audit the old rows deliberately.

Covered: a scalar enum column, at either nullability, on the aggregate root, a
TPH shared table (where a concrete's column is forced nullable, so it gains the
null arm), a part table, and an enum nested inside a **flattened** value object
(`shipTo: Address?` with `Address { country: Country }` → `ship_to_country`).
Not covered, each because the constraint is a different expression rather than a
missing case: an enum **array** (`skills: Skill[]` → `TEXT[]`, which needs
`<@ ARRAY[…]`), an enum inside a VO the lookup cannot resolve (it collapses to
one `json` cell — no column to constrain), and the projection / workflow-state
tables, excluded for the same partial-upsert reason as above.

**All five backends carry this kind, Phoenix included** — it names one real
column that exists everywhere, and an elixir app that skipped it would be the
single backend whose database still accepted a deleted value.

**Reference collections → join tables.** A `X id[]` field never produces a column.
Enrichment derives one `AssociationIR` per such field, and the builder lays down a
join table keyed by `(owner_fk, target_fk)` with both FKs `ON DELETE CASCADE` plus
an `ordinal` column (nullable, default `0`).

```ddd
aggregate Order { items: Product id[] }
```

```sql
CREATE TABLE order_items (
  order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  ordinal INTEGER NULL DEFAULT 0,
  PRIMARY KEY (order_id, product_id),
  FOREIGN KEY (order_id) REFERENCES orders ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products ON DELETE CASCADE
);
CREATE INDEX order_items_product_id_idx ON order_items (product_id);
```

A VO *array* (`charges: Money[]`) produces an id-less child table
(`<parent>_<field>`) of flattened VO columns keyed by `(parent_fk, ordinal)`;
Phoenix skips it (it stores the array inline as `{:array, :map}`).

**Inheritance.** TPC (`inheritanceUsing: ownTable`): the abstract base emits **no
table**, each concrete is standalone with the merged field set. TPH
(`sharedTable`): one shared table named for the base, with `id`, a `kind`
discriminator (`TEXT NOT NULL`), the base's own columns, then every concrete's own
columns **forced nullable** and de-duplicated by name. A TPH concrete's contained
parts FK to the shared base table. See [`inheritance.md`](inheritance.md).

**Other persistence shapes.** `shape: document` → a `(id, data jsonb, version int)`
triple; `shape: embedded` → a queryable root row with one JSONB column per
containment; `persistedAs: eventLog` and `eventSourced` workflows → an append-only
`<name>_events` stream keyed by `(stream_id, version)`. Correlation-bearing
workflows get a state table; a durable channel adds the shared `__loom_outbox`
table.

**Optimistic concurrency (`versioned`).** An aggregate `with versioned` gains a
`version INTEGER NOT NULL DEFAULT 1` state column. Every backend's save path emits
a guarded `UPDATE … WHERE id = $1 AND version = $2` (bumping `version`) and returns
HTTP **409** when zero rows match — a lost-update guard. See
[`capabilities.md`](capabilities.md).

**Manual indexes.** A `resource index: [Entity.col, Entity.(a, b)]` binding
(D-INDEX-INFRA) lands each entry as a non-unique `CREATE INDEX` on the named
entity's table — the manual companion to the auto-derived FK covering indexes
above. The advisory `loom.index-suggestion` lint (D-INDEX-SUGGEST) points at
filtered columns that lack one; it never emits an index on its own. See
[`resources.md`](resources.md).

**Schema qualification.** Each table is stamped with its owning context's Postgres
schema (`snake(context.name)` by default, or the dataSource `schema:` override).
The SQL renderer emits `CREATE SCHEMA IF NOT EXISTS` and qualifies table/FK/index
references. `undefined` means the unqualified `public` schema.

## The Postgres SQL renderer

`renderPgStep(step)` ([`src/generator/sql-pg.ts`](../src/generator/sql-pg.ts))
translates one `MigrationStep` to Postgres DDL. It is **shared by the TS, .NET
(EF Core and Dapper), Python, and Java backends** — calling the same renderer means a migration written
by any of them is bit-for-bit equivalent SQL. Phoenix is the exception: it stays
in Ecto DSL (its output is Elixir, not SQL) so `ecto.migrate` keeps
working, and translates `MigrationStep` itself in
[`elixir/migrations-emit.ts`](../src/generator/elixir/migrations-emit.ts).

It also exports `renderSeedRowInsert` (the `raw` seed-path `INSERT`, shared so
seed SQL is bit-identical cross-backend).

## Where output lands, and boot-time application

| Backend | Output path | Applied at boot via |
|---|---|---|
| Hono / Drizzle | `db/migrations/<tag>.sql` + `meta/_journal.json` | `migrate()` from `drizzle-orm/node-postgres/migrator` (also `npm run db:migrate`) |
| .NET / EF Core | `Migrations/<slug>.cs` (`migrationBuilder.Sql(...)`) | `Database.Migrate()` → `__EFMigrationsHistory` |
| .NET / Dapper | `Migrations/<slug>.cs` (a `LoomMigration` with its `Statements`) | `DbSchema.EnsureAsync` → `public.__loom_migrations` (see below) |
| Phoenix / Ecto | `priv/repo/migrations/<ts>_create_<table>.exs` | `ecto.migrate` |
| Java / Spring | `src/main/resources/db/migration/V<v>.<n>__<Mod>_<Name>.sql` | Flyway |
| Python / FastAPI | `migrations/<tag>.sql` | `run_migrations()` from the FastAPI lifespan; `__loom_migrations` tracking table |

Files use a module-qualified tag (`<version>_<module>_<name>`): the version is
already unique, but every module's first generation is named `"Initial"`, and
the module keeps a filename saying which module it migrates (Ecto's migration
module is `<Module><Name>` for the same reason — its names are app-wide). Down
migrations are no-ops everywhere (operators roll forward, not back).

The fixed **companion tables** — the transactional outbox (`__loom_outbox`), the
command-audit log (`audit_records`) and the provenance history
(`provenance_records`) — are ordinary `MigrationsIR` tables, derived once by
`outboxTableShape` / `auditTableShape` / `provenanceTableShape` in
`src/system/migrations-builder.ts` and gated on the module actually using the
feature. They are machinery, not domain: cross-context (rows carry a
`target_type`), so they take no context schema. Emitting them from one shape is
deliberate — each was once hand-written per backend, and both consolidations
turned up live defects the duplicated copies had been hiding.

What *is* still feature-local and hand-emitted per backend is the
**per-aggregate** half of provenance: the co-located `<field>_provenance` jsonb
columns, which `ALTER` tables the module migration owns and so ship as a *late*
migration (a far-future version like `29991231235959`) sorting after every
generation of the chain.

### `persistence: dapper` — the same chain, on the jsonb layout (M-T2.17)

Until D-DAPPER-ALTER was built, the Dapper adapter applied **no** migrations:
its `DbSchema.cs` ran `CREATE TABLE IF NOT EXISTS` (in `public`) on every boot,
so after the first deploy every model change was silently ignored — added and
renamed columns, backfills, `sql` / `sql before` steps, index flips. It now
applies the same `MigrationsIR` chain EF applies
([`dotnet/emit/dapper-migrations.ts`](../src/generator/dotnet/emit/dapper-migrations.ts)):

- **Emission.** One `Migrations/<version>_<Module>_<Name>.cs` per generation —
  the id EF gives the same migration — rendered by `renderPgStep` and split into
  single statements (`splitPgStatements`, shared with the python runner). The
  late provenance-column migration is the same statements EF's carries.
- **One projection, not a third DDL copy.** The Dapper repositories store a
  value object as ONE `jsonb` column, a scalar/enum list as `jsonb`, and a
  value-object list as `jsonb` on the parent, where the canonical IR flattens /
  uses arrays / a child table. The steps are projected onto that layout before
  rendering — through the same `collapseVoGroups` / `collapseVoSteps`
  ([`_persistence/vo-json-columns.ts`](../src/generator/_persistence/vo-json-columns.ts))
  the Ecto emitter uses for its `:map` value objects. Value-object
  null-consistency CHECKs drop out (the column is the whole value object).
- **Placement.** Tables land in the binding's schema exactly as on EF
  (`snake(<context>)` by default). The repositories keep naming tables
  unqualified; the Npgsql data source sets `SearchPath = public,<schemas>`.
  `public` first, so `__loom_migrations`, `__loom_seed` and `__loom_outbox` stay
  where an unqualified `CREATE` puts them. A `schema:` is therefore honoured; a
  `tablePrefix:` is still refused (`loom.dapper-unsupported#schema-ignored`).
  The `#migrations` and `#schema-split` clauses are gone.
- **Runner.** `DbSchema.EnsureAsync` takes a session advisory lock (so
  concurrent replicas or restarts serialise), reads the applied set from
  `public.__loom_migrations` (the table python already keeps, already
  reset-preserved), and applies every pending migration in id order — an
  applied **set**, not a watermark — each in its own transaction with its
  history row. Idempotent: a reboot applies nothing. The exactly-once
  `appliedDataMigrations` ledger needs nothing new: a raw `sql` step is emitted
  into exactly one generation's file, and that file runs once.

#### Databases the old bootstrap provisioned

**At boot — baselining the database** (`BaselineLegacyAsync` in `DbSchema.cs`).
A database with no `__loom_migrations` table is examined once, inside one
transaction with the creation of that table. For each `Initial` (each carries
the list of tables it creates):

- every table present — in its schema, or still in `public` where the old
  bootstrap put it → the `public` ones are moved (`ALTER TABLE … SET SCHEMA`)
  and the `Initial` is recorded as applied **without running**;
- every table absent → a module the old bootstrap never saw; left pending;
- some of each → refuse to boot, naming the missing tables, rather than guess.

Later migrations then apply normally. The decision rests on the old bootstrap
having provisioned the `Initial`'s shape. That holds column-for-column; it does
not hold for constraints the old DDL never had (the FKs, enum CHECKs,
`DEFAULT 1` on `version`, and money's `NUMERIC(19,4)` bounds), which stay absent
on a baselined database until a later migration touches them.

Compose and k8s need nothing for this. The per-deployable `db-bootstrap`
service (#3141) only ever creates the database; the schema inside it is the
app's to migrate at boot, on every adapter. The chart runs no migration job
either: each app migrates itself at boot, and the advisory lock makes that safe
with more than one replica.

### The Drizzle journal's ordering key

Drizzle is the only backend in the table above whose migrator is a **watermark**
rather than an applied-set: `migrate()` reads the single highest
`__drizzle_migrations.created_at` and applies a journal entry only when
`lastApplied.created_at < entry.when`, strictly. EF, Flyway, Alembic and Ecto all
record *each* applied migration by identity, so for them an inserted migration is
simply pending and nothing can renumber.

That makes `when` load-bearing in a way a filename is not. Three requirements:

1. **strictly increasing** down the journal — a tie or a decrease silently skips
   an entry, and its tables are never created;
2. **never changing** for an entry already applied — a bumped `when` re-runs it,
   and the re-run dies on `already exists`;
3. **strictly greater**, for a newly appended entry, than for every entry already
   applied — otherwise the watermark hides it forever.

`when` is therefore the entry's **position in chain order**:
`when = epochMillis(BASE_VERSION) + ordinal * 2`. The chain only grows at its
head, with a version above every existing one, so an entry's position never
moves (2) and a new entry always lands last (1, 3). Entries take the even slots;
the odd slot just above the newest one carries the always-last provenance
migration, so it sorts after its own generation without sitting above the next
one. The late provenance migration is emitted with `ADD COLUMN IF NOT EXISTS`
because it is re-derived from scratch each generation rather than diffed, so
re-applying it is a no-op — and a field newly marked `provenanced` actually
receives its column. The runtime gate is the `journal-ordering` leg of
`migration-evolution-e2e`.

## Migration-evolution gate — proving migrations evolve *on data* (M-T2.13)

The tiers above prove a migration **emits** (`test:k8s`, corpus compile) and
**applies to a fresh database** (the obs / tenancy e2e migrate an empty DB at
first boot). Neither proves a migration **evolves** correctly on data that
already exists — the silent-data-loss class. The `migration-evolution-e2e.yml`
gate closes that, with two runtime checks per SQL backend against a real
Postgres:

1. **migrate-vs-create equivalence.** The domain schema after applying the full
   chain (`Initial` v1 → delta v2) must be byte-for-byte equal to a *fresh*
   `create` of the head (v2) model. A drift means an `ALTER` diverged from what a
   `CREATE` of the same shape produces. The comparison is an **order-independent**
   per-column/PK fingerprint (via host `psql` on `information_schema`): physical
   column order legitimately differs — a rename leaves a column in place while an
   add appends — so columns are sorted by name, and each backend's
   migration-runner bookkeeping table (`__drizzle_migrations`,
   `__loom_migrations`, `__EFMigrationsHistory`, `flyway_schema_history`,
   `schema_migrations`) is excluded so only the domain schema is compared.
2. **Populated forward-migrate.** Seed a v1 row through the REST surface,
   record the `.ddd`'s v2 with `ddd migrate add` and regenerate the same tree
   (so the chain carries the forward migration), apply it (at boot for node/python/dotnet/java; an
   explicit `mix ecto.migrate` for vanilla Phoenix), and assert the row
   **survives** with correct values — the renamed column keeps its value, the
   back-filled NOT-NULL column is populated, the nullable add is NULL. A
   destructive/lossy change the derive should have gated shows up here as a lost
   or wrong row.

The v1→v2 delta ([`test/e2e/fixtures/migration-evolution/{base,evolved}.ddd`](../test/e2e/fixtures/migration-evolution))
is deliberately gate-clean (explicit rename intent + a backfill make it
non-destructive, so no `--allow-destructive`), exercising the three
data-preserving move classes together: a value-preserving `renameColumn`, a
back-filled NOT-NULL add (add-nullable → `UPDATE` → `SET NOT NULL`), and a plain
nullable add.

The shared harness ([`test/e2e/support/migration-evolution-harness.ts`](../test/e2e/support/migration-evolution-harness.ts))
owns the Postgres lifecycle (one server, `chain` + `fresh` databases), the
fingerprint, and both assertion sequences; a thin per-backend `BackendDriver`
supplies only the boot mechanics (mirroring the `tenancy-isolation` recipes).
Opt-in, per backend: `npm run test:migration-evolution{,-python,-java,-dotnet,-dapper,-elixir}`
(each gated on `LOOM_MIGRATION_E2E[_…]=1`; needs docker or `LOOM_MIGRATION_PG_URL`
plus host `psql`). The gate runs per-PR (path-scoped) and in the merge queue;
see [`ci-gating.md`](ci-gating.md). The `dapper` leg runs every gate the `dotnet` leg runs on `persistence:
dapper`.

## Semantic changes that emit no migration — exact `decimal` arithmetic (RS-37)

Not every change to what lands in a column is a schema change. When
[RS-37](conformance-semantics.md) made `decimal` arithmetic exact on node and
python (M-T5.22 — the other three backends already computed it exactly), the
column type did not move, so phase ⑨ derives **no migration** and none is
needed. What moved is the *value* those two backends compute and then write: a
`derived x: decimal = a + b`, or an operation's `total := total + x`, now stores
`0.3` where it stored `0.30000000000000004`.

**Historical rows are not rewritten.** A row node or python persisted before the
change keeps its binary-float value, so an unchanged input can read back
`0.30000000000000004` from an old row and `0.3` from a new one — and a
`find … where` equality against a stored computed value can match one and miss
the other. A stored `derived` column can be brought into line by re-saving the
row through the regenerated backend (a save recomputes every `derived` from the
row's own fields) or by a one-off `UPDATE … SET x = <the same expression in
SQL>` — Postgres `numeric` arithmetic is exact, so the SQL answer is the new
answer. A value an OPERATION wrote cannot be recomputed that way — the inputs it
was computed from are gone — so it keeps its old spelling unless the
deployment rounds it itself. Loom emits no backfill for either: it has no record
of which stored values were computed rather than entered.

## A column type that moved without a migration — elixir `datetime` (RS-38)

[RS-38](conformance-semantics.md) (wave C5 moment 5b, ledger `F2-W-06`) moved
the Phoenix backend's declared `datetime` columns from `:utc_datetime` — Ecto's
`timestamp(0)`, SECOND precision — to `timestamptz`, the microsecond column the
other four backends already used, read through the `Loom.Datetime` Ecto type
(milliseconds on the wire). The MigrationsIR did not change: the column is still
a `datetime`, and phase ⑨ derives **no** migration step for it. What changed is
how the elixir migration emitter *renders* that column type, so:

- **A fresh database** gets `timestamptz` from the initial migration, and a
  written fraction round-trips.
- **A database created before the change** keeps its `timestamp(0)` columns —
  its initial migration already ran and Ecto does not re-run it. The regenerated
  app still boots and still reads, but Postgres ROUNDS a sub-second value to the
  second on write (`.999` becomes the next second), so the stored value can
  disagree with what the request carried. Alter the columns once:

  ```sql
  ALTER TABLE <schema>.<table>
    ALTER COLUMN <column> TYPE timestamptz USING <column> AT TIME ZONE 'UTC';
  ```

  for every declared `datetime` column (the stamped `created_at` / `updated_at`
  of an `auditable` aggregate included) and the event-log `occurred_at`. Loom
  emits no such step: a type change that does not move the IR is invisible to
  the diff that would have to produce it — the same limit the RS-37 note above
  records for values.

## Relationship to `.loom/` and `wire-spec.json`

Two change records sit side by side and are easy to conflate:

- **`migrations/`** (beside the `.ddd`, committed) *is* the migration history —
  every recorded generation's steps and the schema it leaves; the next
  `migrate add` diffs against its head.
- **`.loom/wire-spec.json`** is the JSON-Schema-shaped derivation of every
  aggregate's `wireShape` — the network contract, not the database schema. Both are
  diffable change detectors, but they describe different surfaces (the JSON over the
  wire vs. the tables on disk).

See [`loom-artifacts.md`](loom-artifacts.md) for the full `.loom/` bundle and
[`technical.md`](technical.md) § Phase ⑨ for the orchestration walk-through.

## Language-version migrations

The rest of this page is about *schema* migrations the compiler derives. This
section is about the other kind: a language change that moves what an
unchanged `.ddd` means, and the mechanical edit that keeps a project's
behaviour across it.

### The `enforcement:` default flip (M-T3.1)

**What changed.** An `auth { … }` block that writes no `enforcement:` used to
be in `enforcement: opt` — only members that declare a `requires` gate were
gated, and every other client-reachable command and read served any
authenticated caller. It is now in `enforcement: denyByDefault`: every
client-reachable command (operations, creates, destroys, workflow starters and
handlers, route-bound command/query handlers) and every declared read (named
finds, projections, workflow-instance reads, `audited` history) on an
`auth: required` deployable must carry a `requires` gate, or the build fails
with `loom.default-deny-ungated` / `loom.audit-history-ungated`
([`auth.md`](auth.md) lists every arm and the two warning-only exceptions).

**What did not change.** A system with no `auth { … }` block has no enforcement
posture and is not checked, before or after. `enforcement:` has no effect on
the generated code — `denyByDefault` is a compile-time refusal, not a runtime
filter — so a model that validates under both postures emits byte-identical
output under either. A gated route answers 403 exactly as it did.

**Keeping the old behaviour.** Write `enforcement: opt` into the `auth` block.
The codemod does it for every block that names no `enforcement:`:

```bash
node scripts/codemod-enforcement-opt.mjs .            # rewrite every *.ddd under .
node scripts/codemod-enforcement-opt.mjs --list .     # print what it would rewrite
node scripts/codemod-enforcement-opt.mjs --check .    # exit 1 while any block still relies on the default
```

```ddd
auth {
  enforcement: opt          // inserted by the codemod
  provider: keycloak
  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
}
```

It is a text edit — comments and formatting outside the inserted clause are
untouched, a commented-out `auth {` is not a block, and a block that already
names `enforcement:` (either value) is left alone, so it is safe to re-run.

**Adopting the new default instead.** Delete the `enforcement: opt` line (or
never run the codemod), run `ddd parse`, and answer each
`loom.default-deny-ungated` with a `requires <expr>` — `requires true` where a
member is intentionally public. `with crudish(requires: <Policy>)` gates the
members the macro emits.
