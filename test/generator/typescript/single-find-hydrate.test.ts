// A single-result repository read (`Repo.findBy(<key>: v)`, a `T?` key
// lookup) hydrates the row it already selected instead of re-fetching it via
// `findById(rootRows[0].id)` — dropping a redundant root round-trip on every
// single-row read.  Mirrors the array/paged branches, which already hydrate
// straight from `rootRows`.

import { describe, expect, it } from "vitest";
import { generateHono } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Inventory {
    aggregate Warehouse {
      code: string
      region: string
      unique (code)
      contains bays: Bay[]
      entity Bay { label: string }
    }
    aggregate Sku { name: string  unique (name) }
    repository Warehouses for Warehouse { }
    repository Skus for Sku { }
    queryHandler GetWarehouse(code: string): Warehouse {
      if let x = Warehouses.findBy(code: code) { return x } else { notFound "not_found" }
    }
    queryHandler GetSku(name: string): Sku {
      if let x = Skus.findBy(name: name) { return x } else { notFound "not_found" }
    }
  }
`;

/** The body of `async <name>(` up to the next method. */
function method(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  expect(start, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n  async ", start + 1);
  return src.slice(start, end < 0 ? undefined : end);
}

describe("typescript generator — single-result read hydrates in place", () => {
  it("does NOT re-fetch via findById; hydrates from the selected row", async () => {
    const model = await parseValid(SRC);
    const files = generateHono(model);

    const warehouses = method(files.get("db/repositories/warehouse-repository.ts")!, "findByCode");
    // The redundant re-fetch is gone.
    expect(warehouses).not.toContain("await this.findById(rootRows[0]!.id");
    // The row in hand is hydrated directly, and its containment is bulk-loaded
    // off the same rows (mirroring the array branch).
    expect(warehouses).toContain("const rootIds = rootRows.map((r) => r.id);");
    expect(warehouses).toMatch(/const result = Warehouse\._rehydrate\(\{[\s\S]*rootRows\[0\]!/);
    expect(warehouses).toContain('find: "findByCode", rows: 1');

    // A child-less aggregate becomes a single query (no rootIds / bulk-load).
    const skus = method(files.get("db/repositories/sku-repository.ts")!, "findByName");
    expect(skus).not.toContain("await this.findById(rootRows[0]!.id");
    expect(skus).toMatch(/const result = Sku\._rehydrate\(\{[\s\S]*rootRows\[0\]!/);
    expect(skus).not.toContain("const rootIds");
  });
});
