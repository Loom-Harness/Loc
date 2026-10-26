import type { ExprIR } from "../ir/types/loom-ir.js";
import type {
  CheckShape,
  ColumnShape,
  ColumnType,
  FKShape,
  IndexShape,
  MigrationStep,
  TableShape,
} from "../ir/types/migrations-ir.js";
import { plural, snake } from "../util/naming.js";

// ---------------------------------------------------------------------------
// Postgres SQL renderer shared by the TS/Hono and .NET/EF migration emitters.
//
// Both backends end up calling Postgres; producing identical SQL via this
// helper means a schema migration written by either backend is bit-for-bit
// equivalent.  Phoenix stays in Ecto DSL — its output is Elixir, not SQL,
// so it does not share this helper.
// ---------------------------------------------------------------------------

export function renderPgStep(step: MigrationStep): string {
  switch (step.op) {
    case "createTable":
      return renderCreateTable(step.table);
    case "dropTable":
      return `DROP TABLE ${qualified(step.schema, step.name)};`;
    case "renameTable": {
      // A move first changes schema (creating the target schema, idempotent,
      // as a create-table does); Postgres carries the table's indexes,
      // constraints and owned sequences along.  `RENAME TO` then takes an
      // UNqualified new name (the table stays in its schema); qualify the
      // source, bare the target.
      const out: string[] = [];
      if (step.fromSchema !== undefined) {
        if (step.schema) out.push(`CREATE SCHEMA IF NOT EXISTS ${ident(step.schema)};`);
        out.push(`${renderSetSchemaSql({ ...step, fromSchema: step.fromSchema })};`);
      }
      if (step.from !== step.to) {
        out.push(`ALTER TABLE ${qualified(step.schema, step.from)} RENAME TO ${ident(step.to)};`);
      }
      return out.join("\n");
    }
    case "addColumn":
      return renderAddColumn(step.table, step.schema, step.column, step.fk, step.ifNotExists);
    case "dropColumn":
      return `ALTER TABLE ${qualified(step.schema, step.table)} DROP COLUMN ${ident(step.name)};`;
    case "renameColumn":
      return (
        `ALTER TABLE ${qualified(step.schema, step.table)} ` +
        `RENAME COLUMN ${ident(step.from)} TO ${ident(step.to)};`
      );
    case "alterColumnNullable":
      return `ALTER TABLE ${qualified(step.schema, step.table)} ALTER COLUMN ${ident(step.name)} ${
        step.nullable ? "DROP NOT NULL" : "SET NOT NULL"
      };`;
    case "alterColumnType":
      return `${renderAlterColumnTypeSql(step)};`;
    case "alterColumnDefault":
      return `${renderAlterColumnDefaultSql(step)};`;
    case "addIndex":
      // The index carries no schema of its own; the step's `schema` is the
      // owning table's schema (indexes live in the table's schema).
      return step.concurrently
        ? renderAddIndexConcurrently(step.index, step.schema)
        : renderAddIndex(step.index, step.schema);
    case "dropIndex":
      return `DROP INDEX ${qualified(step.schema, step.name)};`;
    case "addCheck":
      return renderAddCheck(step.check, step.schema);
    case "dropCheck":
      // `IF EXISTS` so re-running against a database whose constraint was
      // dropped by hand (or that predates the constraint entirely) is not a
      // hard failure — the drop is a loosening, it has nothing to protect.
      return (
        `ALTER TABLE ${qualified(step.schema, step.table)} ` +
        `DROP CONSTRAINT IF EXISTS ${ident(step.name)};`
      );
    case "renameIndex":
      return `${renderRenameIndexSql(step)};`;
    case "sqlComment":
      return `-- ${step.comment}`;
    case "backfillColumn":
      return `${renderBackfillSql(step)};`;
    case "sqlExec":
      // Verbatim user SQL; normalise the trailing semicolon so the statement
      // splitters (Drizzle breakpoints, the Python runner) see one statement.
      return step.sql.trimEnd().endsWith(";") ? step.sql.trimEnd() : `${step.sql.trimEnd()};`;
  }
}

