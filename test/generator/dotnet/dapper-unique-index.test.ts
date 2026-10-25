// .NET Dapper backend — `unique (…)` becomes a DB unique index (D5, #3142).
//
// The Dapper adapter used to provision its own schema with `CREATE TABLE IF
// NOT EXISTS`, so a `unique (…)` declaration had no index on it until #3204
// rendered the MigrationsIR's derived unique indexes into that bootstrap.  It
// now applies the shared migration chain itself (M-T2.17,
// `dapper-migrations.ts`), so the index arrives the way EF's does: through the
// one `uniqueIndexesFor` derivation and the one `sql-pg.ts` renderer.  This
// pins that each persistence shape that takes `unique (…)` gets exactly the
// index the EF migration creates, by the same name, after its table.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = (persistence: string) => `
system UqSys {
  subdomain Bank {
    context Ledger {
      aggregate Transfer with crudish {
        reference: string
        source: Account id
        unique (reference)
      }
      aggregate Account with crudish {
        branch: string
        number: string
        unique (branch, number)
      }
      aggregate Card with crudish, softDeletable {
        pan: string
        unique (pan)
      }
      aggregate Ticket with crudish {
        order: int
        unique (order)
      }
      abstract aggregate Party {
        taxId: string
        unique (taxId)
      }
      aggregate Person extends Party with crudish { name: string }
      repository Transfers for Transfer { }
      repository Accounts for Account { }
      repository Cards for Card { }
      repository Tickets for Ticket { }
      repository Persons for Person { }
    }
  }
  api BankApi from Bank
  storage pg { type: postgres }
  resource st { for: Ledger, kind: state, use: pg }
  deployable d {
    platform: dotnet { persistence: ${persistence} }
    contexts: [Ledger]
    dataSources: [st]
    serves: BankApi
    port: 4000
  }
}`;

/** The Dapper Initial migration's SQL, verbatim-literal escaping undone. */
async function dapperInitialSql(): Promise<string> {
  const files = [...(await generateSystemFiles(SOURCE("dapper"))).entries()].filter(
    ([p]) => p.startsWith("d/Migrations/") && p.endsWith("_Initial.cs"),
  );
  expect(files.length, "one Dapper Initial migration").toBe(1);
  return files[0]![1].replace(/""/g, '"');
}

/** Every `CREATE UNIQUE INDEX` line in a DDL text, normalised to bare
 *  identifiers so the two adapters compare by name/columns. */
function uniqueIndexes(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.includes("CREATE UNIQUE INDEX") && l.includes("_uq"))
    .map((l) =>
      l
        .trim()
        .replace(/^@/, "")
        .replace(/"/g, "")
        .replace(/ON ledger\./, "ON ")
        .replace(/;.*$/, ""),
    )
    .sort();
}

describe("Dapper: unique (…) emits a DB unique index", () => {
  it("creates every shape's unique index in its Initial migration, after its table", async () => {
    const sql = await dapperInitialSql();
    // single column
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "transfers_reference_uq" ON "ledger"."transfers" ("reference");',
    );
    // composite
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "accounts_branch_number_uq" ON "ledger"."accounts" ("branch", "number");',
    );
    // softDeletable → partial
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "cards_pan_uq" ON "ledger"."cards" ("pan") WHERE is_deleted = false;',
    );
    // reserved-word column stays quoted
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "tickets_order_uq" ON "ledger"."tickets" ("order");',
    );
    // TPH: the shared base table carries the base's key
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "parties_tax_id_uq" ON "ledger"."parties" ("tax_id");',
    );
    // Each index follows its own CREATE TABLE (the runner applies the
    // statements in order; an index before its table fails the migration).
    for (const [table, index] of [
      ["transfers", "transfers_reference_uq"],
      ["accounts", "accounts_branch_number_uq"],
      ["parties", "parties_tax_id_uq"],
    ]) {
      const create = sql.indexOf(`CREATE TABLE "ledger"."${table}" (`);
      expect(create).toBeGreaterThanOrEqual(0);
      expect(create).toBeLessThan(sql.indexOf(index!));
    }
  });

  it("emits the same unique indexes as the EF migration (one shared derivation)", async () => {
    const dapper = await dapperInitialSql();
    const ef = [...(await generateSystemFiles(SOURCE("efcore"))).entries()]
      .filter(([p]) => p.startsWith("d/Migrations/") && p.endsWith(".cs"))
      .map(([, c]) => c)
      .join("\n");
    const efIdx = uniqueIndexes(ef);
    expect(efIdx.length).toBe(5);
    expect(uniqueIndexes(dapper)).toEqual(efIdx);
  });
});
