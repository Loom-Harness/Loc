// `ignoring …` honoured in every position the placement gate accepts, on
// every backend.  Each read the contract table marks `ignoring: true` either
// widens where it is written or is refused — never silently dropped:
//
//   - `let xs = Repo.all(C) ignoring …` in a handler runs a retrieval of its
//     own, named for its stance, that leaves the bypassed filter out — the
//     shared retrieval every other caller runs keeps it;
//   - a paged handler over `all(C) ignoring …` pages its own find, carrying
//     the stance;
//   - `let x = Repo.find(C) ignoring …` (and `find(id)`) in a workflow or
//     handler binds through the read's own widened method, as `if let` does;
//   - a context integration `test` reads `Agg.find(id) ignoring …` through it;
//   - the widened reads bind no principal they no longer read (Dapper), read
//     the ambient one where the caller holds none (Python), and a workflow
//     forwards the actor to a read that still scopes by it (Elixir).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SOFT = `
system S {
  capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
  subdomain D { context C {
    aggregate Order with softDeletable { code: string  total: int
      operation close() { total := 0 }
    }
    repository Orders for Order { }
    criterion ByCode(c: string) of Order = this.code == c
    criterion Big of Order = this.total > 10
    queryHandler ListAny(): Order[] {
      let xs = Orders.all(Big()) ignoring softDeletable
      return xs
    }
    queryHandler ListPlain(): Order[] {
      let xs = Orders.all(Big())
      return xs
    }
    queryHandler PageAny(): Order paged {
      let r = Orders.all(Big()) ignoring *
      return r
    }
    commandHandler CloseIt(c: string, oid: Order id) {
      let j = Orders.find(ByCode(c)) ignoring softDeletable
      if let k = j { k.close() }
      if let m = Orders.find(oid) ignoring * { m.close() }
    }
    workflow Sweep { create(c: string) {
      let j = Orders.find(ByCode(c)) ignoring softDeletable
      if let k = j { k.close() }
    } }
  }}
  api SApi from D {
    route GET "/orders/any" -> C.ListAny
    route GET "/orders/plain" -> C.ListPlain
    route GET "/orders/page-any" -> C.PageAny
    route POST "/orders/close" -> C.CloseIt
  }
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable api { platform: node  contexts: [C]  serves: SApi  dataSources: [cState]  port: 3000 }
}`;

const cache = new Map<string, Map<string, string>>();
async function gen(src: string, platform: string): Promise<Map<string, string>> {
  const key = `${src.length}:${src.slice(0, 40)}:${platform}`;
  let files = cache.get(key);
  if (!files) {
    files = await generateSystemFiles(src.replace("platform: node ", `platform: ${platform} `));
    cache.set(key, files);
  }
  return files;
}

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(hit, `no generated file ends with ${suffix}`).toBeDefined();
  return files.get(hit!)!;
}

/** `src` from `start` to the first `end` after it. */
function block(src: string, start: string, end: string): string {
  const at = src.indexOf(start);
  expect(at, `${start} not emitted`).toBeGreaterThanOrEqual(0);
  const stop = src.indexOf(end, at + start.length);
  return src.slice(at, stop === -1 ? undefined : stop);
}

describe("node — a widened list read runs its own retrieval (#4404)", () => {
  it("the handler's `all(C) ignoring softDeletable` drops the conjunct; the plain read keeps it", async () => {
    const files = await gen(SOFT, "node");
    const repo = file(files, "db/repositories/order-repository.ts");
    expect(block(repo, "async runFindAllByBigIgnoringSoftDeletable(", "\n  }\n")).toContain(
      ".where(bigCriterion())",
    );
    expect(block(repo, "async runFindAllByBig(", "\n  }\n")).toContain(
      ".where(and(bigCriterion(), orderScope()))",
    );
    const routes = file(files, "http/sApi-routes.ts");
    expect(routes).toContain("const xs = await orders.runFindAllByBigIgnoringSoftDeletable();");
    expect(routes).toContain("const xs = await orders.runFindAllByBig();");
  });

  it("a paged handler over `all(C) ignoring *` pages its own unscoped find", async () => {
    const files = await gen(SOFT, "node");
    const repo = file(files, "db/repositories/order-repository.ts");
    const paged = block(repo, "async findAllByBigIgnoringAll(", "\n  }\n");
    expect(paged).toContain(".where(bigCriterion())");
    expect(paged).not.toContain("orderScope");
  });

  it("MikroORM switches the bypassed filter off on the widened retrieval only", async () => {
    const repo = file(
      await gen(SOFT, "node { persistence: mikroorm }"),
      "db/repositories/order-repository.ts",
    );
    expect(block(repo, "async runFindAllByBigIgnoringSoftDeletable(", "\n  }\n")).toContain(
      'filters: { "softDeletable": false }',
    );
    expect(block(repo, "async runFindAllByBig(", "\n  }\n")).not.toContain("filters:");
  });

  it("`let x = find(C) ignoring …` in a workflow / handler calls the widened method (#4397)", async () => {
    const files = await gen(SOFT, "node");
    expect(file(files, "http/workflows.ts")).toContain(
      "const j = await orders.findFirstByCodeIgnoringSoftDeletable(c);",
    );
    const routes = file(files, "http/sApi-routes.ts");
    expect(routes).toContain("const j = await orders.findFirstByCodeIgnoringSoftDeletable(c);");
    expect(routes).toContain("const m = await orders.findByIdIgnoringAll(");
  });
});

describe("python — the widened retrieval carries its own stance (#4404, #4536)", () => {
  it("the handler-only `ignoring` reaches the read scope; the shared retrieval keeps every filter", async () => {
    const files = await gen(SOFT, "python");
    const repo = file(files, "app/db/repositories/order_repository.py");
    expect(block(repo, "async def run_find_all_by_big_ignoring_soft_deletable(", "\n\n")).toContain(
      'execution_options(loom_ignoring=frozenset({"softDeletable"}))',
    );
    expect(block(repo, "async def run_find_all_by_big(", "\n\n")).not.toContain("loom_ignoring");
    expect(file(files, "app/application/list_any.py")).toContain(
      "xs = await orders.run_find_all_by_big_ignoring_soft_deletable()",
    );
    expect(file(files, "app/application/close_it.py")).toContain(
      "j = await orders.find_first_by_code_ignoring_soft_deletable(c)",
    );
    expect(file(files, "app/application/close_it.py")).toContain(
      "m = await orders.find_by_id_ignoring_all(oid)",
    );
  });
});

describe("java — the widened retrieval disables its filters, handlers included (#4536)", () => {
  it("a handler-only `ignoring` promotes and disables the filter on its own retrieval", async () => {
    const files = await gen(SOFT, "java");
    const impl = file(files, "features/orders/OrderRepositoryImpl.java");
    expect(
      block(impl, "public List<Order> runFindAllByBigIgnoringSoftDeletable() {", "\n    }\n"),
    ).toContain('__session.disableFilter("softDeletable");');
    expect(block(impl, "public List<Order> runFindAllByBig() {", "\n    }\n")).not.toContain(
      "disableFilter",
    );
    const handler = file(files, "application/workflows/CloseItHandler.java");
    expect(handler).toContain("var j = ordersRepository.findFirstByCodeIgnoringSoftDeletable(c);");
    expect(handler).toContain("var m = ordersRepository.findByIdIgnoringAll(oid);");
  });
});

// The handler's list read is the ONLY bypass of `softDeletable`: no widened
// find promotes the capability on its own, so the promotion must come from the
// handler — a collector that scans workflows only leaves it `@SQLRestriction`.
const HANDLER_ONLY = SOFT.replace(/ {4}queryHandler PageAny[\s\S]*?\n {4}\} \}\n/, "")
  .replace('    route GET "/orders/page-any" -> C.PageAny\n', "")
  .replace('    route POST "/orders/close" -> C.CloseIt\n', "");

describe("java — a handler-only `ignoring` promotes the capability (#4536)", () => {
  it("the capability becomes a bypassable @Filter the widened retrieval disables", async () => {
    expect(HANDLER_ONLY).not.toContain("CloseIt");
    const files = await gen(HANDLER_ONLY, "java");
    const impl = file(files, "features/orders/OrderRepositoryImpl.java");
    expect(
      block(impl, "public List<Order> runFindAllByBigIgnoringSoftDeletable() {", "\n    }\n"),
    ).toContain('__session.disableFilter("softDeletable");');
  });
});

describe(".NET — the widened reads call their own methods", () => {
  it("EF: the list read and the let-bound single-row reads", async () => {
    const files = await gen(SOFT, "dotnet");
    expect(file(files, "Application/Orders/Queries/ListAnyHandler.cs")).toContain(
      'await _orders.RunFindAllByBigIgnoringSoftDeletableAsync(bypass: FilterBypass.Bypass("softDeletable")',
    );
    const close = file(files, "Application/Orders/Commands/CloseItHandler.cs");
    expect(close).toContain(
      "var j = await _orders.FindFirstByCodeIgnoringSoftDeletable(command.C, cancellationToken);",
    );
    expect(close).toContain(
      "var m = await _orders.FindByIdIgnoringAll(command.Oid, cancellationToken);",
    );
    expect(file(files, "Application/Workflows/SweepHandler.cs")).toContain(
      "var j = await _orders.FindFirstByCodeIgnoringSoftDeletable(command.C, cancellationToken);",
    );
  });
});

describe("elixir — the widened reads, relational and paged (#4404)", () => {
  it("the paged handler over `all(C) ignoring *` skips every filter", async () => {
    const files = await gen(SOFT, "elixir");
    const repo = file(files, "lib/api/c/order_repository.ex");
    const paged = block(repo, "def find_all_by_big_ignoring_all(", "\n  end\n");
    expect(paged).toContain("skip_filters: :all");
    expect(block(repo, "def list(", "\n  end\n")).not.toContain("skip_filters");
  });

  it("`let` / `if let` over the widened single-row reads call their own delegates (#4397)", async () => {
    const files = await gen(SOFT, "elixir");
    const close = file(files, "lib/api/c/handlers/close_it.ex");
    expect(close).toContain("Context.find_first_by_code_ignoring_soft_deletable_order(c)");
    expect(close).toContain("Context.find_by_id_ignoring_all_order(oid)");
    expect(close).not.toContain("Context.get_order(oid)");
    expect(file(files, "lib/api/c/workflows/sweep.ex")).toContain(
      "Context.find_first_by_code_ignoring_soft_deletable_order(c)",
    );
  });
});

// A tenant-scoped aggregate with a currentUser criterion.
const TENANT = `
system T {
  user { id: string  tenantId: string }
  auth {
    provider: keycloak
    oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID")  audience: env("OIDC_AUDIENCE") }
    claims: { tenantId: "tenant_id" }
  }
  tenancy by user.tenantId of Organization
  subdomain D {
    context C {
      aggregate Organization { name: string }
      repository Organizations for Organization { }
      policy { read Organization requires true }
      aggregate Order with tenantOwned, softDeletable { code: string  total: int
        operation close() requires true { total := 0 }
      }
      repository Orders for Order { }
      policy { read Order requires true }
      criterion ByCode(c: string) of Order = this.code == c
      criterion Mine of Order = this.code == currentUser.id
      queryHandler AnyCode(c: string): Order[] {
        requires true
        let xs = Orders.all(ByCode(c)) ignoring *
        return xs
      }
      queryHandler ScopedCode(c: string): Order[] {
        requires true
        let xs = Orders.all(ByCode(c))
        return xs
      }
      queryHandler MyFirst(): Order {
        requires true
        if let w = Orders.find(Mine) ignoring * { return w } else { notFound }
      }
      workflow w { create(c: string) requires true {
        if let o = Orders.find(ByCode(c)) { o.close() }
      } }
    }
  }
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  api CApi from D {
    route GET "/orders/any" -> C.AnyCode
    route GET "/orders/scoped" -> C.ScopedCode
    route GET "/orders/mine" -> C.MyFirst
  }
  deployable api { platform: node  contexts: [C]  serves: CApi  dataSources: [cState]  port: 3000  auth: required }
}`;

describe("Dapper — `all(C) ignoring *` binds no tenant claim it does not read (#4416)", () => {
  it("the widened retrieval binds no principal; the shared one still does", async () => {
    const repo = file(
      await gen(TENANT, "dotnet { persistence: dapper }"),
      "Infrastructure/Repositories/OrderRepository.cs",
    );
    const widened = block(repo, "RunFindAllByByCodeIgnoringAllAsync(", "\n    }\n");
    expect(widened).toContain("OrderScope.Runtime(bypass)");
    expect(widened).not.toContain("__cu_tenantId");
    expect(widened).not.toContain("CurrentUser!");
    expect(block(repo, "RunFindAllByByCodeAsync(", "\n    }\n")).toContain(
      'p.Add("__cu_tenantId", RequestContext.Current!.CurrentUser!.TenantId);',
    );
  });
});

describe("python — a widened currentUser criterion read reads the ambient principal (#4410)", () => {
  it("the method takes no `current_user` its body-side callers cannot pass", async () => {
    const files = await gen(TENANT, "python");
    const repo = file(files, "app/db/repositories/order_repository.py");
    const m = block(repo, "async def find_first_mine_ignoring_all(", "\n\n");
    expect(m).toContain("async def find_first_mine_ignoring_all(self) -> Order | None:");
    expect(m).toContain("OrderRow.code == require_current_user().id");
    expect(file(files, "app/application/my_first.py")).toContain(
      "await orders.find_first_mine_ignoring_all()",
    );
  });
});

describe("elixir — a workflow forwards the actor to a read that scopes by it (#4432)", () => {
  it("the workflow binds current_user and the single-row criterion read passes it", async () => {
    const files = await gen(TENANT, "elixir");
    const wf = file(files, "lib/api/c/workflows/w.ex");
    expect(wf).toContain("def run(params, current_user \\\\ nil)");
    expect(wf).toContain(
      "Context.run_find_all_by_by_code_order(c, limit: 1, current_user: current_user)",
    );
    expect(file(files, "controllers/workflows_controller.ex")).toContain(
      "Api.C.Workflows.W.run(params, current_user)",
    );
  });
});

const INTEGRATION = `
system Shop {
  capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
  subdomain Sales { context Ordering {
    aggregate Order with softDeletable { code: string  qty: int }
    repository Orders for Order { }
    test "reads back a soft-deleted order" {
      let o = Order.create(code: "abc", qty: 2, isDeleted: true)
      let found = Order.find(o.id) ignoring softDeletable
      expect(found.qty).toBe(2)
    }
  } }
  api ShopApi from Sales
  storage db { type: postgres }
  resource st { for: Ordering, kind: state, use: db }
  deployable api { platform: node contexts: [Ordering] serves: ShopApi dataSources: [st] port: 8080 }
}`;

describe("context integration test — `Agg.find(id) ignoring …` reads through the widened method (#4343)", () => {
  const cases: [string, string, string][] = [
    [
      "node",
      "test/ordering.integration.test.ts",
      "await repos.order.findByIdIgnoringSoftDeletable(o.id)",
    ],
    [
      "python",
      "tests/test_ordering_integration.py",
      "await order_repo.find_by_id_ignoring_soft_deletable(o.id)",
    ],
    [
      "dotnet",
      "OrderingIntegrationTests.cs",
      "await orderRepo.FindByIdIgnoringSoftDeletable(o.Id)",
    ],
    [
      "java",
      "OrderingIntegrationTests.java",
      "orderRepository.findByIdIgnoringSoftDeletable(o.id())",
    ],
    [
      "elixir",
      "test/ordering_integration_test.exs",
      "Api.Ordering.find_by_id_ignoring_soft_deletable_order(o.id)",
    ],
  ];
  for (const [platform, suffix, call] of cases) {
    it(platform, async () => {
      const files = await gen(INTEGRATION, platform);
      expect(file(files, suffix)).toContain(call);
    });
  }
});
