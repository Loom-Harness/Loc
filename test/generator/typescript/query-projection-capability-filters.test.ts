// node/Hono — a query-time projection AGGREGATION carries the source
// aggregate's capability filters (audit A1).
//
// The aggregation shapes (whole-table singleton, `group by`) read the source
// TABLE directly — that is the point of the shape, it materialises no rows — so
// they never pass through the synthesised repository find that ANDs
// `tenantOwned` / `softDeletable` / any `filter <expr>` into every read.  Both
// node adapters applied only the projection's own `where`: a scaffolded
// dashboard on a multi-tenant system reported GLOBAL totals, and with
// `softDeletable` alone the count included rows `findAll` excludes.
//
// WHY A STRING TEST.  `tsc` proves the route compiles; the predicate is the
// whole question and a missing conjunct compiles perfectly.  What is pinned
// here is that the emitted aggregation read carries the SAME predicate the
// aggregate's own repository carries in the same run — including the
// `requireCurrentUser()` principal binding and the `ignoring <Cap>` bypass.

import { describe, expect, it } from "vitest";
import { scopeFn } from "../../_helpers/drizzle-scope.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = (persistence: string) => `
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
      platform: ${persistence}
      contexts: [C, A]
      dataSources: [cState, aState]
      serves: Api
      port: 3000
      auth: required
    }
  }
`;

const cache = new Map<string, Map<string, string>>();
async function files(persistence: string): Promise<Map<string, string>> {
  let f = cache.get(persistence);
  if (!f) {
    f = await generateSystemFiles(SRC(persistence));
    cache.set(persistence, f);
  }
  return f;
}

async function routes(persistence: string): Promise<string> {
  const f = await files(persistence);
  const k = [...f.keys()].find((key) => key.endsWith("http/query-projections.ts"));
  expect(k, "query-projections.ts not emitted").toBeDefined();
  return f.get(k!)!;
}

// The two predicates the source aggregate contributes, as its generated scope
// helper spells them — the aggregation calls the SAME helper the aggregate's own
// repository calls in the same run, so the two cannot disagree.
const DRIZZLE_CAPS = "orderScope()";

describe("node/Hono query-projection aggregations apply the source capability filters", () => {
  it("the WHOLE-TABLE aggregation ANDs the scope helper into the same query as its `where`", async () => {
    const r = await routes("node");
    expect(r).toContain(
      `const [row] = await db.select({ orders: count(), revenue: sum(schema.orders.total) })` +
        `.from(schema.orders).where(and(eq(schema.orders.status, "Confirmed"), ${DRIZZLE_CAPS}));`,
    );
  });

  it("an UNFILTERED aggregation gets the scope helper as its entire WHERE", async () => {
    const r = await routes("node");
    expect(r).toContain(
      `const [row] = await db.select({ total: count() }).from(schema.orders).where(${DRIZZLE_CAPS});`,
    );
  });

  it("the GROUPED aggregation carries it too, before GROUP BY", async () => {
    const r = await routes("node");
    expect(r).toContain(
      `.from(schema.orders).where(${DRIZZLE_CAPS}).groupBy(schema.orders.status)`,
    );
  });

  it("`ignoring softDeletable` passes the clause: the helper drops that conjunct and KEEPS the tenant one", async () => {
    const r = await routes("node");
    expect(r).toContain(
      "const [row] = await db.select({ total: count() }).from(schema.orders)" +
        '.where(orderScope({ ignoring: ["softDeletable"] }));',
    );
    // Each conjunct is guarded by ITS capability: naming `softDeletable` cannot drop the tenant one.
    const scope = scopeFn(await files("node"), "orderScope");
    expect(scope).toContain(
      'drops(use, "tenantOwned") ? undefined : eq(schema.orders.tenantId, requireCurrentUser().tenantId)',
    );
    expect(scope).toContain(
      'drops(use, "softDeletable") ? undefined : not(eq(schema.orders.isDeleted, true))',
    );
  });

  it("binds the principal through the same ambient accessor the repository uses", async () => {
    const f = await files("node");
    const r = await routes("node");
    // The principal predicate renders once, inside the helper both read sites call.
    expect(scopeFn(f, "orderScope")).toContain(
      "eq(schema.orders.tenantId, requireCurrentUser().tenantId)",
    );
    // The aggregation and the repository read in the SAME run call the same helper —
    // a divergence here is the leak.
    const repo = [...f.keys()].find((k) => k.endsWith("repositories/order-repository.ts"));
    expect(f.get(repo!)!).toContain(DRIZZLE_CAPS);
    expect(r).toContain('import { orderScope } from "../db/read-scopes";');
    expect(r).not.toContain("requireCurrentUser");
  });

  it("the MikroORM adapter merges the same filters into the QueryBuilder WHERE", async () => {
    const r = await routes("node { persistence: mikroorm }");
    // Filtered singleton: the projection's own filter AND both capability
    // predicates, through the shared `whereToMikroFilter` lowering.
    expect(r).toContain(
      'qb.where({ $and: [{ status: "Confirmed" }, ' +
        "{ tenantId: requireCurrentUser().tenantId }, { isDeleted: false }] });",
    );
    // Unfiltered singleton + grouped: capabilities only.
    expect(r).toContain(
      "qb.where({ $and: [{ tenantId: requireCurrentUser().tenantId }, { isDeleted: false }] });",
    );
    // `ignoring softDeletable` — one predicate left, so no `$and` wrapper.
    expect(r).toContain("qb.where({ tenantId: requireCurrentUser().tenantId });");
  });
});
