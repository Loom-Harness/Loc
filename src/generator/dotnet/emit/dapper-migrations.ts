import type { MigrationStep, MigrationsIR } from "../../../ir/types/migrations-ir.js";
import { splitTransactionalSteps } from "../../../ir/util/migration-steps.js";
import { lines } from "../../../util/code-builder.js";
import { upperFirst } from "../../../util/naming.js";
import { MIGRATION_LEDGER_ENTITY, RUNTIME_TABLES } from "../../../util/runtime-tables.js";
import { renderDotnetLogCall, renderDotnetLogCallWithException } from "../../_obs/render-dotnet.js";
import { searchPathSchemas } from "../../_persistence/search-path.js";
import { renderPgStep, splitPgStatements } from "../../sql-pg.js";

// ---------------------------------------------------------------------------
// .NET Dapper migrations (persistence: dapper).
//
// Dapper applies the SAME phase-⑨ `MigrationsIR` chain every other SQL backend
// applies, step for step (D-ONE-SCHEMA): one versioned
// `Migrations/<version>_<Module>_<Name>.cs` per migration, the SQL rendered by
// the shared `sql-pg.ts` renderer, run at boot by `DbSchema.EnsureAsync`
// behind the `public._migrations` history table.  The repositories map
// that schema as it is: a value object is its leaf columns, a list a Postgres
// array, a value-object list a `(parent_fk, ordinal)` child table.
// ---------------------------------------------------------------------------

/** The single statements a step list renders to, comment-only chunks dropped
 *  (a standalone `-- …` is not a command Npgsql can execute). */
function dapperStatements(steps: readonly MigrationStep[]): string[] {
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
function renderDapperMigrationClass(
  ns: string,
  id: string,
  statements: readonly string[],
  inTransaction = true,
): string {
  return (
    lines(
      "// Auto-generated.  A versioned Dapper migration (persistence: dapper): the",
      "// shared MigrationsIR step list, rendered by sql-pg.ts and applied once by",
      `// DbSchema.EnsureAsync, which records it in public.${RUNTIME_TABLES.migrations}.`,
      `namespace ${ns}.Migrations;`,
      "",
      `public sealed class M${id} : global::${ns}.Infrastructure.Persistence.${MIGRATION_LEDGER_ENTITY}`,
      "{",
      `    public override string Id => "${id}";`,
      "",
      ...(inTransaction
        ? []
        : [
            "    // CREATE INDEX CONCURRENTLY: Postgres refuses it inside a transaction block.",
            "    public override bool InTransaction => false;",
            "",
          ]),
      "    public override global::System.Collections.Generic.IReadOnlyList<string> Statements { get; } =",
      "        new string[]",
      "        {",
      ...statements.map((s) => `            @"${verbatim(s)}",`),
      "        };",
      "}",
    ) + "\n"
  );
}

/** Emit one `Migrations/<slug>.cs` per migration with steps. */
export function emitDapperMigrations(
  migrations: readonly MigrationsIR[],
  ns: string,
  out: Map<string, string>,
): void {
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    const { transactional, nonTransactional } = splitTransactionalSteps(m.steps);
    const id = dapperMigrationSlug(m);
    out.set(
      `Migrations/${id}.cs`,
      renderDapperMigrationClass(ns, id, dapperStatements(transactional)),
    );
    // The non-transactional unit (`CREATE INDEX CONCURRENTLY`): its own
    // history id, `<id>_Concurrent`, which sorts right after `<id>`.
    if (nonTransactional.length > 0) {
      const cid = `${id}_Concurrent`;
      out.set(
        `Migrations/${cid}.cs`,
        renderDapperMigrationClass(ns, cid, dapperStatements(nonTransactional), false),
      );
    }
  }
}

/** Postgres `search_path` for the Dapper connection (`searchPathSchemas`).  The
 *  repositories name tables UNQUALIFIED, and the migrations create them in
 *  their context's schema exactly as EF does — the path joins the two. */
export function dapperSearchPath(migrations: readonly MigrationsIR[]): string[] {
  return searchPathSchemas(migrations);
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
      `// Applies the versioned migrations under Migrations/ (one ${MIGRATION_LEDGER_ENTITY} per`,
      "// MigrationsIR generation) in id order, each in its own transaction (a",
      "// CREATE INDEX CONCURRENTLY unit, InTransaction = false, without one), and",
      `// records each id in public.${RUNTIME_TABLES.migrations}.  Idempotent: an id already in`,
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
      `public abstract class ${MIGRATION_LEDGER_ENTITY}`,
      "{",
      "    /// <summary>`<version>_<Module>_<Name>` — the history key, and the apply order.</summary>",
      "    public abstract string Id { get; }",
      "",
      "    /// <summary>Single SQL statements, run in order inside one transaction.</summary>",
      "    public abstract IReadOnlyList<string> Statements { get; }",
      "",
      "    /// <summary>False for a generation's CREATE INDEX CONCURRENTLY unit, which Postgres",
      "    /// refuses inside a transaction block: its statements run one by one without one,",
      "    /// and its id is recorded after the last.  They are written to be re-runnable",
      "    /// (DROP INDEX CONCURRENTLY IF EXISTS first), so a failed unit is retried whole.</summary>",
      "    public virtual bool InTransaction => true;",
      "}",
      "",
      "public static class DbSchema",
      "{",
      "    // 'LOOM' — the session advisory lock every Dapper boot takes around the run.",
      "    private const long LockKey = 0x4C4F4F4D;",
      "",
      `    private const string HistoryDdl = "CREATE TABLE IF NOT EXISTS public.${RUNTIME_TABLES.migrations} (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())";`,
      "",
      "    /// <summary>Every migration compiled into this assembly, in apply order.</summary>",
      `    public static IReadOnlyList<${MIGRATION_LEDGER_ENTITY}> All() =>`,
      "        typeof(DbSchema).Assembly.GetTypes()",
      `            .Where(t => !t.IsAbstract && typeof(${MIGRATION_LEDGER_ENTITY}).IsAssignableFrom(t))`,
      `            .Select(t => (${MIGRATION_LEDGER_ENTITY})Activator.CreateInstance(t)!)`,
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
      `                "SELECT tag FROM public.${RUNTIME_TABLES.migrations}", cancellationToken: cancellationToken)))`,
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
      "                    if (!migration.InTransaction)",
      "                    {",
      "                        foreach (var statement in migration.Statements)",
      "                        {",
      "                            await conn.ExecuteAsync(new CommandDefinition(statement, cancellationToken: cancellationToken));",
      "                        }",
      "                        await conn.ExecuteAsync(new CommandDefinition(",
      `                            "INSERT INTO public.${RUNTIME_TABLES.migrations} (tag) VALUES (@tag)", new { tag = migration.Id }, cancellationToken: cancellationToken));`,
      "                    }",
      "                    else",
      "                    {",
      "                        await using var tx = await conn.BeginTransactionAsync(cancellationToken);",
      "                        foreach (var statement in migration.Statements)",
      "                        {",
      "                            await conn.ExecuteAsync(new CommandDefinition(statement, transaction: tx, cancellationToken: cancellationToken));",
      "                        }",
      "                        await conn.ExecuteAsync(new CommandDefinition(",
      `                            "INSERT INTO public.${RUNTIME_TABLES.migrations} (tag) VALUES (@tag)", new { tag = migration.Id }, tx, cancellationToken: cancellationToken));`,
      "                        await tx.CommitAsync(cancellationToken);",
      "                    }",
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
