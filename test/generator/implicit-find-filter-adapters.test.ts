// A clause-less find filters by its implicit key match on the NON-default
// persistence adapters too — `persistence: dapper` (.NET) and `persistence:
// mikroorm` (node).  Both used to branch on the declared `where` alone, so
// `find byReference(reference: string): WorkOrder?` read every row: `LIMIT 1`
// over the whole table on Dapper, `em.findOne(Row, {})` on MikroORM — a miss
// answered 200 with some other row.  The pairing is the shared
// `implicitFindMatches` rule (same-named field, or `<field>Id` → `field`).
// The Java twin is `java/java-implicit-find-filter.test.ts`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system FieldOps {
  subdomain Ops {
    context Ops {
      aggregate Site with crudish { name: string }
      repository Sites for Site { }
      aggregate WorkOrder with crudish {
        reference: string
        region: string
        site: Site id
      }
      repository WorkOrders for WorkOrder {
        find byReference(reference: string): WorkOrder?
        find byRegionAndRef(region: string, reference: string): WorkOrder?
        find bySite(siteId: Site id): WorkOrder?
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

describe("dapper — a clause-less find applies its implicit key-match filter", () => {
  it("single, multi-param and `<field>Id` carry the WHERE", async () => {
    const r = await repoFile(
      "dotnet { persistence: dapper }",
      "Infrastructure/Repositories/WorkOrderRepository.cs",
    );
    const cols = "SELECT id, reference, region, site, version FROM work_orders";
    expect(r).toContain(`"${cols} WHERE (reference = @reference) LIMIT 1"`);
    expect(r).toContain(
      `"${cols} WHERE ((region = @region) AND (reference = @reference)) LIMIT 1"`,
    );
    expect(r).toContain(`"${cols} WHERE (site = @siteId) LIMIT 1", new { siteId = siteId.Value }`);
  });
});

describe("mikroorm — a clause-less find applies its implicit key-match filter", () => {
  it("single, multi-param and `<field>Id` carry the filter", async () => {
    const r = await repoFile(
      "node { persistence: mikroorm }",
      "db/repositories/workOrder-repository.ts",
    );
    expect(r).toContain("em.findOne(WorkOrderRow, { reference: reference });");
    expect(r).toContain("em.findOne(WorkOrderRow, { region: region, reference: reference });");
    expect(r).toContain("em.findOne(WorkOrderRow, { site: siteId });");
  });
});
