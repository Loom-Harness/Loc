import type {
  ColumnShape,
  ColumnType,
  IndexShape,
  MigrationStep,
  MigrationsIR,
  TableShape,
} from "../../ir/types/migrations-ir.js";
import { snake, upperFirst } from "../../util/naming.js";
import { collapseVoGroups, collapseVoSteps } from "../_persistence/vo-json-columns.js";
import {
  renderAlterColumnDefaultSql,
  renderAlterColumnTypeSql,
  renderBackfillSql,
  renderRenameIndexSql,
  renderSetSchemaSql,
} from "../sql-pg.js";

// ---------------------------------------------------------------------------
// Phoenix Ecto migration emitter.
//
// Consumes the platform-neutral `MigrationsIR[]` from
// `src/system/migrations-builder.ts` and translates each `MigrationStep` into
// Ecto migration DSL.
//
// File layout:
//   - Initial migration (baseline === null): one .exs file per top-level
//     table + one per part-table, sequentially timestamped from BASE so
//     parent migrations precede their parts in Ecto's apply order.
//     Filename: `priv/repo/migrations/<ts>_create_<table>.exs`.
//   - Subsequent migrations: one .exs file containing every step, named
//     `<MigrationsIR.version>_<snake(MigrationsIR.name)>.exs`.
//
// Stays in Ecto DSL (not raw SQL) for DDL so `ecto.migrate` keeps working
// unchanged; the shared `src/generator/sql-pg.ts` helper renders DDL for the
// TS/.NET/Python/Java backends only.  The M-T2.3 DATA steps
// (`backfillColumn` / `sqlExec`) are the deliberate exception: they wrap raw
// SQL in `execute/1` (the `CREATE SCHEMA` precedent), sharing
// `renderBackfillSql` so the DML is bit-identical cross-backend.
// ---------------------------------------------------------------------------

const BASE_TIMESTAMP = 20260101000000;

/** Render a MigrationsIR column `default` into an Ecto `, default: …` clause.
 *  The shared `MigrationsIR` stores SQL defaults verbatim (e.g. `now()`,
 *  `gen_random_uuid()`) — valid bare in raw Postgres DDL (`sql-pg.ts`) but NOT
 *  in Ecto migration DSL, where a SQL function call must be wrapped in
 *  `fragment("…")` (a bare `default: now()` is an undefined-function compile
 *  error).  A plain literal (number/boolean, e.g. `0`) stays bare. */
function ectoDefaultClause(def: string | undefined): string {
  if (def === undefined) return "";
  const d = def.trim();
  // A SQL function-call default (`now()`, `gen_random_uuid()`) → fragment.
  const isSqlExpr = /^[a-z_][a-z0-9_]*\s*\(.*\)$/i.test(d);
  // A SQL *string* literal (`'pending'`) → fragment too.  Single quotes mean
  // something else entirely in Elixir: a bare `default: 'pending'` is a
  // CHARLIST, not a string, so Ecto would emit a Postgres integer array
  // (`{112,101,110,...}`) into the DDL.  Passing the SQL text straight through
  // `fragment/1` also keeps the doubled-quote escaping (`'it''s'`) that
  // `sqlStr` produced byte-for-byte, so the DEFAULT Phoenix writes is the one
  // the four SQL backends write (M-T2.16 / #2864 G1).
  const isSqlString = /^'(?:[^']|'')*'$/.test(d);
  return isSqlExpr || isSqlString
    ? `, default: fragment(${JSON.stringify(def)})`
    : `, default: ${def}`;
}

/** Ecto option string for a table / index / reference that lives in a
 *  non-default Postgres schema — the owning bounded context's schema,
 *  carried on `TableShape.schema` (the Ecto schema maps `table "x"` in
 *  `schema "catalog"`, so the migration must create `catalog.x` or the
 *  schema queries a relation that doesn't exist).  Empty for the
 *  default (`public`) schema, preserving the unqualified output. */
function prefixOpt(schema: string | undefined): string {
  return schema ? `, prefix: ${JSON.stringify(schema)}` : "";
}

/** Trailing Ecto `create index(...)` options for one `IndexShape`.
 *  `, unique: true` for a unique index; `, where: "…"` for a partial index
 *  (a `unique` key on a softDeletable aggregate — re-create after soft-delete
 *  is allowed); an explicit `, name: "…"` for unique indexes so the
 *  changeset's `unique_constraint` and the cross-backend 23505 → 409 mapping
 *  reference the same deterministic constraint name.  FK / performance indexes
 *  keep Ecto's default name (never referenced), so output is unchanged. */
function ectoIndexOpts(i: IndexShape, prefix: string): string {
  const unique = i.unique ? ", unique: true" : "";
  const where = i.predicate ? `, where: ${JSON.stringify(i.predicate)}` : "";
  const name = i.unique ? `, name: ${JSON.stringify(i.name)}` : "";
  return `${unique}${where}${name}${prefix}`;
}

