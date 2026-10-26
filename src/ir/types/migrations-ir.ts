// ---------------------------------------------------------------------------
// MigrationsIR — platform-neutral schema delta.
//
// One `MigrationsIR` per generation of an owning module — every entry of
// the committed migration chain (`src/system/migration-chain.ts`).
// `baseline` is the module's schema before the generation, `next` the
// schema after it, and `steps` the ordered op list that closes the gap.  Backends only translate steps to their native syntax — they
// never re-derive the schema from the IR.
//
// The shared diff layer (`migrations-builder.ts`) guarantees Phoenix,
// TS/Drizzle and .NET/EF see the same step list for the same delta;
// cross-backend consistency falls out of having one canonical source.
// ---------------------------------------------------------------------------

export type ColumnType =
  | { kind: "uuid" }
  | { kind: "int" }
  | { kind: "bigint" }
  // Auto-incrementing 64-bit surrogate — Postgres `bigserial` (bigint + owned
  // sequence + NOT NULL + default).  Used for the per-context event log's global
  // `seq` cursor (event-log-architecture.md).  DB-assigned; never written by the
  // app, so it carries no `default` in the ColumnShape (the type IS the default).
  | { kind: "bigserial" }
  | { kind: "text" }
  | { kind: "bool" }
  // A plain `decimal` is unconstrained Postgres `DECIMAL`; `money` carries the
  // canonical `NUMERIC(19,4)` bounds (`MONEY_PRECISION`/`MONEY_WIRE_SCALE`).
  // Both are the same column FAMILY, which is why they share a kind — but the
  // bounds are load-bearing: without them the created column accepts whatever
  // scale each backend happens to write, and the stored money diverges across
  // backends.
  | { kind: "decimal"; precision?: number; scale?: number }
  | { kind: "date" }
  | { kind: "datetime" }
  | { kind: "json" }
  | { kind: "array"; inner: ColumnType };

export interface ColumnShape {
  name: string;
  type: ColumnType;
  nullable: boolean;
  default?: string;
  /** Set on the flattened leaf columns of a value-object field
   *  (`price: Money` → `price_amount`, `price_currency`, both
   *  `voGroup: "price"`).  Relational backends (Drizzle / EF) emit each
   *  leaf column as-is — the standard DDD destructure-into-columns shape.
   *  Phoenix, whose embedded value objects are stored as one `:map`,
   *  regroups columns sharing a `voGroup` back into a single `:map`
   *  column named for the group.  Absent on ordinary columns. */
  voGroup?: string;
  /** Set on the parent-table column standing in for a value-object
   *  *array* field (`charges: Money[]`).  Names the id-less child table the
   *  elements actually live in.
   *
   *  **EVERY backend skips this column, and so does the diff.**  It is a
   *  carrier for the child-table name, not a column anything creates:
   *  `renderCreateTable` (sql-pg.ts) skips it, the Ecto emitter drops it at
   *  all three of its create sites (`elixir/migrations-emit.ts`), and
   *  `diffTable` filters it off both sides of the column diff
   *  (`isDiffableColumn`).  Absent on ordinary columns.
   *
   *  Treat that as an invariant, not an incidental.  Every backend, Phoenix
   *  included, stores the elements in the child table, never inline.  Letting
   *  the column back into any DDL path makes the diff emit
   *  `ADD COLUMN … JSONB[]` + `SET NOT NULL` for it beside the correct child
   *  table, and since no ORM maps the column, every later INSERT fails the
   *  NOT NULL constraint permanently. */
  valueArrayChildTable?: string;
  /** A DSL field default (`status: string = "pending"`) rendered as a Postgres
   *  scalar literal — carried for the **add-column diff alone** (decision
   *  D-3).  It is NOT a column default and must never be
   *  read as one:
   *
   *   - no `CREATE TABLE` renderer reads it, so the initial DDL stays exactly
   *     unaffected (`renderColumnDef` / `renderEctoColumn` read `default`);
   *   - `diffTable` never compares it, so editing a `.ddd` default on a column
   *     that already exists emits nothing — there is no DB default to alter;
   *   - the one consumer is `applyDestructivePolicy`, which copies it into the
   *     `addColumn` step's `default` so Postgres backfills the existing rows,
   *     then emits `alterColumnDefault … to: undefined` in the SAME migration
   *     to drop it again.
   *
   *  The value the domain layer owns therefore never becomes a second source
   *  of truth in the schema — the column ends up identical to one a fresh
   *  `CREATE TABLE` lays down, which is the whole of D-3's middle path.
   *
   *  Restricted to what a column default can actually hold: literals and enum
   *  values (`sqlLiteralColumnDefault`).  A sibling-field ref is admissible in
   *  a *backfill* but not here — Postgres forbids a column default that
   *  references another column — and `now()` is a function call, not a literal.
   *
   *  Deliberately NOT persisted: `canonicalSnapshot` strips it, because a
   *  snapshot records the schema as it existed last time we generated and this
   *  describes the SOURCE — the column it is attached to provably has no
   *  default.  Every generation re-derives it, so nothing reads a baseline's
   *  copy.  (Contrast `savingShape` / `valueArrayChildTable`, which ARE read
   *  back from the baseline and so are written out.)  Optional ⇒
   *  `schemaVersion` stays 1, and a committed snapshot never carries it. */
  addColumnDefault?: string;
  /** The built-in capability that contributed this column (`softDeletable`'s
   *  `is_deleted`, `tenantOwned`'s `tenant_id`, `auditable`'s stamps) — the
   *  author never declared it, so when it arrives on a populated table the
   *  destructive-change gate explains what the capability needs instead of
   *  naming a column the source does not spell.  Derivation-only, exactly like
   *  `addColumnDefault`: no renderer reads it, the diff never compares it, and
   *  `canonicalSnapshot` strips it. */
  capability?: string;
  /** Set on a co-located provenance lineage column (`total_provenance`): names
   *  the `provenanced` field it backs.  Its one consumer is the add-column
   *  diff, which renders the add as `ADD COLUMN IF NOT EXISTS` (see that
   *  step's `ifNotExists`).  Derivation-only like `capability`: no renderer
   *  reads it, the diff never compares it, and `canonicalSnapshot` strips it. */
  lineageOf?: string;
}

