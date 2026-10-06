// .NET Dapper backend — `unique (…)` becomes a DB unique index (D5, #3142).
//
// The Dapper adapter does not run migrations; `DbSchema.cs` writes its own
// `CREATE TABLE IF NOT EXISTS` per aggregate at startup.  It used to stop
// there, so a `unique (…)` declaration had no index on this adapter: a
// duplicate insert succeeded, and the 23505 → 409 mapping in
// `DomainExceptionFilter` (pinned in `dotnet-unique-conflict.test.ts`) had
// nothing to fire on.  The bootstrap now renders the MigrationsIR's derived
// unique indexes (`uniqueIndexesFor` in the migrations builder), so this pins
// that each persistence shape that takes `unique (…)` gets exactly the index
// the EF migration creates, by the same name.

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

const SCHEMA = "d/Infrastructure/Persistence/DbSchema.cs";

/** Every `CREATE UNIQUE INDEX` line in a DDL text, normalised to bare
 *  identifiers (the Dapper verbatim literal doubles quotes; EF's migration
 *  quotes and schema-qualifies) so the two adapters compare by name/columns. */
function uniqueIndexes(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.includes("CREATE UNIQUE INDEX") && l.includes("_uq"))
    .map((l) =>
      l
        .trim()
        .replace(/"/g, "")
        .replace(/IF NOT EXISTS /, "")
        .replace(/ON ledger\./, "ON ")
        .replace(/;.*$/, ""),
    )
    .sort();
}

describe("Dapper: unique (…) emits a DB unique index", () => {
  it("renders every shape's unique index into DbSchema.cs, after its table", async () => {
    const schema = (await generateSystemFiles(SOURCE("dapper"))).get(SCHEMA)!;
    expect(schema, "DbSchema.cs missing").toBeTruthy();
    // single column
    expect(schema).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ""transfers_reference_uq"" ON ""transfers"" (""reference"");',
    );
    // composite
    expect(schema).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ""accounts_branch_number_uq"" ON ""accounts"" (""branch"", ""number"");',
    );
    // softDeletable → partial
    expect(schema).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ""cards_pan_uq"" ON ""cards"" (""pan"") WHERE is_deleted = false;',
    );
    // reserved-word column stays quoted
    expect(schema).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ""tickets_order_uq"" ON ""tickets"" (""order"");',
    );
    // TPH: the shared base table carries the base's key
    expect(schema).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ""parties_tax_id_uq"" ON ""parties"" (""tax_id"");',
    );
    // Each index follows its own CREATE TABLE (DbSchema runs statement by
    // statement; an index before its table fails the bootstrap).
    for (const [table, index] of [
      ["transfers", "transfers_reference_uq"],
      ["accounts", "accounts_branch_number_uq"],
      ["parties", "parties_tax_id_uq"],
    ]) {
      expect(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)).toBeGreaterThanOrEqual(0);
      expect(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)).toBeLessThan(
        schema.indexOf(index),
      );
    }
  });

  it("emits the same unique indexes as the EF migration (one shared derivation)", async () => {
    const dapper = (await generateSystemFiles(SOURCE("dapper"))).get(SCHEMA)!;
    const ef = [...(await generateSystemFiles(SOURCE("efcore"))).entries()]
      .filter(([p]) => p.startsWith("d/Migrations/") && p.endsWith(".cs"))
      .map(([, c]) => c)
      .join("\n");
    const efIdx = uniqueIndexes(ef);
    expect(efIdx.length).toBe(5);
    expect(uniqueIndexes(dapper)).toEqual(efIdx);
  });
});