/** The indexes this backend can actually create on `table`.
 *
 *  `collapseVoGroups` stores a value object as ONE `:map` column, so its
 *  flattened leaf columns (`berth_ship`, `berth_position`) never reach the
 *  emitted `create table`.  The canonical `MigrationsIR` indexes those leaves —
 *  correctly, for the relational backends — and an index naming a column this
 *  table does not have is a migration that FAILS TO APPLY
 *  (`column "berth_ship" does not exist`), not merely a useless one.
 *
 *  A value object holding a reference (`valueobject Berth { ship: Ship id }`)
 *  is what makes the IR mint such an index at all, which is why the corpus
 *  never tripped it until `vo-id-reference` landed: the elixir compile tier
 *  COMPILES migrations, it does not apply them, so this stayed green.
 *
 *  This is the exact reasoning `enumCheckLines` already applies to the
 *  `voNullConsistent` constraints — the same collapse, the same dropped leaf
 *  columns — extended to the index list it was never applied to. */
function ectoIndexes(table: TableShape): readonly IndexShape[] {
  const collapsed = new Set(table.columns.filter((c) => c.voGroup).map((c) => c.name));
  if (collapsed.size === 0) return table.indexes;
  return table.indexes.filter((i) => !i.columns.some((n) => collapsed.has(n)));
}

/** The bracketed column list for a `create index(...)` call.  A column with a
 *  per-column opclass (materialized-path prefix index) uses Ecto's raw
 *  fragment string form (`"data_key text_pattern_ops"`) so the opclass reaches
 *  the DDL; plain columns stay `:atom`s. */
function ectoIndexColumns(i: IndexShape): string {
  return i.columns
    .map((n) => {
      const oc = i.opclasses?.[n];
      return oc ? JSON.stringify(`${n} ${oc}`) : `:${n}`;
    })
    .join(", ");
}

/** The `execute "CREATE SCHEMA …"` line that precedes a create-table when
 *  the table is schema-qualified; none for the default schema.  Idempotent
 *  (`IF NOT EXISTS`) since several per-aggregate migrations can share one
 *  schema.  Forward-only — matching the no-op down of every other backend. */
function schemaCreateLines(schema: string | undefined): string[] {
  return schema ? [`execute "CREATE SCHEMA IF NOT EXISTS ${schema}"`] : [];
}

/** The `timestamps()` line a state-table migration appends — column-aware
 *  so it matches the emitted schema (otherwise `ecto.migrate` fails with
 *  "column updated_at specified more than once").  An audit capability
 *  (`with audit` / `auditable`) declares explicit `created_at` /
 *  `updated_at` columns; the bundled `timestamps()` would add a SECOND
 *  `updated_at`.  The Ecto schema drops `timestamps()` entirely when an
 *  `updated_at` field is present (`vanilla/schema-emit.ts`), so the
 *  migration must too — the audit columns are the only timestamps.  With
 *  no `updated_at` column present the migration emits a plain
 *  `timestamps()`, so non-audit output is unchanged. */
function timestampsMacro(table: TableShape): string | null {
  // The transactional outbox (dispatch-delivery-semantics.md) is a fixed
  // machinery shape shared by every backend: its time columns are the
  // explicit `occurred_at`/`dispatched_at`, and the relay writers never
  // populate Ecto timestamps — a bundled NOT NULL `inserted_at` would
  // reject every insert.
  if (table.name === "__loom_outbox") return null;
  // Same rule for the audit history: `audit_records` is fixed machinery whose
  // only time column is the explicit `at`.  The audit writer builds the row
  // struct by hand and never populates Ecto timestamps, so a bundled NOT NULL
  // `inserted_at` would reject every audited command — and because the insert
  // rides the action's transaction, it would roll back the state change too.
  if (table.name === "audit_records") return null;
  // And for the provenance history: `provenance_records` is fixed machinery
  // whose only time column is the explicit `at`.  The flush builds each row as
  // a plain map and calls `Repo.insert_all/2` (which bypasses autogenerate), so
  // a bundled NOT NULL `inserted_at` would reject every provenanced write — and
  // because the flush rides the save transaction, it would roll the aggregate
  // write back with it.
  if (table.name === "provenance_records") return null;
  // A declared `inserted_at` / `insertedAt` field owns the other bundled
  // column the same way (`ownsEctoTimestampColumn` in `vanilla/schema-emit.ts`
  // drops the schema's `timestamps()` in lockstep) — a second `inserted_at`
  // would fail `ecto.migrate` with "column specified more than once".
  const ownsTimestamp = table.columns.some(
    (c) => c.name === "updated_at" || c.name === "inserted_at",
  );
  return ownsTimestamp ? null : "timestamps()";
}

export function emitMigrations(
  _appName: string,
  migrations: MigrationsIR[],
  appModule: string,
  out: Map<string, string>,
): void {
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    // Both paths take their version straight from the migration chain, which
    // numbers every generation uniquely and reserves `INITIAL_RESERVATION`
    // versions after an initial for the per-table files below
    // (`src/system/migration-chain.ts`).  The emitter must NOT apply an offset
    // of its own: one derived from the module's position in this array would
    // give two modules' generations the same version (Ecto aborts on the
    // duplicate) or sort a delta before its own create-table.
    if (m.baseline === null) {
      emitInitial(m, appModule, out, Number(m.version) - BASE_TIMESTAMP);
    } else {
      emitDelta(m, appModule, out);
    }
  }
}

