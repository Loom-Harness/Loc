import type {
  CheckShape,
  ColumnShape,
  ColumnType,
  IndexShape,
  MigrationStep,
  MigrationsIR,
  SchemaSnapshot,
  TableShape,
} from "../../../ir/types/migrations-ir.js";
import { lines } from "../../../util/code-builder.js";
import { upperFirst } from "../../../util/naming.js";
import { renderDotnetLogCall, renderDotnetLogCallWithException } from "../../_obs/render-dotnet.js";
import {
  collapseVoGroups,
  collapseVoSteps,
  voJsonKey,
  voKeyRenameSteps,
} from "../../_persistence/vo-json-columns.js";
import { renderPgStep, splitPgStatements } from "../../sql-pg.js";

// ---------------------------------------------------------------------------
// .NET Dapper migrations (persistence: dapper).
//
// Dapper applies the SAME phase-⑨ `MigrationsIR` chain the EF adapter applies:
// one versioned `Migrations/<version>_<Module>_<Name>.cs` per migration, the
// SQL rendered by the shared `sql-pg.ts` renderer, run at boot by
// `DbSchema.EnsureAsync` behind the `public.__loom_migrations` history table
// (the ledger the python runner already keeps, so the cross-backend test
// reset already preserves it).
//
// One thing differs, and it is the physical LAYOUT, not the derivation.  The
// canonical IR flattens a value object into leaf columns and stores a list in
// a Postgres array (or, for a value-object list, an id-less child table) — the
// shape the EF / Drizzle / JPA mappings query.  The Dapper repositories
// instead serialise each of those as ONE `jsonb` column with
// System.Text.Json (`fieldColumn` in dapper.ts).  So the steps are projected
// onto that layout before rendering, the same way the Ecto emitter regroups
// value objects into a `:map` (and through the same shared
// `collapseVoGroups` / `collapseVoSteps`):
//
//   - a value-object field   → one `jsonb` column named for the field;
//   - a scalar / enum list   → `jsonb` instead of `<type>[]`;
//   - a value-object list    → `jsonb` on the parent instead of a child table;
//   - a renamed value-object field → its key moved inside the jsonb (in the
//     one object, or in every list element) instead of a column rename;
//   - a value-object null-consistency CHECK → dropped (the column is the
//     whole value object, so it cannot be half-null).
//
// Everything else — tables, keys, foreign keys, indexes (unique / partial /
// softDeletable), enum CHECKs, renames, backfills, raw `sql` steps — is the
// IR's step, rendered unchanged.
// ---------------------------------------------------------------------------

const JSONB: ColumnType = { kind: "json" };

/** `<schema>|<table>` — the identity the IR matches tables by. */
const qkey = (schema: string | undefined, name: string): string => `${schema ?? ""}|${name}`;

/** A value-object list's id-less child table, keyed by its own identity, with
 *  the parent column it stands in for on the Dapper layout. */
interface ValueArrayChild {
  parentTable: string;
  schema: string | undefined;
  column: string;
  nullable: boolean;
}

function valueArrayChildren(
  snaps: readonly (SchemaSnapshot | null)[],
): Map<string, ValueArrayChild> {
  const out = new Map<string, ValueArrayChild>();
  for (const snap of snaps) {
    for (const t of snap?.tables ?? []) {
      for (const c of t.columns) {
        if (!c.valueArrayChildTable) continue;
        out.set(qkey(t.schema, c.valueArrayChildTable), {
          parentTable: t.name,
          schema: t.schema,
          column: c.name,
          nullable: c.nullable,
        });
      }
    }
  }
  return out;
}

/** One canonical column on the Dapper layout.  A list column becomes `jsonb`
 *  (its array-literal default, if any, is meaningless there and is dropped). */
function dapperColumn(c: ColumnShape): ColumnShape {
  if (c.valueArrayChildTable) return { name: c.name, type: JSONB, nullable: c.nullable };
  if (c.type.kind === "array") {
    const { default: _dropped, ...rest } = c;
    return { ...rest, type: JSONB };
  }
  return c;
}

/** The quoted column names a CHECK expression references. */
function checkColumns(ck: CheckShape): string[] {
  return [...ck.expression.matchAll(/"((?:[^"]|"")+)"/g)].map((m) => m[1]!.replace(/""/g, '"'));
}

