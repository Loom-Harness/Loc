// No repository find name is reserved because of a target backend: an emitter
// whose own repository / context surface already defines a method of the
// find's rendered name escapes the FIND, consistently at its definition and at
// every call site (find route, query-handler load, workflow `if let`,
// domain-service read).  The names below were each refused model-wide because
// one backend collided on them:
//   - .NET  `getByIdAsync` / `saveAsync` (and `deleteAsync`): a find renders
//     PascalCased with no `Async` suffix, so these landed on the built-in
//     `GetByIdAsync` / `SaveAsync` / `DeleteAsync` — CS0111 for
//     `getByIdAsync(id: Order id)`.  Escaped to `<Name>Find`.
//   - Phoenix `get` (and `change`): the context re-exports a find as
//     `<find>_<agg>`, so `get` landed on the built-in by-id `get_order/1`
//     ("this clause cannot match" under --warnings-as-errors).  Escaped to
//     `<find>_<agg>_find`.  `read` never collided on the Ecto emitter.
// The compile-tier proof is this same model built with `tsc --noEmit`,
// `dotnet build /warnaserror`, `mix compile --warnings-as-errors`,
// `gradle testClasses bootJar` and `ruff check` + `mypy --strict`.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system P {
  subdomain D {
    context Sales {
      aggregate Order with crudish { name: string }
      repository Orders for Order {
        find getByIdAsync(id: Order id): Order? where this.id == id
        find saveAsync(name: string): Order where this.name == name
        find deleteAsync(name: string): Order? where this.name == name
        find get(name: string): Order where this.name == name
        find read(name: string): Order where this.name == name
        find change(name: string): Order? where this.name == name
      }
      queryHandler Probe(name: string): int {
        let a = Orders.saveAsync(name)
        let b = Orders.get(name)
        let c = Orders.read(name)
        return 0
      }
      domainService Lookup {
        operation known(id: Order id): bool {
          return Orders.getByIdAsync(id) == null
        }
        operation unchanged(name: string): bool {
          return Orders.change(name) == null
        }
      }
      workflow touch {
        create(name: string) {
          if let o = Orders.deleteAsync(name) {
            precondition true
          }
        }
      }
    }
  }
  api A from D {
    route GET "/probe/{name}" -> Sales.Probe
  }
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [Sales], dataSources: [st], serves: A, port: 3000 }
}
`;

/** The one emitted file whose path ends with `suffix`. */
function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted (have: ${[...m.keys()].join(", ")})`).toBeDefined();
  return m.get(key!)!;
}

/** Occurrences of `needle` in `hay`. */
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe("dotnet: a find named like a built-in repository method is escaped", () => {
  it("defines the escaped method beside the built-in, and every call site uses it", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    const port = fileEndingWith(files, "Domain/Orders/IOrderRepository.cs");
    const impl = fileEndingWith(files, "Infrastructure/Repositories/OrderRepository.cs");
    // The built-ins keep their names, once each.
    expect(count(port, " GetByIdAsync(")).toBe(1);
    expect(count(port, " SaveAsync(")).toBe(1);
    expect(count(port, " DeleteAsync(")).toBe(1);
    // The finds are escaped on the port and the implementation alike.
    for (const m of [
      "Task<Order?> GetByIdAsyncFind(OrderId id",
      "Task<Order> SaveAsyncFind(string name",
      "Task<Order?> DeleteAsyncFind(string name",
    ]) {
      expect(port).toContain(m);
      expect(impl).toContain(`public async ${m}`);
    }
    // A find that collides with nothing keeps its plain PascalCase name.
    expect(port).toContain("Task<Order> Get(string name");
    expect(port).toContain("Task<Order> Read(string name");
    // Call sites: the find route's query handler, the query-handler load, the
    // workflow `if let`, the domain-service read.
    expect(fileEndingWith(files, "Queries/GetByIdAsyncHandler.cs")).toContain(
      "_repo.GetByIdAsyncFind(query.Id, cancellationToken)",
    );
    expect(fileEndingWith(files, "Queries/SaveAsyncHandler.cs")).toContain(
      "_repo.SaveAsyncFind(query.Name, cancellationToken)",
    );
    const probe = fileEndingWith(files, "Queries/ProbeHandler.cs");
    expect(probe).toContain("_orders.SaveAsyncFind(command.Name, cancellationToken)");
    expect(probe).toContain("_orders.Get(command.Name, cancellationToken)");
    expect(fileEndingWith(files, "Workflows/TouchHandler.cs")).toContain(
      "_orders.DeleteAsyncFind(command.Name, cancellationToken)",
    );
    expect(fileEndingWith(files, "Domain/Services/Lookup.cs")).toContain(
      "_orders.GetByIdAsyncFind(id, cancellationToken)",
    );
  });
});