/** Topologically order the top-level (non-part, non-join) tables so a table
 *  referenced by another's FK is created FIRST.  The shared `MigrationsIR`
 *  already emits `createTable` steps in FK-topological order, but this emitter
 *  splits them into parent/part/join tiers and re-derives sequential timestamps
 *  per tier — a plain alphabetical sort here reversed a cross-aggregate reference
 *  (`Gadget { widgetId: Widget id }` sorts `gadgets` before `widgets`), so
 *  `ecto.migrate` hit `relation "<schema>.widgets" does not exist` when
 *  `create_gadgets`' inline `references(:widgets)` ran first (B10).  A parent whose
 *  FK targets another PARENT (a cross-aggregate `X id` reference, `on_delete:
 *  :restrict`) is emitted after its target; independent tables keep alphabetical
 *  order for stable, deterministic timestamps.  Best-effort on a cycle (falls back
 *  to alphabetical) — mirrors `orderTablesByFkDependency` in `migrations-builder`. */
function orderParentTablesByFk(tables: TableShape[]): TableShape[] {
  const names = new Set(tables.map((t) => t.name));
  const remaining = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const emitted = new Set<string>();
  const order: TableShape[] = [];
  while (remaining.length > 0) {
    let idx = remaining.findIndex((t) =>
      t.foreignKeys.every(
        (fk) => fk.refTable === t.name || !names.has(fk.refTable) || emitted.has(fk.refTable),
      ),
    );
    if (idx === -1) idx = 0; // cycle — best effort, keep alphabetical head
    const [t] = remaining.splice(idx, 1);
    order.push(t!);
    emitted.add(t!.name);
  }
  return order;
}

/** Order part tables (containment children + value-collection children) so each
 *  is created AFTER the table its cascade FK references — a parent aggregate
 *  (pre-emitted, in `parentNames`) or a SIBLING PART (a part-in-part grandchild
 *  like `tags` FKs `lines`).  Same FK-topological algorithm as
 *  `orderParentTablesByFk`, but `emitted` is pre-seeded with the already-created
 *  aggregate tables, and only cascade FKs onto OTHER PART tables constrain the
 *  order (a non-cascade cross-aggregate FK targets a parent, already emitted). */
function orderPartTablesByFkTopo(partTables: TableShape[], parentNames: Set<string>): TableShape[] {
  const partNames = new Set(partTables.map((t) => t.name));
  const remaining = [...partTables].sort((a, b) => a.name.localeCompare(b.name));
  const emitted = new Set<string>(parentNames);
  const order: TableShape[] = [];
  while (remaining.length > 0) {
    let idx = remaining.findIndex((t) =>
      t.foreignKeys.every(
        (fk) => fk.refTable === t.name || !partNames.has(fk.refTable) || emitted.has(fk.refTable),
      ),
    );
    if (idx === -1) idx = 0; // cycle — best effort, keep alphabetical head
    const [t] = remaining.splice(idx, 1);
    order.push(t!);
    emitted.add(t!.name);
  }
  return order;
}

