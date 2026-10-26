import type { MigrationsIR } from "../../../ir/types/migrations-ir.js";
import { splitTransactionalSteps } from "../../../ir/util/migration-steps.js";
import { upperFirst } from "../../../util/naming.js";
import { renderPgStep, splitPgStatements } from "../../sql-pg.js";

// ---------------------------------------------------------------------------
// .NET EF Core migration emitter.
//
// One `Migrations/<Version>_<Name>.cs` class per `MigrationsIR`, each
// invoking `migrationBuilder.Sql(...)` with the rendered Postgres DDL
// from the shared `renderPgStep` helper.  Avoids EF's `dotnet ef
// migrations add` tooling entirely: we own the SQL, so EF only sees the
// migration classes at runtime via `Database.Migrate()` which honours
// the `[Migration("<version>")]` attribute for ordering and writes to
// `__EFMigrationsHistory` as usual.
//
// No `ModelSnapshot` is emitted.  The snapshot is only used by
// `dotnet ef migrations add` to compute diffs against the DbContext —
// since Loom owns migration generation end-to-end, that tooling path
// is never taken, and skipping the snapshot avoids a perpetually
// stale stub.  EF's `PendingModelChangesWarning` is gated on a
// snapshot existing in the migrations assembly; with no snapshot
// class present, the warning has nothing to compare against and
// stays silent (validated via `LOOM_DOTNET_BUILD=1 /warnaserror`).
// ---------------------------------------------------------------------------

export function emitDotnetMigrations(
  migrations: MigrationsIR[],
  ns: string,
  out: Map<string, string>,
): void {
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    // Qualify the migration identity with the module.  The version alone
    // is already unique across modules, but every module's first
    // generation is named "Initial", and the module keeps the filename and
    // class name saying which module the migration belongs to.
    const slug = `${m.version}_${upperFirst(m.module)}_${upperFirst(m.name)}`;
    const { transactional, nonTransactional } = splitTransactionalSteps(m.steps);
    if (transactional.length > 0) {
      const sql = transactional.map(renderPgStep).join("\n\n");
      out.set(
        `Migrations/${slug}.cs`,
        renderMigrationClass(ns, `M${slug}`, slug, [`migrationBuilder.Sql(@"${verbatim(sql)}");`]),
      );
    }
    // The non-transactional unit (`CREATE INDEX CONCURRENTLY`) is a migration
    // of its own, `<slug>_Concurrent`, which EF orders right after `<slug>`
    // (ids sort ordinally) and records in `__EFMigrationsHistory` on its own —
    // so a failed concurrent build never leaves the transactional half applied
    // but unrecorded.  Each statement is its own `suppressTransaction` command:
    // Npgsql sends one command's statements as one batch, which Postgres runs
    // as an implicit transaction.
    if (nonTransactional.length > 0) {
      const id = `${slug}_Concurrent`;
      const calls = nonTransactional
        .flatMap((s) => splitPgStatements(renderPgStep(s)))
        .map((stmt) => `migrationBuilder.Sql(@"${verbatim(stmt)}", suppressTransaction: true);`);
      out.set(`Migrations/${id}.cs`, renderMigrationClass(ns, `M${id}`, id, calls));
    }
  }
}

/** C# verbatim string literal body: `@"..."` allows multi-line; embedded `"`
 *  characters double up to `""` (the renderer quotes every identifier). */
function verbatim(sql: string): string {
  return sql.replace(/"/g, '""');
}

function renderMigrationClass(
  ns: string,
  className: string,
  migrationId: string,
  upCalls: readonly string[],
): string {
  return `// Auto-generated.
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ${ns}.Migrations
{
    // The [DbContext] attribute is REQUIRED for runtime discovery:
    // EF's MigrationsAssembly only surfaces Migration subclasses whose
    // DbContextAttribute matches the context passed to Migrate().
    // Without it, Database.Migrate() finds zero migrations, creates
    // only __EFMigrationsHistory, and every table is silently missing
    // (42P01 at first INSERT/SELECT).  global:: qualifies from the root
    // namespace: this file's namespace ends in .Migrations and some
    // layouts (byFeature, TPH) nest a same-named child namespace, so a
    // relative reference resolves against the wrong scope (CS0234);
    // global:: sidesteps the ambiguity for every namespace.
    [DbContext(typeof(global::${ns}.Infrastructure.Persistence.AppDbContext))]
    [Migration("${migrationId}")]
    public partial class ${className} : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
${upCalls.map((c) => `            ${c}`).join("\n")}
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // No-op.  Down migrations are best-effort and out of scope
            // for v1 — operators roll forward, not back.
        }
    }
}
`;
}