export interface FKShape {
  column: string;
  refTable: string;
  onDelete: "cascade" | "restrict";
}

export interface IndexShape {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  /** Partial-index predicate — the raw Postgres boolean expression that
   *  follows `WHERE` (`is_deleted = false`).  Set on a `unique (...)` index
   *  derived for a `softDeletable` aggregate so re-creating a row whose
   *  predecessor was soft-deleted is allowed (uniqueness-and-indexes.md §7).
   *  Absent on ordinary FK / performance indexes — they are unconditional.
   *  The SQL renderer (`sql-pg.ts`) appends `WHERE <predicate>`; the Ecto
   *  emitter passes it as the `where:` index option. */
  predicate?: string;
  /** Per-column Postgres operator classes (tenancy.md).  Keyed
   *  by column name → opclass, e.g. `{ data_key: "text_pattern_ops" }` so a
   *  `LIKE 'prefix.%'` materialized-path prefix scan uses the index under ANY
   *  locale/collation (the default opclass only indexes prefix `LIKE` under the
   *  C collation).  The SQL renderer appends the opclass after the column
   *  (`(data_key text_pattern_ops)`); the Ecto emitter emits the fragment
   *  column form (`["data_key text_pattern_ops"]`).  Absent on ordinary indexes
   *  — they use the default opclass. */
  opclasses?: Record<string, string>;
}

/** What a {@link CheckShape} enforces.  The kind decides which backends carry
 *  it, so it is a field rather than a naming convention.
 *
 *  `voNullConsistent` — the all-null-or-all-present invariant of a flattened
 *  OPTIONAL value object (`shipTo: Address?` → `ship_to_line1`, `ship_to_city`,
 *  … all nullable and all mutually independent).  Every backend that flattens
 *  reads the group atomically — java's record compact constructor runs the VO's
 *  invariant, node asserts each leaf non-null, python passes each leaf straight
 *  into the VO — so a PARTIALLY null row is a load-time crash on java and a
 *  silently malformed VO elsewhere.  Nothing else in the schema forbids one: N
 *  independent nullable columns is exactly what a hand-written UPDATE, a bad
 *  backfill or a future partial-update path can leave half-written.  See
 *  `valueObjectChecks` in `migrations-builder.ts` for which columns join a
 *  group and which are deliberately excluded.  **Phoenix/Ecto skips this
 *  kind**: it stores a value object as ONE `:map` column (see `voGroup`), so
 *  the leaf columns the constraint names do not exist there and the invariant
 *  cannot be violated.
 *
 *  `enumValues` — the legal value set of an `enum`-typed column.  An enum
 *  persists as `TEXT` on every backend, so its value set was invisible to the
 *  schema and therefore to the DIFF: narrowing one (`skill: string` →
 *  `skill: Skill`, or deleting a member from `enum Skill`) changed no column
 *  and produced NO migration, no constraint and no warning, while the
 *  generated OpenAPI and the generated zod client both started refusing the
 *  values still sitting in the table.  The check makes the value set part of
 *  the schema, so the ordinary check diff turns any change to it into a real
 *  migration step.  **Every backend carries this kind, Phoenix included** —
 *  it names one real column that exists on all five. */