function emitInitial(
  m: MigrationsIR,
  appModule: string,
  out: Map<string, string>,
  /** The generation's version, as an offset from `BASE_TIMESTAMP`; every
   *  per-table file is numbered from it, inside the `INITIAL_RESERVATION`
   *  the migration chain leaves after an initial. */
  baseOffset = 0,
): void {
  // A module's first generation can also take over tables another module's
  // chain created — a migration-block move (`A.Note -> B.Note`) into a new
  // module.  Those steps (the move, and whatever the diff then derives for
  // the moved tables) are neither a create nor a data step, so they get a
  // file of their own at the generation's own version, AHEAD of the
  // per-table creates: a new table may reference a moved one.
  const takeover = m.steps.filter((s) => s.op !== "createTable" && s.op !== "sqlExec");
  const takeoverBase = BASE_TIMESTAMP + baseOffset;
  if (takeover.length > 0) {
    const lines = takeover.flatMap((s) => renderEctoStep(s)).map((l) => `    ${l}`);
    const name = `${upperFirst(m.module)}TakeOverTables`;
    out.set(
      `priv/repo/migrations/${takeoverBase}_${snake(m.module)}_take_over_tables.exs`,
      [
        `defmodule ${appModule}.Repo.Migrations.${name} do`,
        `  use Ecto.Migration`,
        ``,
        `  def change do`,
        ...lines,
        `  end`,
        `end`,
        ``,
      ].join("\n"),
    );
  }
  const base = takeoverBase + (takeover.length > 0 ? 1 : 0);
  // Three classes of table, separated so timestamps preserve the
  // create-order required by FK targets:
  //   - aggregate (no cascade FK) → BASE + i
  //   - part      (one cascade FK to a parent aggregate)
  //     → BASE + N*10 + parentIndex*10 + partIndex+1
  //   - join      (two cascade FKs — Id<T>[] many-to-many)
  //     → BASE + N*100 + joinIdx
  // Includes an intentional gap between parent and part blocks so
  // inserts/updates to either tier don't shift the other's numbering.
  const createSteps = m.steps.filter(
    (s): s is Extract<MigrationStep, { op: "createTable" }> => s.op === "createTable",
  );
  // Value-object array child tables (`charges: Money[]`) are now emitted as
  // real id-less relational child tables on Phoenix too,
  // not collapsed into an inline `{:array, :map}` column on the parent.  They
  // are FK-cascaded children of their owner aggregate — the same tier as a
  // containment part table — so they share the part block's create-ordering
  // (parent before child).  See `valueCollectionColumnLines`.
  const allTables = createSteps.map((s) => s.table);
  const joinTables = allTables.filter(isJoinTable);
  const partTables = allTables.filter(
    (t) => !joinTables.includes(t) && (isPartTable(t) || t.valueCollection),
  );
  const parentTables = orderParentTablesByFk(
    allTables.filter((t) => !joinTables.includes(t) && !partTables.includes(t)),
  );

  // Parents — base + i.
  for (let i = 0; i < parentTables.length; i++) {
    writeInitialFile(parentTables[i]!, base + i, appModule, out);
  }
  // Parts (incl. value-collection children) — grouped by parent AGGREGATE,
  // byte-identical to before: parent i's parts get `base + N*10 + i*10 + (j+1)`.
  const parentCount = parentTables.length;
  const parentNames = new Set(parentTables.map((t) => t.name));
  const tier0 = new Set<string>();
  for (let i = 0; i < parentTables.length; i++) {
    const parent = parentTables[i]!;
    const partsOfThis = partTables
      .filter((t) =>
        t.foreignKeys.some((fk) => fk.refTable === parent.name && fk.onDelete === "cascade"),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    for (let j = 0; j < partsOfThis.length; j++) {
      writeInitialFile(partsOfThis[j]!, base + parentCount * 10 + i * 10 + (j + 1), appModule, out);
      tier0.add(partsOfThis[j]!.name);
    }
  }
  // Part-in-part GRANDCHILDREN — a part whose cascade FK targets a SIBLING PART
  // (`tags` FKs `lines`), not a parent aggregate, so the parent-grouped loop
  // above never emits it (the elixir-specific reason relational part-in-part was
  // gated).  Emit them AFTER the whole tier-0 block (so every FK target is
  // already created) in FK-topological order (a deeper grandchild after its
  // parent part).  Existing single-level output is untouched — this block is
  // empty unless a part contains a part.
  const grandchildren = partTables.filter((t) => !tier0.has(t.name));
  if (grandchildren.length > 0) {
    const ordered = orderPartTablesByFkTopo(grandchildren, new Set([...parentNames, ...tier0]));
    for (let m = 0; m < ordered.length; m++) {
      writeInitialFile(ordered[m]!, base + parentCount * 20 + m, appModule, out);
    }
  }
  // Join tables — placed above the part block so the references on
  // both endpoints resolve.  Sorted by name for stable allocation.
  const sortedJoins = [...joinTables].sort((a, b) => a.name.localeCompare(b.name));
  for (let k = 0; k < sortedJoins.length; k++) {
    const ts = base + parentCount * 100 + k;
    writeInitialFile(sortedJoins[k]!, ts, appModule, out);
  }
  // Data steps (M-T2.3): an initial generation can still carry `sqlExec`
  // steps (a raw `sql "…"` block in a fresh system — the other backends run
  // it inside their single Initial file).  The per-table layout above has no
  // home for them, so they land in ONE trailing data file, offset far above
  // every table tier (and below INITIAL_RESERVATION, so modules stay
  // disjoint).  Dropping them instead would silently diverge from the
  // snapshot's appliedDataMigrations ledger, which already recorded them.
  const dataSteps = m.steps.filter(
    (s): s is Extract<MigrationStep, { op: "sqlExec" }> => s.op === "sqlExec",
  );
  if (dataSteps.length > 0) {
    const ts = base + INITIAL_DATA_OFFSET;
    const lines = dataSteps.flatMap((s) => renderEctoStep(s)).map((l) => `    ${l}`);
    // Module-qualified name + filename: Ecto requires migration module names
    // to be unique across the shared dir, and every module with data steps
    // lands one of these files.
    const body = [
      `defmodule ${appModule}.Repo.Migrations.DataMigrations${tableToPascal(snake(m.module))} do`,
      `  use Ecto.Migration`,
      ``,
      `  def change do`,
      ...lines,
      `  end`,
      `end`,
      ``,
    ].join("\n");
    out.set(`priv/repo/migrations/${ts}_data_migrations_${snake(m.module)}.exs`, body);
  }
}

/** Within-module version offset for the initial data-migrations file — far
 *  above the table tiers (parents `+i`, parts `+N*10+…`, joins `+N*100+k`)
 *  and safely below `INITIAL_RESERVATION`. */
const INITIAL_DATA_OFFSET = 900_000;

function writeInitialFile(
  table: TableShape,
  ts: number,
  appModule: string,
  out: Map<string, string>,
): void {
  const path = `priv/repo/migrations/${ts}_create_${table.name}.exs`;
  const migrationName = `Create${tableToPascal(table.name)}`;
  const body = createTableLines(table).map((l) => `    ${l}`);
  out.set(
    path,
    `defmodule ${appModule}.Repo.Migrations.${migrationName} do
  use Ecto.Migration

  def change do
${body.join("\n")}
  end
end
`,
  );
}

/** The `change/0` body (unindented) that creates `table` — the ONE rendering
 *  both the initial per-table file and a delta's `createTable` step use.  A
 *  table's shape does not depend on the generation it first appears in: a
 *  value-object collection or `X id[]` join table added later must match its
 *  Ecto schema exactly as a fresh create does (`@primary_key :id` on the
 *  collection child, a key-only composite PK on the join), or the first
 *  `put_assoc` / preload against it fails at runtime. */
function createTableLines(table: TableShape): string[] {
  const prefix = prefixOpt(table.schema);
  const columns = table.valueCollection
    ? valueCollectionColumnLines(table)
    : isJoinTable(table)
      ? joinColumnLines(table)
      : isEventLogTable(table)
        ? eventLogColumnLines(table)
        : isStateTable(table)
          ? stateColumnLines(table)
          : entityColumnLines(table);
  return [
    ...schemaCreateLines(table.schema),
    `create table(:${table.name}, primary_key: false${prefix}) do`,
    ...columns.map((l) => `  ${l}`),
    "end",
    ...ectoIndexes(table).map(
      (i) => `create index(:${i.table}, [${ectoIndexColumns(i)}]${ectoIndexOpts(i, prefix)})`,
    ),
    ...enumCheckLines(table, prefix),
  ];
}

/** The single per-context append-only event log (`<ctx>_events`,
 *  event-log-architecture.md).  It has no `id` (so it would otherwise fall to
 *  `stateColumnLines`), but unlike a saga-state table it carries a
 *  `bigserial` `seq` cursor, a composite `(stream_type, stream_id, version)`
 *  PK, a unique index on `seq`, and NO `timestamps()` (its time column is
 *  `occurred_at`).  Detected by the `seq` bigserial column, unique to this
 *  table. */
function isEventLogTable(t: TableShape): boolean {
  return t.columns.some((c) => c.name === "seq" && c.type.kind === "bigserial");
}

/** The event log's columns: composite PK columns marked `primary_key: true`,
 *  the remaining columns (incl. the `bigserial` `seq`) as plain adds.  No
 *  `timestamps()` — the log's time column is the explicit `occurred_at`. */
function eventLogColumnLines(table: TableShape): string[] {
  const pk = new Set(table.primaryKey);
  return table.columns.map((c) =>
    pk.has(c.name)
      ? `add :${c.name}, ${ectoPrimaryKeyType(c.type)}, primary_key: true, null: false`
      : renderEctoColumn(c, table),
  );
}

/** A persisted workflow-correlation (saga) state table: keyed by the
 *  workflow's correlation field rather than a synthetic `id`, with no
 *  foreign keys (the routing row is standalone).  The entity tables' `id` PK
 *  doesn't fit, so these render with the correlation column(s) marked
 *  `primary_key: true`. */
function isStateTable(t: TableShape): boolean {
  return !t.columns.some((c) => c.name === "id") && !isJoinTable(t);
}

/** An id-less state table's columns.  Value-object leaf columns regroup into
 *  ONE `:map` column, as on an entity table: the saga-state / projection-row
 *  schema types a value-object field `:map` (`ectoStateFieldType`,
 *  `mapTypeToEcto`). */
function stateColumnLines(table: TableShape): string[] {
  const pk = new Set(table.primaryKey);
  const lines = collapseVoGroups(table.columns.filter((c) => !c.valueArrayChildTable)).map((c) =>
    pk.has(c.name)
      ? `add :${c.name}, ${ectoPrimaryKeyType(c.type)}, primary_key: true, null: false`
      : renderEctoColumn(c, table),
  );
  const ts = timestampsMacro(table);
  if (ts) lines.push(ts);
  return lines;
}

/** An entity table's columns: the `id` PK, then the rest with value objects
 *  regrouped into one `:map` each.  The parent's value-collection stand-in
 *  column (`{:array, :map}`, tagged `valueArrayChildTable`) is dropped — the
 *  data lives in the child table, matching the relational backends'
 *  `sql-pg.ts` skip. */
function entityColumnLines(table: TableShape): string[] {
  const idCol = table.columns.find((c) => c.name === "id");
  const pkType = idCol ? ectoPrimaryKeyType(idCol.type) : ":uuid";
  const otherCols = collapseVoGroups(
    table.columns.filter((c) => c.name !== "id" && !c.valueArrayChildTable),
  );
  const lines = [
    `add :id, ${pkType}, primary_key: true, null: false`,
    ...otherCols.map((c) => renderEctoColumn(c, table)),
  ];
  const ts = timestampsMacro(table);
  if (ts) lines.push(ts);
  return lines;
}

/** A value-object collection child table's columns (`charges: Money[]` →
 *  `order_charges`).  Unlike the relational backends — whose child table is
 *  keyed by the composite `(parent_fk, ordinal)` in the shared MigrationsIR —
 *  the Phoenix child carries a SYNTHETIC `id` uuid primary key so it can be
 *  modelled as an Ecto `has_many` whose rows are managed via `cast_assoc`
 *  (which wants row identity for the replace-on-update diff).  The synthetic
 *  id never reaches the wire — the child's Jason encoder projects only the
 *  value object's own fields, so the array stays `[{amount,currency},…]`,
 *  byte-identical with every other backend.  Parent FK cascades; `ordinal`
 *  preserves declared order.  No `timestamps()`: the child schema has none. */
function valueCollectionColumnLines(table: TableShape): string[] {
  return ["add :id, :uuid, primary_key: true, null: false", ...keyedColumnLines(table, new Set())];
}

/** A many-to-many join table's columns.  Composite PK on the two FK columns,
 *  both `primary_key: true` (this is what enforces the set-semantics contract
 *  for `Id<T>[]` — the pair IS the whole row, no payload column); no
 *  `timestamps()` (join rows are pure relationship records, and the
 *  `many_to_many` insert writes only the keys).  Deterministic read-back
 *  order is a read-time projection (the `many_to_many` preloads
 *  `order_by: [asc: :id]` on the target), not a stored `ordinal`. */
function joinColumnLines(table: TableShape): string[] {
  return keyedColumnLines(table, new Set(table.primaryKey));
}

/** Every column of `table` as written, FK columns as `references(...)`, the
 *  ones in `pk` marked `primary_key: true`. */
function keyedColumnLines(table: TableShape, pk: ReadonlySet<string>): string[] {
  const prefix = prefixOpt(table.schema);
  return table.columns.map((c) => {
    const defaultClause = ectoDefaultClause(c.default);
    const pkOpt = pk.has(c.name) ? ", primary_key: true" : "";
    const fk = table.foreignKeys.find((f) => f.column === c.name);
    const decl = fk
      ? `references(:${fk.refTable}${prefix}, type: ${ectoPrimaryKeyType(c.type)}, on_delete: :${fk.onDelete === "cascade" ? "delete_all" : "restrict"})`
      : `${ectoColumnType(c.type)}${ectoColumnOpts(c.type)}`;
    return `add :${c.name}, ${decl}, null: ${c.nullable}${pkOpt}${defaultClause}`;
  });
}

function emitDelta(m: MigrationsIR, appModule: string, out: Map<string, string>): void {
  // A generation whose every step renders to nothing on this backend — today
  // that means a generation of value-object null-consistency CHECKs alone,
  // which Ecto has no columns to constrain — would otherwise land an `.exs`
  // with an empty `change/0`: a migration version recorded in
  // `schema_migrations` that does nothing.  Emit no file instead.
  if (collapseVoSteps(m, "snake").flatMap((s) => renderEctoStep(s)).length === 0) return;
  const path = `priv/repo/migrations/${m.version}_${snake(m.module)}_${snake(m.name)}.exs`;
  out.set(path, renderDeltaFile(m, appModule));
}

function renderDeltaFile(m: MigrationsIR, appModule: string): string {
  // Ecto names every migration module app-wide, and a migration name is only
  // unique within its module's chain — so the module is part of the name.
  const migrationName = `${upperFirst(m.module)}${upperFirst(m.name)}`;
  const stepLines = collapseVoSteps(m, "snake").flatMap((s) => renderEctoStep(s));
  return `defmodule ${appModule}.Repo.Migrations.${migrationName} do
  use Ecto.Migration

  def change do
${stepLines.map((l) => "    " + l).join("\n")}
  end
end
`;
}

export function renderEctoStep(step: MigrationStep): string[] {
  switch (step.op) {
    case "createTable":
      return createTableLines(step.table);
    case "dropTable": {
      const prefix = prefixOpt(step.schema);
      return [`drop table(:${step.name}${prefix})`];
    }
    case "renameTable": {
      // Ecto has no `SET SCHEMA` DSL: a move runs the shared SQL through
      // `execute/1` (the `CREATE SCHEMA` precedent), then renames in the new
      // schema when the name changes too.
      const prefix = prefixOpt(step.schema);
      const lines: string[] = [];
      if (step.fromSchema !== undefined) {
        lines.push(...schemaCreateLines(step.schema));
        lines.push(
          `execute(${elixirStr(renderSetSchemaSql({ ...step, fromSchema: step.fromSchema }))})`,
        );
      }
      if (step.from !== step.to) {
        lines.push(`rename table(:${step.from}${prefix}), to: table(:${step.to}${prefix})`);
      }
      return lines;
    }
    case "addColumn": {
      const c = step.column;
      const prefix = prefixOpt(step.schema);
      const decl = step.fk
        ? `references(:${step.fk.refTable}${prefix}, type: ${ectoPrimaryKeyType(c.type)}, on_delete: :${step.fk.onDelete === "cascade" ? "delete_all" : "restrict"})`
        : `${ectoColumnType(c.type)}${ectoColumnOpts(c.type)}`;
      // The column's `default` is load-bearing on an ADD, not cosmetic: it is
      // what backfills the pre-existing rows so a NOT-NULL add succeeds at all
      // (M-T2.16 / #2864 G1).  Dropping it here left Phoenix emitting a bare
      // `add …, null: false` where the four SQL backends emitted
      // `ADD COLUMN … NOT NULL DEFAULT …` — the same step, one backend failing.
      // Same clause `renderEctoColumn` uses for the CREATE TABLE path.
      // `ifNotExists` (a provenance lineage column) maps to Ecto's
      // `add_if_not_exists`, the same `ADD COLUMN IF NOT EXISTS` the SQL
      // backends render.
      const add = step.ifNotExists ? "add_if_not_exists" : "add";
      return [
        `alter table(:${step.table}${prefix}) do`,
        `  ${add} :${c.name}, ${decl}, null: ${c.nullable}${ectoDefaultClause(c.default)}`,
        `end`,
      ];
    }
    case "dropColumn":
      return [
        `alter table(:${step.table}${prefixOpt(step.schema)}) do`,
        `  remove :${step.name}`,
        `end`,
      ];
    case "renameColumn":
      return [
        `rename table(:${step.table}${prefixOpt(step.schema)}), :${step.from}, to: :${step.to}`,
      ];
    case "alterColumnNullable":
      return [
        `alter table(:${step.table}${prefixOpt(step.schema)}) do`,
        `  modify :${step.name}, ${ectoColumnType(step.type)}${ectoColumnOpts(step.type)}, null: ${step.nullable}`,
        `end`,
      ];
    case "alterColumnType":
      // Ecto's `modify` emits a bare `ALTER COLUMN … TYPE …` with no `USING`
      // cast, so Postgres refuses any change that isn't implicitly castable
      // ("column cannot be cast automatically") — `string → int` and most
      // others.  The four SQL backends go through the shared renderer, which
      // does emit the cast; wrap the same statement in `execute/1` (the
      // renameIndex / backfill precedent in this file) so Phoenix applies the
      // identical DDL instead of failing alone.  Forward-only single-arg
      // `execute`, matching D-MIG-NO-DOWN — which is also why dropping Ecto's
      // rollback-only `from:` costs nothing.
      return [`execute(${elixirStr(renderAlterColumnTypeSql(step))})`];
    case "alterColumnDefault":
      // Ecto's `modify` requires a literal (or MFA-tuple) default, not
      // arbitrary SQL — `default` here is a raw Postgres expression
      // (`gen_random_uuid()`, `now()`, …) exactly like `addColumn`'s, so wrap
      // the shared SQL in `execute/1` (the `alterColumnType` precedent
      // above) for a statement bit-identical with the Postgres backends.
      // Forward-only single-arg `execute`, matching D-MIG-NO-DOWN.
      return [`execute(${elixirStr(renderAlterColumnDefaultSql(step))})`];
    case "addIndex": {
      const cols = ectoIndexColumns(step.index);
      return [
        `create index(:${step.index.table}, [${cols}]${ectoIndexOpts(step.index, prefixOpt(step.schema))})`,
      ];
    }
    case "dropIndex":
      // `index/3` takes the COLUMN list second.  The old `index(:t, name: …)`
      // passed the keyword list AS the columns, so Ecto derived a name of its
      // own from them (`accounts_accounts_number_uq_ledger_index`) and the drop
      // failed with `index … does not exist` — found by the migration-evolution
      // runtime gate the first time a delta dropped an index on Phoenix.  A drop
      // needs only the name (+ prefix), so the column list is empty.
      return [`drop index(:${step.table}, [], name: "${step.name}"${prefixOpt(step.schema)})`];
    case "addCheck":
      // Only the VO null-consistency kind is skipped, and only it.  Ecto stores
      // a value object as ONE `:map` column (`collapseVoGroups`), so the
      // `ship_to_line1` / `ship_to_city` leaf columns that constraint names do
      // not exist on this backend — and the invariant cannot be violated
      // anyway, because a `:map` cell is written whole.  Skipped exactly as the
      // value-array child table is.
      //
      // An `enumValues` check names ONE real column that exists on all five
      // backends, so Phoenix carries it: without it the elixir app would be the
      // single backend whose database still accepted a value the model had
      // deleted — which is the cross-backend asymmetry `docs/migrations.md`
      // promises does not exist.
      if ((step.check.kind ?? "voNullConsistent") !== "enumValues") return [];
      return [
        `create constraint(:${step.check.table}, :${step.check.name}, check: ${elixirStr(step.check.expression)}${prefixOpt(step.schema)}, validate: false)`,
      ];
    case "dropCheck":
      // A DROP carries no `CheckShape`, so the builder copies the kind off the
      // BASELINE shape onto the step.  The guard has to agree with the add
      // above: Ecto has no `if_exists` on `drop constraint`, so dropping one
      // this backend never created would fail the migration.
      if ((step.kind ?? "voNullConsistent") !== "enumValues") return [];
      return [`drop constraint(:${step.table}, :${step.name}${prefixOpt(step.schema)})`];
    case "renameIndex":
      // Ecto has no `rename index` DSL — wrap the shared schema-qualified SQL in
      // `execute/1` (the `CREATE SCHEMA` precedent), so the DDL is bit-identical
      // with the Postgres backends.  Forward-only (single-arg execute), matching
      // D-MIG-NO-DOWN.
      return [`execute(${elixirStr(renderRenameIndexSql(step))})`];
    case "sqlComment":
      return [`# ${step.comment}`];
    case "backfillColumn":
      // Raw-SQL DML via `execute/1` — the UPDATE text is shared with the
      // Postgres renderer (`renderBackfillSql`) so the statement is
      // bit-identical cross-backend, exactly like the DDL steps.
      return [`execute(${elixirStr(renderBackfillSql(step))})`];
    case "sqlExec":
      return [`execute(${elixirStr(step.sql.trimEnd().replace(/;$/, ""))})`];
  }
}

/** Double-quoted Elixir string literal.  Escapes backslash, the quote, and
 *  `#{` interpolation so arbitrary user SQL (a `sql "…"` migration step)
 *  round-trips verbatim through the generated `.exs`. */
function elixirStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/#\{/g, "\\#{")}"`;
}

