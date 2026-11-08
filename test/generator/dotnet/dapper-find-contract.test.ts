// ---------------------------------------------------------------------------
// The Dapper repository's single-row contract (audit 2026-08-24, A19): a
// single-row read over a non-key predicate — `Repo.find(C)` — must read the
// FIRST matching row.  The predicate need not be unique, so two matching rows
// are LEGAL data: a strict `QuerySingleOrDefaultAsync` throws
// `InvalidOperationException` → 500, where EF / node / java / python all
// return the first match.  `GetByIdAsync` is keyed on the primary key and
// deliberately keeps the strict single-row read.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const REL_SRC = `
system Shop {
  subdomain Core {
    context Catalog {
      aggregate Product {
        sku: string
        name: string
      }
      repository Products for Product
      criterion ProductsBySku(sku: string) of Product = this.sku == sku
      queryHandler bySku(sku: string): Product? {
        let p = Products.find(ProductsBySku(sku))
        return p
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: Catalog, kind: state, use: pg }
  deployable api {
    platform: dotnet { persistence: dapper }
    contexts: [Catalog]
    dataSources: [st]
    port: 4000
  }
}
`;

describe("dapper repository — single-row contract", () => {
  it("A19: a relational find(C) reads the FIRST row, with the limit pushed to the database", async () => {
    const files = await generateSystemFiles(REL_SRC);
    const handler = files.get("api/Application/Products/Queries/BySkuHandler.cs")!;
    const impl = files.get("api/Infrastructure/Repositories/ProductRepository.cs")!;
    // The call site asks the criterion's retrieval for at most one row and
    // takes the first — never a strict single-row read.
    expect(handler).toContain(
      "var __pHits = await _products.RunFindAllByProductsBySkuAsync(command.Sku, (null, 1), cancellationToken: cancellationToken);",
    );
    expect(handler).toContain("var p = __pHits.Count > 0 ? __pHits[0] : null;");
    // …and the retrieval pushes that limit into the SQL.
    expect(impl).toContain(
      'var sql = "SELECT id, sku, name, version FROM products WHERE (sku = @sku)";',
    );
    expect(impl).toContain(
      'if (pg.limit is { } lim) { sql += " LIMIT @__lim"; p.Add("__lim", lim); }',
    );
    // A second matching row must not be able to throw: the strict single-row
    // read may survive ONLY on the PK-keyed GetById.
    const strict = [
      ...impl.matchAll(/QuerySingleOrDefaultAsync<Row>\(new CommandDefinition\("([^"]*)"/g),
    ];
    expect(strict.map((m) => m[1])).toEqual([
      "SELECT id, sku, name, version FROM products WHERE id = @id",
    ]);
  });
});