export type CheckKind = "voNullConsistent" | "enumValues";

/** A table-level `CHECK` constraint.  See {@link CheckKind} for what is
 *  emitted and which backends carry each kind. */
export interface CheckShape {
  /** Constraint name — deterministic, derived from the table + the value-object
   *  group (`orders_ship_to_null_consistent`) or the table + column
   *  (`appts_skill_enum`), so the diff can match a check across generations by
   *  name the way it matches an index. */
  name: string;
  table: string;
  /** Raw Postgres boolean expression that follows `CHECK` — the same "SQL text
   *  in the platform-neutral IR" convention `IndexShape.predicate` and
   *  `backfillColumn.valueSql` already use. */
  expression: string;
  /** Optional ⇒ a baseline snapshot written before this field existed reads
   *  back as `voNullConsistent`, which is what every check in such a snapshot
   *  actually is.  Consumers must treat an absent `kind` as that value rather
   *  than as "unknown", or Phoenix would start emitting the VO checks it has
   *  always (correctly) skipped. */
  kind?: CheckKind;
}

export interface TableShape {
  name: string;
  /** Postgres schema the table lives in — the owning bounded context's
   *  schema (`snake(context.name)` by default, or the dataSource's
   *  explicit `schema:` override).  `undefined` means the unqualified
   *  `public` schema (single-context legacy systems, or callers that
   *  build a schema without a system to resolve bindings against).
   *  The SQL renderer emits `CREATE SCHEMA IF NOT EXISTS` + qualifies
   *  table / FK / index references; the EF + Drizzle table mappings
   *  resolve the same schema, so the runtime DDL matches what they query. */
  schema?: string;
  ownerModule: string;
  columns: ColumnShape[];
  primaryKey: string[];
  foreignKeys: FKShape[];
  indexes: IndexShape[];
  /** Set on the id-less child table that holds a value-object *array*
   *  field's elements (`charges: Money[]` → `order_charges`).  Relational
   *  backends (Drizzle / EF) create it; Phoenix **skips** it — it stores
   *  the array inline as a `{:array, :map}` column on the parent instead. */
  valueCollection?: boolean;
  /** Table-level `CHECK` constraints — see {@link CheckShape}.  Optional ⇒
   *  `schemaVersion` stays 1, and a baseline snapshot that predates the field
   *  reads as "no checks", so the diff adds them as a normal non-destructive
   *  step on the next regen. */
  checks?: CheckShape[];
  /** Reshape-detection stamp: the effective saving shape of the
   *  aggregate whose ROOT table this is (`relational` / `embedded` /
   *  `document`).  Stamped on the aggregate root only (not parts / joins /
   *  saga / event-log / outbox).  The diff compares a matched pair's
   *  `savingShape`; a flip (relational → document) is a *reshape* — a
   *  full-table data move the column-churn diff can't express — so it raises
   *  `loom.migration-shape-change` instead of the generic destructive listing.
   *  Optional ⇒ `schemaVersion` stays 1; an UNstamped baseline (an older
   *  snapshot) simply isn't compared, so the flip falls to the generic
   *  destructive gate (backward-compatible grace). */
  savingShape?: SavingShape;
  /** Reshape-detection stamp: the inheritance strategy + root base
   *  of an inheritance table — `sharedTable` on a TPH shared base table,
   *  `ownTable` on each TPC concrete's own table.  Keyed by the root base
   *  name so a TPH↔TPC flip (whose table NAMES change, so no matched pair
   *  exists) is detected by grouping this generation's created + dropped
   *  inheritance tables per base and comparing strategies.  Same optional /
   *  grace semantics as {@link savingShape}. */
  inheritance?: InheritanceStamp;
}

/** Persistence saving shape — mirrors the IR's `SavingShape`, redeclared here
 *  so `migrations-ir.ts` stays free of an `ir/types/loom-ir.ts` import (the
 *  MigrationsIR layer is consumed by the backends, which must not pull the full
 *  IR vocabulary). */
export type SavingShape = "relational" | "embedded" | "document";

export interface InheritanceStamp {
  strategy: "sharedTable" | "ownTable";
  /** Root-base aggregate name — the grouping key that pairs a TPH shared table
   *  with the TPC concrete tables of the SAME hierarchy across a flip. */
  base: string;
}