/** The `enumValues` CHECK constraints of a freshly created table, as Ecto
 *  `create constraint(...)` lines, called from `createTableLines` — the one
 *  create-table rendering the initial files and the delta steps share.
 *
 *  No `validate: false` here — there are no stored rows on a table being
 *  created, which is the same reason the SQL renderer inlines these in the
 *  CREATE TABLE rather than adding them `NOT VALID`.
 *
 *  The `voNullConsistent` kind is skipped on every path, here as on the ALTER:
 *  Ecto stores a value object as one `:map` column, so the leaf columns that
 *  constraint names do not exist on this backend.  For the same reason an
 *  `enumValues` check on an enum INSIDE a value object (`berth_side`) is
 *  skipped: that leaf column is folded into the one `:map` column too, and a
 *  check naming it fails the migration (`column "berth_side" does not exist`). */
function enumCheckLines(table: TableShape, prefix: string): string[] {
  // The builder names an enum check `<table>_<column>_enum`.
  const voLeafChecks = new Set(
    table.columns.filter((c) => c.voGroup).map((c) => `${table.name}_${c.name}_enum`),
  );
  return (table.checks ?? [])
    .filter((c) => (c.kind ?? "voNullConsistent") === "enumValues")
    .filter((c) => !voLeafChecks.has(c.name))
    .map(
      (c) =>
        `create constraint(:${table.name}, :${c.name}, check: ${elixirStr(c.expression)}${prefix})`,
    );
}

