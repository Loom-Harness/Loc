// A `commandHandler` / `queryHandler` named like one of the aggregate's auto
// CQRS slices on .NET — `All` (the paged list), `GetOrderById` (the by-id read),
// `CreateOrder` / `DestroyOrder` / `Update` / an operation's `<Op>` command.
//
// The handler's record lands on the auto slice's path
// (`Application/Orders/Queries/AllQuery.cs`).  When it can stand in for the
// auto record — same parameter types, same result — it supersedes it (the
// scaffolded `CreateOrder` case).  When it cannot, superseding left the auto
// controller sending a record that no longer exists:
// `new AllQuery(page, pageSize, sort, dir)` against `record AllQuery()` —
// CS1729.  Such a handler's types take the `<Name>Entry` stem instead, so both
// slices stand.
//
// The oracle is arity: every `new <Record>(…)` a generated controller sends
// must name a record declared with that many positional parameters.  The other
// four backends name a handler's files apart from the auto CRUD surface; their
// write-once emission sink fails generation on any path collision, so a clean
// generation is their check.

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (platform: string) => `
system S {
  subdomain D { context Shop {
    aggregate Order with crudish {
      code: string  n: int
      operation bump(by: int) { n := n + by }
    }
    repository Orders for Order { }
    criterion NonNegative of Order = this.n >= 0
    queryHandler GetOrderById(orderId: Order id): Order { let o = Orders.get(orderId) return o }
    queryHandler All(): Order[] { let r = Orders.all(NonNegative()) return r }
    commandHandler Bump(orderId: Order id, by: int, extra: string) { let o = Orders.get(orderId)  o.bump(by) }
    commandHandler Update(orderId: Order id) { let o = Orders.get(orderId)  o.bump(1) }
    commandHandler DestroyOrder(orderId: Order id, why: string) { let o = Orders.get(orderId)  Orders.remove(o) }
    commandHandler CreateOrder(code: string, n: int): Order id { let o = Order.create(code: code, n: n) return o.id }
  }}
  api A from D {
    route GET "/x/{orderId}" -> Shop.GetOrderById
    route GET "/all2" -> Shop.All
    route POST "/b/{orderId}" -> Shop.Bump
    route POST "/u/{orderId}" -> Shop.Update
    route POST "/d/{orderId}" -> Shop.DestroyOrder
    route POST "/c" -> Shop.CreateOrder
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
}
`;

/** Every record a generated C# file declares, by name → positional arity. */
function declaredRecords(files: Map<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [path, content] of files) {
    if (!path.endsWith(".cs")) continue;
    for (const m of content.matchAll(/public sealed record (\w+)\(([^)]*)\)/g)) {
      out.set(m[1]!, m[2]!.trim() === "" ? 0 : m[2]!.split(",").length);
    }
  }
  return out;
}

/** Top-level argument count of the call starting right after `(` at `from`. */
function arityAt(text: string, from: number): number {
  let depth = 0;
  let args = 0;
  let any = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "<" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === ">" || ch === "]" || ch === "}") {
      if (depth === 0) return any ? args + 1 : 0;
      depth--;
    } else if (ch === "," && depth === 0) args++;
    else if (!/\s/.test(ch)) any = true;
  }
  return -1;
}

describe("dotnet: a handler named like an auto CQRS slice", () => {
  let files: Map<string, string>;
  beforeAll(async () => {
    files = await generateSystemFiles(SRC("dotnet"));
  }, 120_000);

  it("every record a controller sends is declared with that arity", () => {
    const records = declaredRecords(files);
    const mismatches: string[] = [];
    for (const [path, content] of files) {
      if (!path.startsWith("d/Api/") || !path.endsWith("Controller.cs")) continue;
      for (const m of content.matchAll(/new (\w+(?:Query|Command))\(/g)) {
        const name = m[1]!;
        const sent = arityAt(content, m.index! + m[0].length);
        const declared = records.get(name);
        if (declared !== sent)
          mismatches.push(`${path}: new ${name}(…${sent}) vs record ${declared}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("keeps the auto slice and gives the handler the <Name>Entry stem", () => {
    expect(files.get("d/Application/Orders/Queries/AllQuery.cs")).toContain(
      "public sealed record AllQuery(int Page, int PageSize, string Sort, string Dir)",
    );
    expect(files.get("d/Application/Orders/Queries/AllEntryQuery.cs")).toContain(
      "public sealed record AllEntryQuery() : IQuery<List<Order>>;",
    );
    expect(files.get("d/Application/Orders/Queries/AllEntryHandler.cs")).toContain(
      "public sealed class AllEntryHandler : IQueryHandler<AllEntryQuery, List<Order>>",
    );
    expect(files.get("d/Application/Orders/Queries/GetOrderByIdQuery.cs")).toContain(
      "IQuery<OrderResponse?>",
    );
    expect(files.has("d/Application/Orders/Queries/GetOrderByIdEntryQuery.cs")).toBe(true);
    const routes = files.get("d/Api/ARoutesController.cs")!;
    expect(routes).toContain("new AllEntryQuery()");
    expect(routes).toContain("new GetOrderByIdEntryQuery(");
    expect(routes).toContain("new DestroyOrderEntryCommand(");
    expect(routes).toContain("new UpdateEntryCommand(");
    expect(routes).toContain("new BumpEntryCommand(");
  });

  it("supersedes an auto slice the handler's record can stand in for", () => {
    // `CreateOrder(code: string, n: int): Order id` takes the auto create's
    // parameter types and answers its result, so it replaces it.
    expect(files.get("d/Application/Orders/Commands/CreateOrderCommand.cs")).toContain(
      "public sealed record CreateOrderCommand(string Code, int N) : ICommand<OrderId>;",
    );
    expect(files.has("d/Application/Orders/Commands/CreateOrderEntryCommand.cs")).toBe(false);
    expect(files.get("d/Application/Orders/Commands/CreateOrderHandler.cs")).toContain(
      "Order.Create(code: command.Code, n: command.N)",
    );
  });
});

describe.each([
  "node",
  "python",
  "java",
  "elixir",
])("%s: handlers named like the auto CRUD surface generate without a path collision", (platform) => {
  it("generates", async () => {
    const files = await generateSystemFiles(SRC(platform));
    expect(files.size).toBeGreaterThan(0);
  }, 120_000);
});
