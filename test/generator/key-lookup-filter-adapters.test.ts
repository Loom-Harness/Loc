// A natural-key read (`Repo.findBy(<col>: v, …)` over a declared `unique (…)`)
// filters on exactly its key columns on the NON-default persistence adapters
// too — `persistence: dapper` (.NET) and `persistence: mikroorm` (node).  A
// lookup that dropped its WHERE would read `LIMIT 1` over the whole table on
// Dapper, `em.findOne(Row, {})` on MikroORM — a miss answered 200 with some
// other row.  Covered: a single column, a two-column tuple, and an `X id`
// column (bound through the id's `.Value` on Dapper).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system FieldOps {
  subdomain Ops {
    context Ops {
      aggregate Site with crudish { name: string }
      repository Sites for Site
      aggregate WorkOrder with crudish {
        reference: string
        region: string
        site: Site id
        unique (reference)
        unique (region, reference)
        unique (site)
      }
      repository WorkOrders for WorkOrder
      queryHandler ByRef(reference: string): WorkOrder {
        if let w = WorkOrders.findBy(reference: reference) { return w } else { notFound }
      }
      queryHandler ByRegionAndRef(region: string, reference: string): WorkOrder {
        if let w = WorkOrders.findBy(region: region, reference: reference) { return w } else { notFound }
      }
      queryHandler BySite(site: Site id): WorkOrder {
        if let w = WorkOrders.findBy(site: site) { return w } else { notFound }
      }
    }
  }
  api OpsApi from Ops
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  deployable app { platform: ${platform}, contexts: [Ops], dataSources: [st], serves: OpsApi, port: 4000 }
}
`;

async function repoFile(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, suffix).toBeDefined();
  return files.get(key!)!;
}

describe("dapper — a natural-key read filters on its key columns", () => {
  it("single, multi-column and `X id` keys carry the WHERE", async () => {
    const r = await repoFile(
      "dotnet { persistence: dapper }",
      "Infrastructure/Repositories/WorkOrderRepository.cs",
    );
    const cols = "SELECT id, reference, region, site, version FROM work_orders";
    expect(r).toContain(`"${cols} WHERE (reference = @reference) LIMIT 1"`);
    expect(r).toContain(
      `"${cols} WHERE ((region = @region) AND (reference = @reference)) LIMIT 1"`,
    );
    expect(r).toContain(`"${cols} WHERE (site = @site) LIMIT 1", new { site = site.Value }`);
  });
});

describe("mikroorm — a natural-key read filters on its key columns", () => {
  it("single, multi-column and `X id` keys carry the filter", async () => {
    const r = await repoFile(
      "node { persistence: mikroorm }",
      "db/repositories/workOrder-repository.ts",
    );
    expect(r).toContain("em.findOne(WorkOrderRow, { reference: reference });");
    expect(r).toContain("em.findOne(WorkOrderRow, { region: region, reference: reference });");
    expect(r).toContain("em.findOne(WorkOrderRow, { site: site });");
  });
});
