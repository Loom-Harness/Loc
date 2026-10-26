// Java/Spring Boot — a query-time projection AGGREGATION carries the source
// aggregate's capability filters (audit A1).
//
// Every capability filter — tenancy included — is the entity's: the
// never-bypassed ones its `@SQLRestriction`, the rest auto-enabled `@Filter`s
// (tenancy's binding the claim through a per-query `@ParamDef` resolver).
// Hibernate applies both to the `EntityManager.createQuery` JPQL an
// aggregation runs, so the aggregation names only its own `where`, and a read
// that `ignoring`s a capability disables that capability's filters for itself.
// Before, the aggregation emitted no tenant predicate at all — a cross-tenant
// COUNT/SUM (audit A1); `test/ir/authz-emitted-census.test.ts` re-seeds it.

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
      platform: java
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

async function service(): Promise<string> {
  const f = await files();
  const k = [...f.keys()].find((key) => key.endsWith("views/CQueryProjections.java"));
  expect(k, "CQueryProjections.java not emitted").toBeDefined();
  return f.get(k!)!;
}

describe("java query-projection aggregations apply the source capability filters", () => {
  it("the aggregations name only their own `where`; the tenant filter is the entity's", async () => {
    const src = await service();
    expect(src).toContain(
      '"select count(e), sum(e.total) from Order e where e.status = com.loom.d.domain.enums.OrderStatus.Confirmed"',
    );
    expect(src).toContain('"select count(e) from Order e"');
    expect(src).toContain(
      '"select e.status, count(e) from Order e group by e.status order by e.status"',
    );
    expect(src).not.toMatch(/tenantId|currentUserAccessor|CurrentUserAccessor/);
    const f = await files();
    const entity = [...f.keys()].find((k) => k.endsWith("orders/Order.java"));
    expect(f.get(entity!)!).toContain(
      '@Filter(name = "Order_tenantOwned", condition = "tenant_id = :__cuTenantId")',
    );
  });

  it("`ignoring softDeletable` disables that filter for that read only", async () => {
    const src = await service();
    expect(src).toContain("public AllTimeVolumeRow allTimeVolume() {");
    expect(src).toContain("var __session = entityManager.unwrap(org.hibernate.Session.class);");
    expect(src).toContain('__session.disableFilter("softDeletable");');
    expect(src).toContain('__session.enableFilter("softDeletable");');
    // The tenant filter it did NOT name stays enabled.
    expect(src).not.toContain('disableFilter("Order_tenantOwned")');
    // The non-bypassing reads must not disable anything.
    expect(src.match(/disableFilter/g)?.length).toBe(1);
    const f = await files();
    const entity = [...f.keys()].find((k) => k.endsWith("orders/Order.java"));
    expect(f.get(entity!)!).toContain(
      '@Filter(name = "softDeletable", condition = "not (is_deleted)")',
    );
  });
});