/** First line of a migration SQL file the node and python boot runners must
 *  apply outside a transaction — a generation's non-transactional unit
 *  (`splitTransactionalSteps`).  A SQL comment, so the file stays plain SQL
 *  to every other reader. */
export const NO_TRANSACTION_MARKER = "-- loom:no-transaction";

/** Split one rendered migration chunk (a `renderPgStep` result, or several
 *  joined) into single statements, each `;`-terminated.  For the runners that
 *  execute ONE statement per call: asyncpg (python) cannot run a
 *  multi-statement string at all, and the .NET Dapper runner sends each
 *  statement as its own command so a `CREATE INDEX` is parsed only after the
 *  `CREATE TABLE` it names exists.  The DDL is Loom-rendered, so a `;` at end
 *  of line is always a statement boundary (a raw `sql` step is normalised to
 *  one trailing `;` by `renderPgStep`). */
export function splitPgStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n|;\s*$/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => `${s};`);
}

/** The backfill UPDATE without its trailing semicolon — shared with the Ecto
 *  emitter (which wraps it in `execute/1`), so the DML is bit-identical
 *  cross-backend exactly like the DDL out of `renderPgStep`. */
export function renderBackfillSql(step: {
  table: string;
  schema?: string;
  column: string;
  valueSql: string;
  onlyNull: boolean;
}): string {
  const target = qualified(step.schema, step.table);
  const col = ident(step.column);
  const where = step.onlyNull ? ` WHERE ${col} IS NULL` : "";
  return `UPDATE ${target} SET ${col} = ${step.valueSql}${where}`;
}

/** `ALTER INDEX <schema>.<from> RENAME TO <to>` without its trailing
 *  semicolon — shared with the Ecto emitter (which wraps it in `execute/1`,
 *  Ecto having no native `rename index` DSL), so the DDL is bit-identical
 *  cross-backend exactly like {@link renderBackfillSql}.  The source is
 *  schema-qualified (a migration runner's `search_path` excludes context
 *  schemas); the target is bare — Postgres keeps a renamed index in its
 *  existing schema. */
/** `ALTER TABLE … ALTER COLUMN … TYPE … USING …` — the semicolon-less form, so
 *  the Ecto emitter can wrap it in `execute/1` and get a statement bit-identical
 *  with the Postgres backends (fleet-bug-hunt I2).  The `USING <col>::<type>`
 *  cast is the load-bearing part: without it Postgres refuses any change that
 *  isn't implicitly castable ("column cannot be cast automatically"), which is
 *  most of them — `string → int` included. */
export function renderAlterColumnTypeSql(step: {
  table: string;
  name: string;
  to: ColumnType;
  schema?: string;
}): string {
  return (
    `ALTER TABLE ${qualified(step.schema, step.table)} ALTER COLUMN ${ident(step.name)} ` +
    `TYPE ${renderPgType(step.to)} USING ${ident(step.name)}::${renderPgType(step.to)}`
  );
}

/** `ALTER TABLE … ALTER COLUMN … SET DEFAULT …` / `… DROP DEFAULT` — the
 *  semicolon-less form, shared with the Ecto emitter (`execute/1`, the same
 *  bit-identical-DDL precedent as {@link renderAlterColumnTypeSql}).
 *  `to === undefined` means the new schema has no default — the honest
 *  rendering is `DROP DEFAULT`, not `SET DEFAULT NULL` (a real NULL default
 *  vs. no default at all are different things in Postgres). */
export function renderAlterColumnDefaultSql(step: {
  table: string;
  name: string;
  to: string | undefined;
  schema?: string;
}): string {
  const target = `ALTER TABLE ${qualified(step.schema, step.table)} ALTER COLUMN ${ident(step.name)}`;
  return step.to === undefined ? `${target} DROP DEFAULT` : `${target} SET DEFAULT ${step.to}`;
}

/** `ALTER TABLE … SET SCHEMA …` for a moved table, under its OLD name (a
 *  rename, if any, follows in the new schema).  No trailing `;`.  A move into
 *  the default schema names `public`. */
export function renderSetSchemaSql(step: {
  from: string;
  schema?: string;
  fromSchema: string | null;
}): string {
  return `ALTER TABLE ${qualified(step.fromSchema ?? undefined, step.from)} SET SCHEMA ${ident(step.schema ?? "public")}`;
}

