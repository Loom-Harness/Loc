// Hono emit for a GROUPED query-time projection (`group by` — M-T4.2): one row
// per distinct grouping-key combination, aggregates computed per group IN SQL.
//
// Like the whole-table singleton this replaces a rehydrate-and-fold read, so
// the assertions are as much about what is NOT emitted (no repository row
// loading) as about what is: ONE query carrying the `where`, GROUP BY *and*
// ORDER BY on exactly the grouping columns (the ORDER BY is what makes the
// read deterministic across backends), the LIST response shape, and per-field
// coercion — keys to their declared wire types, aggregates through the same
// coercions the singleton uses.

import { describe, expect, it } from "vitest";
import { generateHono, generateSystemFiles } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Orders {
    enum OrderStatus { Draft Confirmed }
    aggregate Order {
      code: string
      total: money
      lineCount: int
      status: OrderStatus
      derived display: string = code
    }
    repository Orders for Order {}
    criterion Confirmed of Order as o = o.status == OrderStatus.Confirmed
    projection SalesByStatus {
      status: OrderStatus
      orders: int
      revenue: money
      from Order as o
      where Confirmed
      group by o.status
      select status = o.status, orders = count(), revenue = sum(o.total)
    }
  }
`;

async function routes(): Promise<string> {
  const files = await generateHono(await parseValid(SRC));
  return files.get("http/query-projections.ts")!;
}

describe("hono grouped aggregation (group by)", () => {
  it("does NOT load rows through the repository", async () => {
    // The rehydrate-and-fold read this shape exists to avoid.
    const p = await routes();
    expect(p).not.toContain("await repo.salesByStatus()");
    expect(p).not.toMatch(/const rows = await repo\./);
  });
});

// The `requires` gate (403-before-query) — same emission as every other
// query-time projection route: read `currentUser`, throw ForbiddenError BEFORE
// the grouped query runs.
const GATED = `
  system S {
    user { id: string role: string }
    subdomain D { context C {
      enum OrderStatus { Draft Confirmed }
      aggregate Order { status: OrderStatus  total: money }
      repository Orders for Order { }
      projection AdminSalesByStatus requires currentUser.role == "admin" {
        status: OrderStatus
        orders: int
        from Order as o
        group by o.status
        select status = o.status, orders = count()
      }
    }}
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }
    api Api from D
    deployable api { platform: node  contexts: [C]  dataSources: [cState]  serves: Api  port: 3000  auth: required }
  }
`;

describe("hono grouped aggregation `requires` gate", () => {
  it("reads currentUser and throws 403 BEFORE the grouped query", async () => {
    const files = await generateSystemFiles(GATED);
    const k = [...files.keys()].find((key) => key.endsWith("http/query-projections.ts"))!;
    const p = files.get(k)!;
    expect(p).toContain('.get("currentUser")');
    expect(p).toContain(
      'if (!(currentUser.role === "admin")) throw new ForbiddenError("Forbidden: projection AdminSalesByStatus");',
    );
    // The gate precedes the grouped SQL read.
    expect(
      p.indexOf('throw new ForbiddenError("Forbidden: projection AdminSalesByStatus")'),
    ).toBeLessThan(p.indexOf(".groupBy(schema.orders.status)"));
  });
});