/** Keep a CHECK on the Dapper layout?  A value-object null-consistency check
 *  never (its leaf columns are one jsonb value); an enum check only while every
 *  column it names still exists (an enum INSIDE a value object lives in the
 *  jsonb, not in a column). */
function keepCheck(ck: CheckShape, columns: ReadonlySet<string>): boolean {
  if ((ck.kind ?? "voNullConsistent") === "voNullConsistent") return false;
  return checkColumns(ck).every((c) => columns.has(c));
}

/** Re-point an index's leaf columns at their value-object group column. */
function mapIndex(ix: IndexShape, leafToGroup: ReadonlyMap<string, string>): IndexShape {
  const columns = [...new Set(ix.columns.map((c) => leafToGroup.get(c) ?? c))];
  return { ...ix, columns };
}

/** One canonical table on the Dapper layout. */
export function projectDapperTable(t: TableShape): TableShape {
  const columns = collapseVoGroups(t.columns.map(dapperColumn));
  const names = new Set(columns.map((c) => c.name));
  const leafToGroup = new Map(
    t.columns.filter((c) => c.voGroup).map((c) => [c.name, c.voGroup!] as const),
  );
  const indexes = t.indexes
    .map((ix) => mapIndex(ix, leafToGroup))
    .filter((ix) => ix.columns.every((c) => names.has(c)));
  const checks = (t.checks ?? []).filter((ck) => keepCheck(ck, names));
  // An `X id` inside a value object is a leaf column with an FK; on this
  // layout it lives in the jsonb, so the FK has no column to hang on.
  const foreignKeys = t.foreignKeys.filter((fk) => names.has(fk.column));
  const { checks: _old, ...rest } = t;
  return { ...rest, columns, indexes, foreignKeys, ...(checks.length > 0 ? { checks } : {}) };
}