function renderEctoColumn(c: ColumnShape, table: TableShape): string {
  const defaultClause = ectoDefaultClause(c.default);
  const fk = table.foreignKeys.find((f) => f.column === c.name);
  if (fk) {
    const ref = `references(:${fk.refTable}${prefixOpt(table.schema)}, type: ${ectoPrimaryKeyType(c.type)}, on_delete: :${fk.onDelete === "cascade" ? "delete_all" : "restrict"})`;
    return `add :${c.name}, ${ref}, null: ${c.nullable}${defaultClause}`;
  }
  return `add :${c.name}, ${ectoColumnType(c.type)}${ectoColumnOpts(c.type)}, null: ${c.nullable}${defaultClause}`;
}

// ---------------------------------------------------------------------------
// Type translation.  Regular columns: text → :text, json → :map, etc.
// Primary keys / FK references: text → :string (Ecto's string-PK
// convention — varchar(255)), uuid → :uuid.
// ---------------------------------------------------------------------------

/** The bounded-numeric options an Ecto `add`/`modify` needs beyond the type
 *  atom.  `money` is `NUMERIC(19,4)` (#2549 — an unbounded column stored
 *  whatever scale the writing backend produced); a plain `decimal` stays
 *  unconstrained.  Kept OUT of `ectoColumnType` because that atom is also
 *  nested inside `{:array, …}`, where trailing options would not parse. */