export interface SchemaSnapshot {
  schemaVersion: 1;
  /** Applied-data-migration ledger.  Keys `"<block>#<index>"` for
   *  every raw `sql` migration-block step already emitted against this
   *  baseline.  Raw SQL has no structural condition to guard on (unlike
   *  renames/backfills, which are naturally inert once baked in), so the
   *  snapshot records which ones ran — a `sql` step is emitted exactly
   *  once.  Absent / empty when no raw steps have been emitted.  Optional
   *  ⇒ `schemaVersion` stays 1; old snapshots read fine. */
  appliedDataMigrations?: string[];
  tables: TableShape[];
}

// Every delta step carries the Postgres `schema` of the relation it targets
// (the owning bounded context's schema, from the same resolution `createTable`
// uses).  `undefined` means the unqualified `public` schema.  Without this,
// an ALTER/DROP on a schema-qualified system targets the wrong relation or
// fails (audit finding 17).  `createTable` still carries its schema on the
// nested `TableShape`, so it needs no separate field.
export type MigrationStep =
  | { op: "createTable"; table: TableShape }
  | { op: "dropTable"; name: string; schema?: string }
  // Whole-table rename (aggregate/table rename) — `from`/`to` are the
  // bare (unqualified) old + new table names; `schema` is the relation's
  // Postgres schema (both ends share it — a rename never crosses schemas).
  // Postgres/Ecto keep every FK constraint pointing at the table valid across
  // the rename, so no separate FK-retarget step is emitted.  Non-destructive.
  | {
      op: "renameTable";
      from: string;
      to: string;
      /** The schema the table is in AFTER the step. */
      schema?: string;
      /** Set on a cross-context move only: the schema the table is in
       *  BEFORE the step (`null` = the default search-path schema).  The
       *  renderers move it (`ALTER TABLE … SET SCHEMA`) before any rename. */
      fromSchema?: string | null;
    }
  | {
      op: "addColumn";
      table: string;
      schema?: string;
      column: ColumnShape;
      fk?: FKShape;
      /** Render `ADD COLUMN IF NOT EXISTS`.  Set only for a provenance lineage
       *  column (`ColumnShape.lineageOf`).  Every backend once added those
       *  columns in a hand-emitted late migration outside the chain, so a
       *  database deployed then already holds them, and the generation that
       *  first records them has to apply there as well.  No other step sets
       *  it: for any other column, one that already exists is a derive bug,
       *  and tolerating it would hide exactly the drift the migrate-vs-create
       *  equivalence check exists to catch. */
      ifNotExists?: boolean;
    }
  | { op: "dropColumn"; table: string; schema?: string; name: string }
  | {
      op: "renameColumn";
      table: string;
      schema?: string;
      from: string;
      to: string;
      type: ColumnType;
    }
  | {
      op: "alterColumnNullable";
      table: string;
      schema?: string;
      name: string;
      type: ColumnType;
      nullable: boolean;
    }
  | {
      op: "alterColumnType";
      table: string;
      schema?: string;
      name: string;
      from: ColumnType;
      to: ColumnType;
    }
  // A column's DEFAULT changed (added, removed, or its literal edited) with
  // the column's type/nullability unchanged — without this step a `.ddd`
  // default edit emits no migration and the database silently keeps the old
  // default. `from`/`to` are pre-rendered
  // Postgres scalar literals (the `ColumnShape.default` convention —
  // `"gen_random_uuid()"`, `"0"`, …); `undefined` means no default (an add
  // drops it, a remove sets it). Non-destructive: existing rows keep their
  // stored value — only the DEFAULT future inserts pick up changes.
  | {
      op: "alterColumnDefault";
      table: string;
      schema?: string;
      name: string;
      from: string | undefined;
      to: string | undefined;
    }
  // Create an index.  `concurrently` is set by the diff on an index added to a
  // table that already exists in the baseline (a table created in the same
  // generation carries its indexes inline on `createTable`).  A plain
  // `CREATE INDEX` holds a SHARE lock that blocks every write to the table for
  // the whole build; the concurrent form does not, but Postgres refuses to run
  // it inside a transaction.  So every backend applies a generation's
  // concurrent steps as a separate, non-transactional migration unit ordered
  // right after the generation's transactional one
  // (`src/ir/util/migration-steps.ts`).  Absent on a step recorded before the
  // flag existed: that step stays a plain `CREATE INDEX` inside its
  // generation's file, so a migration a database already applied renders
  // byte-identically.
  | { op: "addIndex"; index: IndexShape; schema?: string; concurrently?: boolean }
  | { op: "dropIndex"; table: string; schema?: string; name: string }
  // Rename an index in place — `from`/`to` are the bare (unqualified)
  // old + new index names; `schema` is the owning table's Postgres schema (an
  // index lives in its table's schema).  Emitted by `diffSchema` when a table or
  // column rename changes only the DERIVED index name (the index is otherwise
  // identical after mapping columns/table through this generation's renames), so
  // the non-destructive rebuild collapses to a single `ALTER INDEX … RENAME TO`
  // instead of a drop+create.  Postgres has native support; Ecto has no `rename
  // index` DSL, so it wraps the same SQL in `execute/1` (forward-only, matching
  // D-MIG-NO-DOWN).
  | { op: "renameIndex"; from: string; to: string; schema?: string }
  // A pass-through comment line (`-- …` in SQL, `# …` in Ecto).  Emitted by the
  // destructive-change gate's NOT-NULL-add rewrite to mark the backfill the
  // operator must perform between adding a nullable column and setting it NOT
  // NULL.  Renders to a no-op comment on every backend.
  | { op: "sqlComment"; comment: string }
  // Data backfill: `UPDATE <table> SET <column> = <valueSql>`
  // [`WHERE <column> IS NULL` when `onlyNull`].  `valueSql` is a pre-rendered
  // Postgres scalar expression (the `IndexShape.predicate` precedent — SQL
  // text in the platform-neutral IR), produced by `renderSqlScalarExpr` from
  // a validated `migration`-block backfill step.  `onlyNull: true` (the
  // NOT-NULL-sequence default) makes re-application against a half-migrated
  // table safe.  Renders as raw SQL on every backend (Ecto: `execute/1`).
  | {
      op: "backfillColumn";
      table: string;
      schema?: string;
      column: string;
      valueSql: string;
      onlyNull: boolean;
    }
  // Add a table-level CHECK constraint (see `CheckShape`).  Rendered
  // `NOT VALID` by the SQL renderer: an ALTER only ever targets a table that
  // already exists, and the constraint's whole point is that rows violating it
  // are POSSIBLE — so validating retroactively would fail the migration on the
  // exact database that most needs the guard.  `NOT VALID` enforces every
  // future INSERT/UPDATE immediately and leaves already-stored rows alone; an
  // operator who wants the back-check runs `VALIDATE CONSTRAINT` themselves
  // (the emitted `sqlComment` says so).  A `createTable` carries its checks
  // inline instead, where there is nothing to validate.
  | { op: "addCheck"; check: CheckShape; schema?: string }
  // Drop a table-level CHECK constraint.  Non-destructive (it only loosens),
  // so it is never gated.  `kind` is the dropped constraint's {@link CheckKind},
  // copied off the BASELINE shape — the emitters skip exactly the kinds they
  // skip on the add side, and a drop has no `CheckShape` to read it from.
  // Optional ⇒ a step replayed from a pre-`kind` baseline reads as
  // `voNullConsistent`, which is what every check in such a baseline is.
  | { op: "dropCheck"; table: string; schema?: string; name: string; kind?: CheckKind }
  // Raw one-shot DML: a `sql "…"` step from a `migration` block,
  // emitted verbatim.  NOT naturally inert — the builder records the step's
  // `<block>#<index>` key in the snapshot's `appliedDataMigrations` so it is
  // emitted exactly once.  Ordered after the generation's structural steps.
  | { op: "sqlExec"; sql: string };

export interface MigrationsIR {
  /** Owning module name.  The system orchestrator distributes each
   *  MigrationsIR to every needsDb deployable that includes the module
   *  (per-deployable compose databases ⇒ each owns its own migration files). */
  module: string;
  /** Optional storage binding name (`pg`, `analyticsDb`).  Empty string when
   *  the deployable used the bare `contexts: [Sales]` form. */
  storageName: string;
  /** The module's schema before this generation; `null` for its initial one. */
  baseline: SchemaSnapshot | null;
  /** The module's schema after this generation. */
  next: SchemaSnapshot;
  /** Ordered ops from baseline → next.  An emitter skips a generation with
   *  no steps. */
  steps: MigrationStep[];
  /** The generation's version in the migration chain — a decimal integer,
   *  strictly increasing along the chain and unique across every module, so
   *  it orders migration files in a directory several modules share.  See
   *  `src/system/migration-chain.ts`. */
  version: string;
  /** Migration name (PascalCase) — `"Initial"` for a module's first
   *  generation, otherwise the name given to `ddd migrate add`. */
  name: string;
}