/** A migration's steps on the Dapper layout (see the header). */
export function dapperMigrationSteps(m: MigrationsIR): MigrationStep[] {
  const children = valueArrayChildren([m.baseline, m.next]);
  const childOf = (schema: string | undefined, table: string) => children.get(qkey(schema, table));
  const tableIn = (snap: SchemaSnapshot | null, schema: string | undefined, name: string) =>
    snap?.tables.find((t) => t.name === name && t.schema === schema);
  const projectedIn = (snap: SchemaSnapshot | null, schema: string | undefined, name: string) => {
    const t = tableIn(snap, schema, name);
    return t ? projectDapperTable(t) : undefined;
  };
  /** The table an index named `name` belongs to in `snap`, if any. */
  const indexTable = (snap: SchemaSnapshot | null, schema: string | undefined, name: string) =>
    snap?.tables.find((t) => t.schema === schema && t.indexes.some((ix) => ix.name === name));
  const sch = (schema: string | undefined) => (schema !== undefined ? { schema } : {});

  const out: MigrationStep[] = [];
  for (const step of collapseVoSteps(m, "pascal")) {
    switch (step.op) {
      case "createTable": {
        const child = childOf(step.table.schema, step.table.name);
        if (!child) {
          out.push({ op: "createTable", table: projectDapperTable(step.table) });
          break;
        }
        // A value-object list arriving on a table that already exists: its
        // jsonb column is added to the parent.  (A parent created in this same
        // migration already carries the column — `dapperColumn`.)  A required
        // list on a populated table goes nullable → `[]` → NOT NULL, so the
        // chain ends exactly where a fresh create starts.
        if (!tableIn(m.baseline, child.schema, child.parentTable)) break;
        const target = { table: child.parentTable, ...sch(child.schema) };
        out.push({
          op: "addColumn",
          ...target,
          column: { name: child.column, type: JSONB, nullable: true },
        });
        if (!child.nullable) {
          out.push({
            op: "backfillColumn",
            ...target,
            column: child.column,
            valueSql: "'[]'::jsonb",
            onlyNull: true,
          });
          out.push({
            op: "alterColumnNullable",
            ...target,
            name: child.column,
            type: JSONB,
            nullable: false,
          });
        }
        break;
      }
      case "dropTable": {
        const child = childOf(step.schema, step.name);
        if (!child) {
          out.push(step);
          break;
        }
        if (tableIn(m.next, child.schema, child.parentTable)) {
          out.push({
            op: "dropColumn",
            table: child.parentTable,
            ...sch(child.schema),
            name: child.column,
          });
        }
        break;
      }
      case "renameTable":
        // A child table follows its parent's rename; on this layout there is
        // no child table, and the parent's own rename carries the column.
        if (!childOf(step.schema, step.from) && !childOf(step.schema, step.to)) out.push(step);
        break;
      case "addColumn":
        if (childOf(step.schema, step.table)) break;
        out.push({ ...step, column: dapperColumn(step.column) });
        break;
      case "alterColumnType": {
        if (childOf(step.schema, step.table)) break;
        // A list column is jsonb whatever its element type: nothing to alter.
        if (step.to.kind === "array" && step.from.kind === "array") break;
        out.push({
          ...step,
          from: step.from.kind === "array" ? JSONB : step.from,
          to: step.to.kind === "array" ? JSONB : step.to,
        });
        break;
      }
      case "alterColumnDefault": {
        if (childOf(step.schema, step.table)) break;
        const col = tableIn(m.next, step.schema, step.table)?.columns.find(
          (c) => c.name === step.name,
        );
        if (col?.type.kind === "array") break;
        out.push(step);
        break;
      }
      case "renameColumn": {
        const child = childOf(step.schema, step.table);
        if (!child) {
          out.push(step);
          break;
        }
        // A value-object list element's field was renamed: the elements live
        // in the parent's jsonb array, so the key moves in every element.  The
        // child's own key columns (parent FK, ordinal) are not element fields.
        const keyCols = tableIn(m.baseline, step.schema, step.table)?.primaryKey ?? [];
        if (keyCols.includes(step.from)) break;
        out.push(
          ...voKeyRenameSteps({
            table: child.parentTable,
            schema: child.schema,
            column: child.column,
            from: voJsonKey(step.from, "pascal"),
            to: voJsonKey(step.to, "pascal"),
            list: true,
          }),
        );
        break;
      }
      case "dropColumn":
      case "alterColumnNullable":
      case "backfillColumn":
        if (!childOf(step.schema, step.table)) out.push(step);
        break;
      case "addIndex": {
        if (childOf(step.schema, step.index.table)) break;
        const t = projectedIn(m.next, step.schema, step.index.table);
        const leafToGroup = new Map(
          (tableIn(m.next, step.schema, step.index.table)?.columns ?? [])
            .filter((c) => c.voGroup)
            .map((c) => [c.name, c.voGroup!] as const),
        );
        const index = mapIndex(step.index, leafToGroup);
        const names = new Set((t?.columns ?? []).map((c) => c.name));
        if (t && !index.columns.every((c) => names.has(c))) break;
        out.push({ ...step, index });
        break;
      }
      case "dropIndex": {
        if (childOf(step.schema, step.table)) break;
        const before = projectedIn(m.baseline, step.schema, step.table);
        if (before && !before.indexes.some((ix) => ix.name === step.name)) break;
        out.push(step);
        break;
      }
      case "renameIndex": {
        const owner = indexTable(m.baseline, step.schema, step.from);
        if (owner && childOf(owner.schema, owner.name)) break;
        if (owner && !projectDapperTable(owner).indexes.some((ix) => ix.name === step.from)) break;
        out.push(step);
        break;
      }
      case "addCheck": {
        if (childOf(step.schema, step.check.table)) break;
        const t = projectedIn(m.next, step.schema, step.check.table);
        const names = new Set((t?.columns ?? []).map((c) => c.name));
        if (keepCheck(step.check, names)) out.push(step);
        break;
      }
      case "dropCheck": {
        if (childOf(step.schema, step.table)) break;
        if ((step.kind ?? "voNullConsistent") === "voNullConsistent") break;
        const before = projectedIn(m.baseline, step.schema, step.table);
        if (before && !(before.checks ?? []).some((ck) => ck.name === step.name)) break;
        out.push(step);
        break;
      }
      case "sqlComment":
      case "sqlExec":
        out.push(step);
        break;
      default: {
        const _exhaustive: never = step;
        void _exhaustive;
      }
    }
  }
  return out;
}