function ectoColumnOpts(t: ColumnType): string {
  return t.kind === "decimal" && t.precision !== undefined && t.scale !== undefined
    ? `, precision: ${t.precision}, scale: ${t.scale}`
    : "";
}

function ectoColumnType(t: ColumnType): string {
  switch (t.kind) {
    case "uuid":
      return ":uuid";
    case "int":
      return ":integer";
    case "bigint":
      return ":bigint";
    case "bigserial":
      // Ecto's `:bigserial` — bigint + owned sequence (event-log-architecture.md).
      return ":bigserial";
    case "text":
      return ":text";
    case "bool":
      return ":boolean";
    case "decimal":
      return ":decimal";
    case "date":
      return ":date";
    case "datetime":
      // `timestamptz`, the column every other backend uses: a microsecond UTC
      // instant the `Loom.Datetime` field type reads back at millisecond
      // precision (RS-38).  `:utc_datetime` was `timestamp(0)` — SECOND
      // precision, so a written fraction was lost (ledger `F2-W-06`).
      return ":timestamptz";
    case "json":
      return ":map";
    case "array":
      return `{:array, ${ectoColumnType(t.inner)}}`;
  }
}

function ectoPrimaryKeyType(t: ColumnType): string {
  if (t.kind === "text") return ":string";
  return ectoColumnType(t);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPartTable(t: TableShape): boolean {
  // A part has exactly one cascade FK back to its parent aggregate.
  // Join tables (Id<T>[] many-to-many) also have cascades but to two
  // different parents — distinguished by `isJoinTable`.
  return t.foreignKeys.filter((fk) => fk.onDelete === "cascade").length === 1;
}

function isJoinTable(t: TableShape): boolean {
  // Many-to-many join: two cascade FKs to different parent tables,
  // and the table has no `id` column (composite PK).
  const cascades = t.foreignKeys.filter((fk) => fk.onDelete === "cascade");
  if (cascades.length !== 2) return false;
  return !t.columns.some((c) => c.name === "id");
}

function tableToPascal(name: string): string {
  return name.split("_").map(upperFirst).join("");
}
