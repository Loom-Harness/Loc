// The routed-handler route contract, uniform across the five backends: a routed
// `queryHandler` (hand-written `route GET … -> Ctx.Handler`, or the
// `scaffoldGet` + `scaffoldGetApi` pair) answers
//   - a `T?` entity miss as the find-absence 404, never a `toWire(null)` crash
//     or an empty-bodied 200;
//   - a `money` query param through the RS-42 grammar guard on .NET;
//   - a query param named like the action's own locals without redeclaring them.
// Plus two leftovers of the same pass: a python handler's repository local goes
// through the identifier escaper, and a java criterion run logs `find_executed`.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const PLATFORMS = ["node", "python", "dotnet", "java", "elixir"] as const;
type Platform = (typeof PLATFORMS)[number];

const src = (platform: Platform, repo = "Orders") => `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { code: string  total: money }
      repository ${repo} for Order
      criterion ByCode(code: string) of Order = this.code == code
      criterion Uni(result: string, problem: string) of Order = this.code == result
      criterion Big(min: money) of Order = this.total > min
      queryHandler OrderByCode(c: string): Order? {
        let x = ${repo}.find(ByCode(c))
        return x
      }
      queryHandler OrderByUni(result: string, problem: string): Order? {
        let x = ${repo}.find(Uni(result, problem))
        return x
      }
      queryHandler OrderBig(min: money): Order? {
        let x = ${repo}.find(Big(min))
        return x
      }
    }
  }
  api A from Sales {
    route GET "/orders/by_code" -> Orders.OrderByCode
    route GET "/orders/uni" -> Orders.OrderByUni
    route GET "/orders/big" -> Orders.OrderBig
  }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`;

async function file(platform: Platform, suffix: string, repo?: string): Promise<string> {
  const files = await generateSystemFiles(src(platform, repo));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted for ${platform}`).toBeDefined();
  return files.get(key!)!;
}

describe("a routed `T?` entity return answers its miss as the find-absence 404", () => {
  it("node: refuses null before projecting it", async () => {
    const routes = await file("node", "http/a-routes.ts");
    expect(routes).toContain("const __found = x;");
    expect(routes).toContain('if (__found == null) throw new AggregateNotFoundError("not_found");');
    expect(routes).toContain("orders.toWire(__found)");
    expect(routes).not.toContain("orders.toWire(x)");
  });

  it("python: the handler raises AggregateNotFoundError before to_wire", async () => {
    const handler = await file("python", "app/application/order_by_code.py");
    expect(handler).toContain("from app.domain.errors import AggregateNotFoundError");
    expect(handler).toContain("__found = x");
    expect(handler).toContain("if __found is None:");
    expect(handler).toContain('raise AggregateNotFoundError("not_found")');
    expect(handler).toContain("return orders.to_wire(__found)");
  });

  it("dotnet: the action throws the find-absence exception the filter renders as 404", async () => {
    const controller = await file("dotnet", "Api/ARoutesController.cs");
    expect(controller).toContain(
      'if (__result is null) throw new global::D.Domain.Common.AggregateNotFoundException("not_found");',
    );
  });

  it("java: the action throws AggregateNotFoundException and imports it", async () => {
    const controller = await file("java", "api/ARoutesController.java");
    expect(controller).toContain(
      'if (result == null) throw new AggregateNotFoundException("not_found");',
    );
    expect(controller).toContain("import com.loom.d.domain.common.AggregateNotFoundException;");
  });

  it("elixir: a nil result is the tagged not_found term the controller renders", async () => {
    const handler = await file("elixir", "orders/handlers/order_by_code.ex");
    expect(handler).toContain('nil -> {:error, {:not_found, "not_found"}}');
    expect(handler).toContain("loom_found -> {:ok, loom_found}");
    const controller = await file("elixir", "controllers/a_routes_controller.ex");
    expect(controller).toContain("def respond(conn, {:error, {:not_found, detail}})");
  });

  it("a non-optional entity return carries no absence branch", async () => {
    const files = await generateSystemFiles(`
system S {
  subdomain Sales {
    context Orders with scaffoldGet(of: ByCode) {
      aggregate Order with crudish { code: string  total: int }
      repository Orders for Order
      criterion ByCode(code: string) of Order = this.code == code
    }
  }
  api A with scaffoldGetApi(of: ByCode) from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: node, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`);
    const routes = [...files].find(([k]) => k.endsWith("http/a-routes.ts"))![1];
    expect(routes).not.toContain("__found");
  });
});

describe("a .NET routed money query param is grammar-guarded (RS-42)", () => {
  it("binds the wire string and parses it through IsMoneyGrammar", async () => {
    const controller = await file("dotnet", "Api/ARoutesController.cs");
    expect(controller).toContain("BindRequired] string min)");
    expect(controller).toContain("WireFormatException.IsMoneyGrammar(min)");
    expect(controller).toContain('new global::D.Domain.Common.WireFormatException("/min"');
    expect(controller).toContain("using System.Globalization;");
    expect(controller).not.toContain("decimal min");
  });
});

describe("a .NET routed action's own local never collides with a query param", () => {
  it("a `result` param is a legal action parameter beside the mediator-answer local", async () => {
    const controller = await file("dotnet", "Api/ARoutesController.cs");
    expect(controller).toMatch(/OrderByUni\(.*string result, .*string problem\)/);
    expect(controller).toContain(
      "var __result = await _mediator.Send(new OrderByUniQuery(result, problem));",
    );
    expect(controller).not.toContain("var result =");
  });
});

describe("a python handler's repository local goes through the identifier escaper", () => {
  it("`repository As for Order` binds `as_`, never the keyword", async () => {
    const handler = await file("python", "app/application/order_by_code.py", "As");
    expect(handler).toContain("as_ = OrderRepository(");
    expect(handler).toContain("await as_.run_find_all_by_by_code(");
    expect(handler).toContain("return as_.to_wire(__found)");
    expect(handler).not.toMatch(/^\s+as = /m);
  });
});

describe("a java criterion run logs find_executed like every other repository read", () => {
  it("each reified run overload logs its row count", async () => {
    const files = await generateSystemFiles(src("java"));
    const repo = [...files].find(([k]) => /OrderRepositoryImpl\.java$/.test(k))?.[1];
    expect(repo, "java repository impl not emitted").toBeDefined();
    expect(repo).toContain('"find", "runFindAllByByCode", "rows", result.size()');
  });
});