export function renderRenameIndexSql(step: { from: string; to: string; schema?: string }): string {
  return `ALTER INDEX ${qualified(step.schema, step.from)} RENAME TO ${ident(step.to)}`;
}

function renderCreateTable(table: TableShape): string {
  const lines: string[] = [];
  // A value-object array's parent stand-in column is skipped on relational
  // backends — its elements live in the id-less child table, not a column.
  for (const c of table.columns) {
    if (c.valueArrayChildTable) continue;
    lines.push("  " + renderColumnDef(c));
  }
  if (table.primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${table.primaryKey.map(ident).join(", ")})`);
  }
  // FK targets live in the same context as the table, hence the same
  // schema — qualify them with the table's schema so the reference
  // resolves under `search_path = public` (which is all the backends set).
  for (const fk of table.foreignKeys) {
    lines.push("  " + renderFkConstraint(fk, table.schema));
  }
  // Value-object null-consistency checks (CheckShape) go inline: the table is
  // being created, so there are no stored rows to validate against and no
  // reason for the `NOT VALID` the ALTER path needs.
  for (const ck of table.checks ?? []) {
    lines.push(`  CONSTRAINT ${ident(ck.name)} CHECK (${ck.expression})`);
  }
  const body = lines.join(",\n");
  // Create the owning context's schema first (idempotent) so the
  // `<schema>.<table>` the EF / Drizzle mappings query actually exists.
  const createSchema = table.schema ? `CREATE SCHEMA IF NOT EXISTS ${ident(table.schema)};\n` : "";
  let sql = `${createSchema}CREATE TABLE ${qualified(table.schema, table.name)} (\n${body}\n);`;
  for (const idx of table.indexes) sql += "\n" + renderAddIndex(idx, table.schema);
  return sql;
}

/** `<schema>.<name>` when a schema is set, else the bare (public) name. */
function qualified(schema: string | undefined, name: string): string {
  return schema ? `${ident(schema)}.${ident(name)}` : ident(name);
}

function renderAddColumn(
  table: string,
  schema: string | undefined,
  column: ColumnShape,
  fk: FKShape | undefined,
  ifNotExists = false,
): string {
  const t = qualified(schema, table);
  const guard = ifNotExists ? "IF NOT EXISTS " : "";
  let sql = `ALTER TABLE ${t} ADD COLUMN ${guard}${renderColumnDef(column)};`;
  if (fk) {
    // FK targets live in the same schema as the referencing table.
    sql +=
      `\nALTER TABLE ${t} ADD CONSTRAINT ${ident(table + "_" + column.name + "_fk")} ` +
      `FOREIGN KEY (${ident(column.name)}) REFERENCES ${qualified(schema, fk.refTable)} ` +
      `ON DELETE ${fk.onDelete.toUpperCase()};`;
  }
  return sql;
}

function renderColumnDef(c: ColumnShape): string {
  const parts = [ident(c.name), renderPgType(c.type)];
  parts.push(c.nullable ? "NULL" : "NOT NULL");
  if (c.default !== undefined) parts.push(`DEFAULT ${c.default}`);
  return parts.join(" ");
}

/** `ALTER TABLE … ADD CONSTRAINT … CHECK (…) NOT VALID`.
 *
 *  `NOT VALID` is the load-bearing word.  This step only ever targets a table
 *  that already exists (a new table carries its checks inline, below), and the
 *  constraint being added — the all-null-or-all-present invariant of a
 *  flattened optional value object — is precisely one that stored rows CAN
 *  violate: nothing enforced it until now, so a hand-written `UPDATE` or an
 *  old backfill may have left a half-written group behind.  A validating
 *  `ADD CONSTRAINT` would abort the whole migration on exactly the database
 *  that most needs the guard, which is strictly worse than the gap it closes.
 *  `NOT VALID` enforces every future INSERT and UPDATE from the moment it is
 *  applied and simply does not re-read the existing rows; the operator who
 *  wants the back-check runs the `VALIDATE CONSTRAINT` the trailing comment
 *  names (it takes only a `SHARE UPDATE EXCLUSIVE` lock, so it is safe to run
 *  on a live table, and it reports the offending row instead of failing a
 *  deploy).
 *
 *  The operator note LEADS the statement rather than trailing it, and carries
 *  no `;` of its own: every consumer of this renderer splits the emitted file
 *  on a statement terminator (the Python runner on `;\n`, Drizzle on its
 *  breakpoint), so a trailing comment would be handed over as a statement of
 *  its own — an empty query.  A leading comment is part of the statement it
 *  introduces and survives every splitter unchanged. */
function renderAddCheck(check: CheckShape, schema?: string): string {
  const t = qualified(schema, check.table);
  return (
    `-- NOT VALID: already-stored rows are not re-checked. To verify them, run ` +
    `ALTER TABLE ${t} VALIDATE CONSTRAINT ${ident(check.name)}\n` +
    `ALTER TABLE ${t} ADD CONSTRAINT ${ident(check.name)} ` +
    `CHECK (${check.expression}) NOT VALID;`
  );
}

function renderFkConstraint(fk: FKShape, schema?: string): string {
  return (
    `FOREIGN KEY (${ident(fk.column)}) REFERENCES ${qualified(schema, fk.refTable)} ` +
    `ON DELETE ${fk.onDelete.toUpperCase()}`
  );
}

/** An index added to a table that already holds rows: built `CONCURRENTLY`, so
 *  reads and writes keep flowing while it builds (a plain `CREATE INDEX` holds
 *  a SHARE lock that blocks every INSERT/UPDATE/DELETE until it finishes).
 *
 *  Two statements, never one string: Postgres refuses `CONCURRENTLY` inside a
 *  transaction block, and a multi-statement query is an implicit one.  The
 *  leading `DROP INDEX CONCURRENTLY IF EXISTS` is the recovery a failed build
 *  needs — a concurrent build that fails (a duplicate key under a unique index,
 *  a cancelled deploy) leaves an INVALID index of that name behind, which
 *  enforces nothing for reads yet still blocks a plain retry with "already
 *  exists".  The step only exists because the baseline has no index of that
 *  name, so whatever the drop removes is such a leftover.  Callers run the
 *  pair outside a transaction (`splitTransactionalSteps`). */
function renderAddIndexConcurrently(idx: IndexShape, schema?: string): string {
  return (
    `DROP INDEX CONCURRENTLY IF EXISTS ${qualified(schema, idx.name)};\n` +
    renderAddIndex(idx, schema, true)
  );
}

function renderAddIndex(idx: IndexShape, schema?: string, concurrently = false): string {
  const unique = idx.unique ? "UNIQUE " : "";
  const conc = concurrently ? "CONCURRENTLY " : "";
  // Partial index (`WHERE …`) — set on a `unique` index derived for a
  // softDeletable aggregate so re-create after soft-delete is allowed.
  const where = idx.predicate ? ` WHERE ${idx.predicate}` : "";
  // Per-column opclass (materialized-path prefix index): `text_pattern_ops`
  // after the column makes `LIKE 'prefix.%'` index-usable under any collation.
  const cols = idx.columns
    .map((c) => {
      const oc = idx.opclasses?.[c];
      return oc ? `${ident(c)} ${oc}` : ident(c);
    })
    .join(", ");
  return (
    `CREATE ${unique}INDEX ${conc}${ident(idx.name)} ON ${qualified(schema, idx.table)} ` +
    `(${cols})${where};`
  );
}

function renderPgType(t: ColumnType): string {
  switch (t.kind) {
    case "uuid":
      return "UUID";
    case "int":
      return "INTEGER";
    case "bigserial":
      return "BIGSERIAL";
    case "bigint":
      return "BIGINT";
    case "text":
      return "TEXT";
    case "bool":
      return "BOOLEAN";
    case "decimal":
      // `money` carries the canonical NUMERIC(19,4) bounds; a plain `decimal`
      // stays unconstrained.  An unbounded column stored whatever scale the
      // writing backend produced, so the SAME value read back through two
      // backends could differ (#2549).
      return t.precision !== undefined && t.scale !== undefined
        ? `DECIMAL(${t.precision}, ${t.scale})`
        : "DECIMAL";
    case "date":
      return "DATE";
    case "datetime":
      return "TIMESTAMP WITH TIME ZONE";
    case "json":
      return "JSONB";
    case "array":
      return `${renderPgType(t.inner)}[]`;
  }
}

/** Double-quoted identifier — the same quote-always spelling the seed path
 *  (`qIdent`) uses, so DDL and DML agree.  Postgres folds an unquoted
 *  identifier to lowercase and the migration builder already snake-cases
 *  everything to lowercase, so `"orders"` references the same relation as a
 *  bare `orders` — quoting is a no-op for the common case but makes a
 *  reserved-word column (`order`, `user`, `end`) or any `.ddd`-sourced name
 *  safe instead of a syntax error. */
function ident(name: string): string {
  return qIdent(name);
}

// ---------------------------------------------------------------------------
// Seed `raw`-path inserts (database-seeding.md §3.1) — a direct Postgres
// INSERT for one literal row.  Shared by all three backends' seed emitters
// (executed via Drizzle `db.execute`, EF `ExecuteSqlRawAsync`, Ecto
// `Ecto.Adapters.SQL`), so the SQL is bit-identical cross-backend.  The
// table/column naming mirrors the migration builder (`plural(snake(agg))` /
// `snake(field)`), so the INSERT targets the schema those migrations create.
// ---------------------------------------------------------------------------

/** INSERT for one `raw` seed row: explicit `id` + literal FK / scalar / enum
 *  columns.  Value objects / containment columns are unsupported in v1 (the
 *  validator reports them before this runs).  `schema` qualifies the table
 *  for backends whose tables live outside the connection's search_path
 *  (java's per-module schemas); omitted, the SQL is unchanged.
 *
 *  Column-per-field by construction: this knows nothing of the aggregate's
 *  SAVING SHAPE, so a `shape: document` aggregate — one `(id, data, version)`
 *  jsonb table — has no column here to target (`F2-SEED-RAW-DOCUMENT`, five
 *  backends emitting the same `42703` INSERT).  `loom.seed-raw-document-shape`
 *  (src/language/validators/seed.ts) rejects that crossing upstream; teaching
 *  this renderer the document shape is the alternative, and is not done. */
export function renderSeedRowInsert(
  aggregate: string,
  fields: { name: string; value: ExprIR }[],
  schema?: string,
): string {
  const bare = qIdent(plural(snake(aggregate)));
  const table = schema ? `${qIdent(schema)}.${bare}` : bare;
  const cols = fields.map((f) => qIdent(snake(f.name))).join(", ");
  const vals = fields.map((f) => seedSqlLiteral(f.value)).join(", ");
  return `INSERT INTO ${table} (${cols}) VALUES (${vals})`;
}

/** Double-quoted identifier — matches the lowercase tables the migrations
 *  create and is safe for reserved words (`order`, `user`).  An embedded `"`
 *  is doubled per the Postgres quoting rule, so a `.ddd`-sourced name can't
 *  break out of the quotes.  Exported for the scalar-expression renderer
 *  (`sql-pg-expr.ts`), which quotes column refs the same way. */
export function qIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** An ExprIR seed value as a Postgres SQL literal.  Scalars / enum values /
 *  id literals only; anything else throws (raw v1 limitation). */
function seedSqlLiteral(e: ExprIR): string {
  if (e.kind === "literal") {
    switch (e.lit) {
      case "string":
        return sqlStr(e.value);
      case "money":
      case "decimal":
      case "int":
      case "long":
        return e.value;
      case "bool":
        return e.value === "true" ? "TRUE" : "FALSE";
      case "null":
        return "NULL";
      case "now":
        return "now()";
      default:
        return sqlStr(e.value);
    }
  }
  // Enum value → its stored text (pgEnum stores the value name).
  if (e.kind === "ref" && e.refKind === "enum-value") {
    return sqlStr(e.name);
  }
  throw new Error(
    `raw seed: unsupported column value of kind '${e.kind}' — raw rows admit scalar / enum / id literals only`,
  );
}

/** Single-quoted SQL string literal (doubling embedded quotes).  Exported
 *  for the scalar-expression renderer (`sql-pg-expr.ts`). */
export function sqlStr(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