describe("elixir: a find named like a context CRUD function is escaped", () => {
  it("re-exports the escaped facade beside the built-in, and every call site uses it", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const facade = fileEndingWith(files, "lib/api/sales.ex");
    // The built-in by-id load and changeset keep their names, once each.
    expect(count(facade, "defdelegate get_order(")).toBe(1);
    expect(count(facade, "def change_order(")).toBe(1);
    expect(facade).toContain(
      "defdelegate get_order_find(name), to: Api.Sales.OrderRepository, as: :get",
    );
    expect(facade).toContain(
      "defdelegate change_order_find(name), to: Api.Sales.OrderRepository, as: :change",
    );
    // `read` collides with nothing on the Ecto emitter: no escape.
    expect(facade).toContain(
      "defdelegate read_order(name), to: Api.Sales.OrderRepository, as: :read",
    );
    // Call sites: the find controller, the query-handler load, the
    // domain-service read (a context fn).
    const controller = fileEndingWith(files, "controllers/order_controller.ex");
    expect(controller).toContain('Sales.get_order_find(params["name"])');
    expect(controller).toContain('Sales.change_order_find(params["name"])');
    expect(fileEndingWith(files, "sales/handlers/probe.ex")).toContain(
      "Context.get_order_find(name)",
    );
    expect(facade).toContain("case change_order_find(name) do");
  });
});

describe("node / python / java: the formerly-reserved names collide with nothing", () => {
  it("node keeps each find under its own name at definition and call sites", async () => {
    const files = await generateSystemFiles(src("node"));
    const port = fileEndingWith(files, "domain/repository-ports.ts");
    for (const m of ["getByIdAsync(", "saveAsync(", "deleteAsync(", "get(", "read("]) {
      expect(count(port, `  ${m}`), m).toBe(1);
    }
    const handlers = fileEndingWith(files, "http/a-routes.ts");
    expect(handlers).toContain("await orders.saveAsync(name)");
    expect(handlers).toContain("await orders.get(name)");
    expect(fileEndingWith(files, "http/workflows.ts")).toContain("await orders.deleteAsync(name)");
  });

  it("python keeps each find under its own snake_case name", async () => {
    const files = await generateSystemFiles(src("python"));
    const repo = fileEndingWith(files, "db/repositories/order_repository.py");
    for (const m of ["get_by_id_async", "save_async", "delete_async", "get", "read"]) {
      expect(count(repo, `    async def ${m}(self`), m).toBe(1);
    }
    expect(fileEndingWith(files, "application/probe.py")).toContain("await orders.get(name)");
    expect(fileEndingWith(files, "http/workflows_routes.py")).toContain(
      "await orders.delete_async(name)",
    );
  });

  it("java keeps each find under its own name", async () => {
    const files = await generateSystemFiles(src("java"));
    const port = fileEndingWith(files, "features/orders/OrderRepository.java");
    for (const m of [
      "getByIdAsync(OrderId id)",
      "saveAsync(String name)",
      "deleteAsync(String name)",
      " get(String name)",
      " read(String name)",
    ]) {
      expect(port, m).toContain(m);
    }
  });
});
