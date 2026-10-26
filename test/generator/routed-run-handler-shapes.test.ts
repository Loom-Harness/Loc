// A routed queryHandler over `Repo.run(<Criterion>(…))` — the read a removed
// list find migrates to — compiles on node and .NET.
//
//   node: a path token is text, so a `datetime` / `money` / enum param is
//     parsed by the query-value schema; `z.string()` handed the raw text to a
//     repository method typed `Date` / `Decimal` / the enum (TS2345).
//   .NET: the run binding is the repository's `IReadOnlyList<T>` while the
//     Mediator record returns `List<T>` (CS0266), and the handler must inject
//     the repository the run reads (CS0103 on `_orders`).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

const src = (platform: string) => `
system Shop {
  subdomain S {
    context Sales {
      enum Status { Open Closed }
      aggregate Order with crudish {
        status: Status
        placedAt: datetime
        total: money
      }
      repository Orders for Order { }
      criterion OrdersByStatus(s: Status) of Order = this.status == s
      criterion OrdersPlacedBefore(t: datetime) of Order = this.placedAt < t
      criterion OrdersOver(m: money) of Order = this.total > m
      queryHandler ListOrdersByStatus(s: Status): Order[] {
        let r = Orders.run(OrdersByStatus(s))
        return r
      }
      queryHandler ListOrdersPlacedBefore(t: datetime): Order[] {
        let r = Orders.run(OrdersPlacedBefore(t))
        return r
      }
      queryHandler ListOrdersOver(m: money): Order[] {
        let r = Orders.run(OrdersOver(m))
        return r
      }
    }
  }
  api ShopApi from S {
    route GET "/orders/by_status/{s}" -> Sales.ListOrdersByStatus
    route GET "/orders/placed_before/{t}" -> Sales.ListOrdersPlacedBefore
    route GET "/orders/over/{m}" -> Sales.ListOrdersOver
  }
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [Sales] dataSources: [st] serves: ShopApi port: 4000 }
}
`;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

describe("routed Repo.run handlers", () => {
  it("node: typed path tokens parse to the domain type", async () => {
    const routes = fileEndingWith(await generateSystemFiles(src("node")), "http/shopApi-routes.ts");
    expect(routes).toContain('params: z.object({ s: z.enum(["Open", "Closed"]) })');
    expect(routes).toContain("params: z.object({ t: z.coerce.date() })");
    expect(routes).toContain("params: z.object({ m: moneySchema })");
    expect(routes).toContain('import { moneySchema } from "../lib/schemas";');
  });

  it(".NET: the handler injects the run's repository and returns a List", async () => {
    const h = fileEndingWith(
      await generateSystemFiles(src("dotnet")),
      "Application/Orders/Queries/ListOrdersByStatusHandler.cs",
    );
    expect(h).toContain("private readonly IOrderRepository _orders;");
    expect(h).toContain("return r.ToList();");
  });

  it(".NET: a non-relational carrier reads a paged criterion in memory, with no Run method", async () => {
    const files = await generateSystemFiles(corpusSourceFor("paged-nonrelational", "dotnet"));
    // Document: LINQ-to-objects takes a Func, so the criterion's query face is
    // compiled (CS1503 on the bare Expression).
    expect(fileEndingWith(files, "Repositories/InvoiceRepository.cs")).toContain(
      "new InvoicesInRegionCriterion(region).ToExpression().Compile())",
    );
    // Event log: the interface promises no `Run…Async` its impl lacks (CS0535).
    expect(fileEndingWith(files, "IAccountRepository.cs")).not.toContain("RunFindAllBy");
  });
});
