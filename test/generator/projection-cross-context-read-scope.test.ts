// A query-time projection may read an aggregate declared in ANOTHER context of
// its subdomain.  Its read must apply the source's own read scope — tenant
// floor, `softDeletable`, the projection's `ignoring` — exactly as a projection
// declared beside the source would, because the scope, the table and the
// schema module all belong to the source's HOME context.
//
// java, elixir and .NET emit projections per context, so they resolve the
// source through `ProjectionQueryIR.sourceContext`
// (`src/ir/util/projection-source.ts`) rather than by name in the projection's
// own context, where it is not declared.  node and python read one merged
// context per deployable; they are pinned here too so the five agree.
//
// The per-row (repository-sourced) arm is exercised on java and elixir only:
// node, python and .NET refuse it cross-context
// (`loom.projection-cross-context-source-unsupported`).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/projection-cross-context-scope.ddd"),
  "utf8",
);

/** The corpus fixture plus a per-row projection reading the source row by row. */
const PER_ROW = FIXTURE.replace(
  "    context Reports {\n",
  `    context Reports {
      projection LargeOrders {
        code: string
        total: int
        from Order as o
        where o.total > 100
        select code = o.code, total = o.total
      }
`,
);

const generate = (platform: string, source = FIXTURE): Promise<Map<string, string>> =>
  generateSystemFiles(source.replace("__PLATFORM__", platform));

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

describe("cross-context query-time projection — elixir", () => {
  it("reads the source through its HOME context's scoped schema", async () => {
    const files = await generate("elixir", PER_ROW);
    const all = [...files.values()].join("\n");
    expect(all).not.toContain("D.Reports.Order");
    for (const [mod, terminal] of [
      ["volume", "Repo.one(current_user: current_user)"],
      ["volume_by_code", "Repo.all(current_user: current_user)"],
      ["large_orders", "Repo.all(current_user: current_user)"],
      ["all_time_volume", "Repo.one(current_user: current_user, skip_filters: [:soft_deletable])"],
    ] as const) {
      const src = file(files, `lib/d/reports/query_projections/${mod}.ex`);
      expect(src, mod).toContain("from(record in D.Orders.Order.base_query()");
      expect(src, mod).toContain(`|> ${terminal}`);
    }
    // The scoped schema those reads start from carries the tenant floor.
    const order = file(files, "lib/d/orders/order.ex");
    expect(order).toContain("record.tenant_id == ^(current_user && current_user.tenant_id)");
  });
});

describe("cross-context query-time projection — java", () => {
  it("synthesises the per-row source find on the HOME context's repository", async () => {
    const files = await generate("java", PER_ROW);
    const svc = file(files, "application/views/ReportsQueryProjections.java");
    expect(svc).toContain("ordersRepository.largeOrders()");
    const jpa = file(files, "features/orders/OrderJpaRepository.java");
    expect(jpa).toContain('@Query("select e from Order e where e.total > 100")');
    expect(jpa).toContain("List<Order> largeOrders();");
  });

  it("runs the aggregations under the entity's tenant filter and disables only the ignored capability", async () => {
    const files = await generate("java");
    const order = file(files, "features/orders/Order.java");
    expect(order).toContain(
      '@Filter(name = "Order_tenantOwned", condition = "tenant_id = :__cuTenantId")',
    );
    // `ignoring softDeletable` in `Reports` promotes the capability to a named,
    // disableable filter on the `Orders` entity.
    expect(order).toContain('@Filter(name = "softDeletable", condition = "not (is_deleted)")');
    expect(order).not.toContain("@SQLRestriction");
    const svc = file(files, "application/views/ReportsQueryProjections.java");
    const allTime = svc.slice(svc.indexOf("allTimeVolume()"));
    expect(allTime).toContain('__session.disableFilter("softDeletable");');
    expect(svc).not.toContain('disableFilter("Order_tenantOwned")');
  });
});

describe("cross-context query-time projection — .NET", () => {
  it("dapper ANDs the HOME aggregate's tenant and not-deleted predicates into the SQL", async () => {
    const files = await generate("dotnet { persistence: dapper }");
    const volume = file(files, "Application/Projections/VolumeQpHandler.cs");
    expect(volume).toMatch(/WHERE .*tenant_id/);
    expect(volume).toMatch(/NOT \(?"?is_deleted/i);
    const allTime = file(files, "Application/Projections/AllTimeVolumeQpHandler.cs");
    expect(allTime).toMatch(/WHERE .*tenant_id/);
    expect(allTime).not.toMatch(/is_deleted/i);
  });

  it("efcore drops only the ignored capability's named filter", async () => {
    const files = await generate("dotnet");
    const allTime = file(files, "Application/Projections/AllTimeVolumeQpHandler.cs");
    expect(allTime).toContain(".IgnoreQueryFilters([");
    expect(allTime).not.toMatch(/IgnoreQueryFilters\(\[[^\]]*tenant/i);
  });
});

describe("cross-context query-time projection — merged-context backends", () => {
  it("node applies the source's read scope to every direct-table read", async () => {
    const qp = file(await generate("node"), "http/query-projections.ts");
    expect(qp).toContain(".from(schema.orders).where(orderScope())");
    expect(qp).toContain('.where(orderScope({ ignoring: ["softDeletable"] }))');
  });

  it("python reads the source row with the `ignoring` execution option", async () => {
    const qp = file(await generate("python"), "http/query_projections_routes.py");
    expect(qp).toContain('execution_options(loom_ignoring=frozenset({"softDeletable"}))');
  });
});