/** The single statements a step list renders to, comment-only chunks dropped
 *  (a standalone `-- …` is not a command Npgsql can execute). */
export function dapperStatements(steps: readonly MigrationStep[]): string[] {
  return steps
    .flatMap((s) => splitPgStatements(renderPgStep(s)))
    .filter((stmt) =>
      stmt
        .replace(/;$/, "")
        .split("\n")
        .some((l) => l.trim().length > 0 && !l.trim().startsWith("--")),
    );
}

/** `Migrations/<slug>.cs` — the id EF would give the same migration. */
export function dapperMigrationSlug(m: MigrationsIR): string {
  return `${m.version}_${upperFirst(m.module)}_${upperFirst(m.name)}`;
}

/** C# verbatim literal body (`@"…"`): only `"` needs escaping (doubled). */
const verbatim = (s: string): string => s.replace(/"/g, '""');

/** One migration class: its history id and its single SQL statements. */
function renderDapperMigrationClass(ns: string, id: string, statements: readonly string[]): string {
  return (
    lines(
      "// Auto-generated.  A versioned Dapper migration (persistence: dapper): the",
      "// shared MigrationsIR step list, rendered by sql-pg.ts and applied once by",
      "// DbSchema.EnsureAsync, which records it in public.__loom_migrations.",
      `namespace ${ns}.Migrations;`,
      "",
      `public sealed class M${id} : global::${ns}.Infrastructure.Persistence.LoomMigration`,
      "{",
      `    public override string Id => "${id}";`,
      "",
      "    public override global::System.Collections.Generic.IReadOnlyList<string> Statements { get; } =",
      "        new string[]",
      "        {",
      ...statements.map((s) => `            @"${verbatim(s)}",`),
      "        };",
      "}",
    ) + "\n"
  );
}

/** Emit one `Migrations/<slug>.cs` per migration with steps.  A migration whose
 *  every step projects away (a value-object null-consistency CHECK alone) is
 *  still emitted, with no statements: its version is in the snapshot history,
 *  and the migration-baseline guard expects a file for every recorded version. */
export function emitDapperMigrations(
  migrations: readonly MigrationsIR[],
  ns: string,
  out: Map<string, string>,
): void {
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    const steps = dapperMigrationSteps(m);
    const id = dapperMigrationSlug(m);
    out.set(`Migrations/${id}.cs`, renderDapperMigrationClass(ns, id, dapperStatements(steps)));
  }
}

/** Postgres `search_path` for the Dapper connection: `public` first (where the
 *  history table, the seed marker and the shared outbox live, and where an
 *  unqualified `CREATE` lands), then every schema this deployable's tables live
 *  in.  The repositories name tables UNQUALIFIED, and the migrations create
 *  them in their context's schema exactly as EF does — the path joins the two. */
export function dapperSearchPath(migrations: readonly MigrationsIR[]): string[] {
  const schemas = new Set<string>();
  for (const m of migrations) {
    for (const t of m.next.tables) if (t.schema && t.schema !== "public") schemas.add(t.schema);
  }
  return ["public", ...[...schemas].sort()];
}

/** `Infrastructure/Persistence/DbSchema.cs` — the boot-time migration runner.
 *  The file keeps the name the pre-migration bootstrap had, so regenerating an
 *  old output tree REPLACES the bootstrap rather than leaving it beside the
 *  runner. */
