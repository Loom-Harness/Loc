// .NET Dapper (persistence: dapper) applies the shared MigrationsIR chain
// (D-DAPPER-ALTER).
//
// What this file pins, at the emission level (the runtime proof is the
// migration-evolution `dapper` leg, `test:migration-evolution-dapper`):
//
//   - the chain is emitted as versioned `Migrations/<version>_<Module>_<Name>.cs`
//     classes (the id EF gives the same migration), rendered by `sql-pg.ts`;
//   - the `CREATE TABLE IF NOT EXISTS` bootstrap is gone — `DbSchema.cs` is the
//     runner: `public.__loom_migrations`, one transaction per migration, an
//     advisory lock, and no legacy-bootstrap baseline;
//   - the steps are the shared steps, statement for statement (the layout
//     equality itself is `test/system/shared-database-layout-census.test.ts`);
//   - the connection's `search_path` names the schemas the tables land in.

import { describe, expect, it } from "vitest";
import { generateEvolvedSystemFiles, generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = (persistence: string) => `
system Dm {
  subdomain Sales {
    context Orders {
      valueobject Money { amount: int  currency: string }
      enum Kind { A, B }
      aggregate Order with crudish {
        code: string
        total: Money
        discount: Money?
        tags: string[]
        kinds: Kind[]
        charges: Money[]
        unique (code)
      }
      repository Orders for Order { }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d {
    platform: dotnet { persistence: ${persistence} }
    contexts: [Orders]
    dataSources: [s]
    serves: A
    port: 4000
  }
}`;

const unverb = (s: string) => s.replace(/""/g, '"');

describe("Dapper: the migration chain, emitted", () => {
  it("emits a versioned migration class per generation and a runner in place of the bootstrap", async () => {
    const files = await generateSystemFiles(SOURCE("dapper"));
    const migrations = [...files.keys()].filter((p) => p.startsWith("d/Migrations/"));
    expect(migrations).toEqual(["d/Migrations/20260101000000_Sales_Initial.cs"]);
    const initial = files.get(migrations[0]!)!;
    expect(initial).toContain(
      "public sealed class M20260101000000_Sales_Initial : global::D.Infrastructure.Persistence.LoomMigration",
    );
    expect(initial).toContain('public override string Id => "20260101000000_Sales_Initial";');
    // No database predates the chain, so nothing is baselined: an Initial
    // carries no table list and the runner never adopts existing tables.
    expect(initial).not.toContain("CreatesTables");

    const runner = files.get("d/Infrastructure/Persistence/DbSchema.cs")!;
    expect(runner).not.toContain("CREATE TABLE IF NOT EXISTS orders");
    expect(runner).toContain("public.__loom_migrations");
    expect(runner).toContain("pg_advisory_lock");
    expect(runner).toContain("pg_advisory_unlock");
    expect(runner).toContain("BeginTransactionAsync");
    expect(runner).toContain("INSERT INTO public.__loom_migrations (tag) VALUES (@tag)");
    expect(runner).not.toContain("BaselineLegacyAsync");
    expect(runner).not.toContain("CreatesTables");
    expect(runner).not.toContain("SET SCHEMA");

    const program = files.get("d/Program.cs")!;
    expect(program).toContain('SearchPath = "public,orders"');
    expect(program).toMatch(
      /DbSchema\.EnsureAsync\(\s*app\.Services\.GetRequiredService<NpgsqlDataSource>\(\),/,
    );
    // EF's migrator must not also run on the Dapper path.
    expect(program).not.toContain("Database.Migrate()");
  });

  it("leaves the EF adapter's output alone — still EF migrations, no runner", async () => {
    const files = await generateSystemFiles(SOURCE("efcore"));
    expect(files.has("d/Infrastructure/Persistence/DbSchema.cs")).toBe(false);
    const ef = files.get("d/Migrations/20260101000000_Sales_Initial.cs")!;
    expect(ef).toContain("migrationBuilder.Sql(");
    expect(unverb(ef)).toContain('"total_amount"');
  });

  it("a field added to a live aggregate is an ALTER in the next generation's file", async () => {
    // Generation 1 deploys `Order`; generation 2 adds `note: string = ""`.
    // The deployed database only ever sees the second file's statements, so
    // the column must arrive as an ALTER with the declared default — editing
    // the Initial's CREATE TABLE would leave the live table without it.
    const before = SOURCE("dapper");
    const after = before.replace("code: string\n", 'code: string\n        note: string = ""\n');
    expect(after).not.toBe(before);
    const files = await generateEvolvedSystemFiles([before, after]);
    const migrations = [...files.keys()].filter((p) => p.startsWith("d/Migrations/")).sort();
    expect(migrations).toHaveLength(2);
    const initial = unverb(files.get(migrations[0]!)!);
    const gen1 = unverb(files.get(migrations[1]!)!);
    expect(initial).not.toContain('"note"');
    expect(gen1).toContain(
      `ALTER TABLE "orders"."orders" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';`,
    );
  });
});
