import { describe, expect, it } from "vitest";
import { aggregateTableName, associationTables } from "../../src/ir/enrich/storage-names.js";
import type { AggregateIR, AssociationIR } from "../../src/ir/types/loom-ir.js";
import { routeSegmentFor, tableNameFor } from "../../src/util/storage-names.js";

describe("storage names", () => {
  it.each([
    // A trailing acronym: snake(plural(n)) would split it (`product_sk_us`).
    ["ProductSKU", "product_skus"],
    ["StockPerSKU", "stock_per_skus"],
    // A leading acronym: both compositions agree; the spelling must not move.
    ["HTTPLog", "http_logs"],
    ["URLAlias", "url_aliases"],
    // The ordinary plural rules.
    ["Order", "orders"],
    ["Category", "categories"],
    ["WorkOrder", "work_orders"],
    ["Box", "boxes"],
  ])("%s → %s, for its table and its route alike", (name, expected) => {
    expect(tableNameFor(name)).toBe(expected);
    expect(routeSegmentFor(name)).toBe(expected);
  });

  it("a TPH concrete's table is its root base's; its owner FK in a join table follows", () => {
    const base = { name: "CatalogSKU", isAbstract: true } as unknown as AggregateIR;
    const concrete = {
      name: "PhysicalSKU",
      extendsAggregate: "CatalogSKU",
    } as unknown as AggregateIR;
    const pool = [base, concrete];
    expect(aggregateTableName(concrete, pool)).toBe(aggregateTableName(base, pool));
    const assoc = {
      ownerAgg: "PhysicalSKU",
      targetAgg: "URLAlias",
      joinTable: "physical_sku_aliases",
    } as AssociationIR;
    expect(associationTables(assoc, pool)).toEqual({
      joinTable: "physical_sku_aliases",
      ownerTable: "catalog_skus",
      targetTable: "url_aliases",
    });
  });
});
