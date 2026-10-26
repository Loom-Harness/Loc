// Python/FastAPI — a query-time projection AGGREGATION applies the source
// aggregate's read restrictions (audit A1).
//
// The aggregation shapes read the source TABLE directly (`select(func.count())
// .select_from(OrderRow)`), never through a repository.  The read-scope hook
// (`app/db/read_scope.py`) adds the aggregate's restrictions to every ORM
// SELECT of its row class — a `select_from` included — so the aggregation
// counts the rows its `.all` lists: no cross-tenant COUNT under
// `tenantOwned`, no soft-deleted rows under `softDeletable`.  Pinned here: the
// aggregation spells only its own `where`, the hook hosts the restrictions,
// and `ignoring` rides the hook's execution option.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
  system S {
    user { id: guid  tenantId: string }
    tenancy by user.tenantId of Organization
    subdomain D {
      context C {
        enum OrderStatus { Draft Confirmed }
        aggregate Order with tenantOwned, softDeletable, crudish {
          code: string
          total: money
          status: OrderStatus
          derived display: string = code
        }
        repository Orders for Order { }
        criterion Confirmed of Order as o = o.status == OrderStatus.Confirmed

        projection SalesTotals {
          orders: int
          revenue: money
          from Order as o
          where Confirmed
          select orders = count(), revenue = sum(o.total)
        }
        projection OrderVolume {
          total: int
          from Order as o
          select total = count()
        }
        projection SalesByStatus {
          status: OrderStatus
          orders: int
          from Order as o
          group by o.status
          select status = o.status, orders = count()
        }
        projection AllTimeVolume {
          total: int
          from Order as o
          ignoring softDeletable
          select total = count()
        }
      }
      context A { aggregate Organization with crudish { name: string } }
    }
    api Api from D
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }
    resource aState { for: A, kind: state, use: primary }
    deployable d {
      platform: python
      contexts: [C, A]
      dataSources: [cState, aState]
      serves: Api
      port: 4000
      auth: required
    }
  }
`;

let cache: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  cache ??= await generateSystemFiles(SRC);
  return cache;
}

async function routes(): Promise<string> {
  const f = await files();
  const k = [...f.keys()].find((key) => key.endsWith("http/query_projections_routes.py"));
  expect(k, "query_projections_routes.py not emitted").toBeDefined();
  return f.get(k!)!;
}

describe("python query-projection aggregations ride the read-scope hook", () => {
  it("the WHOLE-TABLE aggregation spells only its own `where`", async () => {
    const r = await routes();
    expect(r).toContain(
      "select(func.count(), func.sum(OrderRow.total)).select_from(OrderRow)" +
        ".where((OrderRow.status == OrderStatus.Confirmed))",
    );
    expect(r).not.toContain("tenant_id");
    expect(r).not.toContain("is_deleted");
  });

  it("an UNFILTERED aggregation and the GROUPED one carry no WHERE of their own", async () => {
    const r = await routes();
    expect(r).toContain("select(func.count()).select_from(OrderRow))).one()");
    expect(r).toContain(".group_by(OrderRow.status)");
  });

  it("`ignoring softDeletable` names the capability the hook drops", async () => {
    const r = await routes();
    expect(r).toContain(
      'select(func.count()).select_from(OrderRow).execution_options(loom_ignoring=frozenset({"softDeletable"}))',
    );
  });

  it("the hook hosts the tenant floor and the soft-delete filter, each bypassable by its own name", async () => {
    const f = await files();
    const scope = f.get([...f.keys()].find((k) => k.endsWith("app/db/read_scope.py"))!)!;
    expect(scope).toContain('if not _bypassed("tenantOwned", ignoring):');
    expect(scope).toContain(
      "with_loader_criteria(OrderRow, (OrderRow.tenant_id == user.tenant_id), include_aliases=True)",
    );
    expect(scope).toContain('if not _bypassed("softDeletable", ignoring):');
    expect(scope).toContain(
      "with_loader_criteria(OrderRow, lambda cls: not_(cls.is_deleted), include_aliases=True)",
    );
  });
});