export function renderDapperMigrationRunner(ns: string): string {
  const log = (s: string) => `            ${s}`;
  return (
    lines(
      "// Auto-generated.  Dapper migration runner (persistence: dapper).",
      "//",
      "// Applies the versioned migrations under Migrations/ (one LoomMigration per",
      "// MigrationsIR generation) in id order, each in its own transaction, and",
      "// records each id in public.__loom_migrations.  Idempotent: an id already in",
      "// the table is skipped, so every boot after the first is a no-op.  A",
      "// session advisory lock serialises concurrent boots (replicas, restarts).",
      "using System;",
      "using System.Collections.Generic;",
      "using System.Linq;",
      "using System.Threading;",
      "using System.Threading.Tasks;",
      "using Dapper;",
      "using Microsoft.Extensions.Logging;",
      "using Npgsql;",
      "",
      `namespace ${ns}.Infrastructure.Persistence;`,
      "",
      "/// <summary>One versioned migration: the statements of one MigrationsIR generation.</summary>",
      "public abstract class LoomMigration",
      "{",
      "    /// <summary>`<version>_<Module>_<Name>` — the history key, and the apply order.</summary>",
      "    public abstract string Id { get; }",
      "",
      "    /// <summary>Single SQL statements, run in order inside one transaction.</summary>",
      "    public abstract IReadOnlyList<string> Statements { get; }",
      "}",
      "",
      "public static class DbSchema",
      "{",
      "    // 'LOOM' — the session advisory lock every Dapper boot takes around the run.",
      "    private const long LockKey = 0x4C4F4F4D;",
      "",
      '    private const string HistoryDdl = "CREATE TABLE IF NOT EXISTS public.__loom_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())";',
      "",
      "    /// <summary>Every migration compiled into this assembly, in apply order.</summary>",
      "    public static IReadOnlyList<LoomMigration> All() =>",
      "        typeof(DbSchema).Assembly.GetTypes()",
      "            .Where(t => !t.IsAbstract && typeof(LoomMigration).IsAssignableFrom(t))",
      "            .Select(t => (LoomMigration)Activator.CreateInstance(t)!)",
      "            .OrderBy(m => m.Id, StringComparer.Ordinal)",
      "            .ToList();",
      "",
      "    public static async Task EnsureAsync(NpgsqlDataSource db, ILogger _log, CancellationToken cancellationToken = default)",
      "    {",
      "        var migrations = All();",
      "        await using var conn = await db.OpenConnectionAsync(cancellationToken);",
      '        await conn.ExecuteAsync(new CommandDefinition("SELECT pg_advisory_lock(@k)", new { k = LockKey }, cancellationToken: cancellationToken));',
      "        try",
      "        {",
      "            await conn.ExecuteAsync(new CommandDefinition(HistoryDdl, cancellationToken: cancellationToken));",
      "            var applied = (await conn.QueryAsync<string>(new CommandDefinition(",
      '                "SELECT tag FROM public.__loom_migrations", cancellationToken: cancellationToken)))',
      "                .ToHashSet(StringComparer.Ordinal);",
      "            // An applied SET, not a watermark: a migration whose id sorts below one",
      "            // already applied (one this build no longer ships, say) still runs.",
      "            var pending = migrations.Where(m => !applied.Contains(m.Id)).ToList();",
      log(
        renderDotnetLogCall("migrationsStarting", [{ name: "count", valueExpr: "pending.Count" }]),
      ),
      "            foreach (var migration in pending)",
      "            {",
      "                try",
      "                {",
      "                    await using var tx = await conn.BeginTransactionAsync(cancellationToken);",
      "                    foreach (var statement in migration.Statements)",
      "                    {",
      "                        await conn.ExecuteAsync(new CommandDefinition(statement, transaction: tx, cancellationToken: cancellationToken));",
      "                    }",
      "                    await conn.ExecuteAsync(new CommandDefinition(",
      '                        "INSERT INTO public.__loom_migrations (tag) VALUES (@tag)", new { tag = migration.Id }, tx, cancellationToken: cancellationToken));',
      "                    await tx.CommitAsync(cancellationToken);",
      "                }",
      "                catch (Exception migrationError)",
      "                {",
      `                    ${renderDotnetLogCallWithException("migrationFailed", "migrationError", [
        { name: "error", valueExpr: "migrationError.Message" },
      ])}`,
      "                    throw;",
      "                }",
      `                ${renderDotnetLogCall("migrationApplied", [
        { name: "id", valueExpr: "migration.Id" },
        { name: "name", valueExpr: "migration.Id" },
      ])}`,
      "            }",
      log(
        renderDotnetLogCall("migrationsComplete", [
          { name: "applied", valueExpr: "pending.Count" },
        ]),
      ),
      "        }",
      "        finally",
      "        {",
      '            await conn.ExecuteAsync(new CommandDefinition("SELECT pg_advisory_unlock(@k)", new { k = LockKey }, cancellationToken: CancellationToken.None));',
      "        }",
      "    }",
      "}",
    ) + "\n"
  );
}
