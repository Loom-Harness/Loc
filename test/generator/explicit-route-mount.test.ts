// M-T6.73 — WHERE an explicit `route <METHOD> <PATH> -> <Ctx>.<Handler>` is
// served, across all five backends, and what it answers with.
//
// Measured by #2984, which lifted routed handlers onto the `test e2e` surface
// and booted `corpus/handler-triad` across the behavioural tier for the first
// time.  Until that lift no `test e2e` body could ADDRESS a routed handler, so
// not one of these routes had ever been CALLED on any backend — all five
// compiled clean and four served nothing at the path the caller uses:
//
//   node, mikroorm  POST /api/echo/hi → "hi"      (the wire-golden oracle)
//   dotnet, dapper  404 — `[HttpPost("/echo/{text}")]`, and a leading slash
//                   makes an ASP.NET template ROOT-absolute, so the `/api`
//                   prefix was ignored
//   java            404 — `@RestController` with no class-level
//                   `@RequestMapping`
//   elixir          404 — routes in `scope "/"` while every aggregate route
//                   sits in `scope "/api"`
//   python          path CORRECT; the RESPONSE diverged — `{"result":"hi"}`
//                   where node answers the bare `"hi"`
//
// The canonical answer is not "whatever node does": `src/system/e2e-render.ts`
// builds EVERY routed-handler request as `base + API_BASE_PATH + <declared
// path>` for all five platforms, and `src/util/api-base.ts` states the rule —
// domain routes live under `/api`, only infra (`/health`, `/ready`, the OpenAPI
// document) stays at the root.  So `/api` + the declared path is the contract,
// and the bare value is the body.
//
// The second describe pins D-EXPLICIT-ROUTE-WINS.  `with scaffoldHandlers` +
// `with scaffoldApi` synthesises one explicit route per create / operation /
// find / get-by-id / destroy — the same slots the always-on auto-derived REST
// surface occupies.  The explicit route owns each such slot: the derived
// surface yields it, so the two never register on one slot (elixir would fail
// `mix compile --warnings-as-errors`, .NET and java would throw ambiguity
// errors at request time, node and python would serve whichever mounted first).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** A route that collides with NOTHING — the shape #2984 measured. */
const CLEAN_SRC = (platform: string) => `
system Echoes {
  subdomain D {
    context Sales {
      aggregate Order {
        code: string
        status: string
        operation cancel() { status := "cancelled" }
      }
      repository Orders for Order { }
      commandHandler Echo(text: string): string { return text }
    }
  }
  api A from D {
    route POST "/echo/{text}" -> Sales.Echo
  }
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [Sales]
    dataSources: [st]
    serves: A
    port: 4000
  }
}
`;

/** `scaffoldHandlers` + `scaffoldApi`: every explicit route lands on a slot of
 *  the auto-derived surface.  `cancel` is `when`-gated so its `can_cancel`
 *  probe — which scaffoldApi does NOT route — must stay on the derived side. */
const SCAFFOLD_SRC = (platform: string) => `
system Shop {
  subdomain Sales {
    context Ordering with scaffoldHandlers {
      aggregate Order {
        code: string
        status: string = "new"
        create(code: string) { code := code }
        operation cancel() when status == "new" { status := "cancelled" }
        destroy { }
      }
      repository Orders for Order {
        find byStatus(status: string): Order[] where this.status == status
      }
    }
  }
  api SalesApi with scaffoldApi(of: Sales)
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api {
    platform: ${platform}
    contexts: [Ordering]
    dataSources: [st]
    serves: SalesApi
    port: 5001
  }
}
`;

async function fileEndingWith(src: string, suffix: string): Promise<string> {
  const m = await generateSystemFiles(src);
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted; have:\n${[...m.keys()].sort().join("\n")}`).toBeDefined();
  return m.get(key!)!;
}

describe("M-T6.73 — an explicit route serves under API_BASE_PATH on every backend", () => {
  it("node mounts its route module at /api (the oracle, unchanged)", async () => {
    const routes = await fileEndingWith(CLEAN_SRC("node"), "http/a-routes.ts");
    expect(routes).toContain('path: "/echo/{text}"');
    // …and the module itself is mounted under the api base.
    const index = await fileEndingWith(CLEAN_SRC("node"), "http/index.ts");
    expect(index).toContain('app.route("/api", aRoutes(');
    // The scalar return crosses the wire BARE — no envelope.
    expect(routes).toContain("httpCtx.json(text as unknown, 200)");
  });

  it("dotnet puts /api IN the [Http*] template (a leading slash is root-absolute)", async () => {
    const ctrl = await fileEndingWith(CLEAN_SRC("dotnet"), "Api/ARoutesController.cs");
    expect(ctrl).toContain('[HttpPost("/api/echo/{text}")]');
    expect(ctrl).not.toContain('[HttpPost("/echo/{text}")]');
  });

  it("dotnet sends a bare `string` return as JSON, not text/plain", async () => {
    // `Ok(<string>)` is the ONE value shape ASP.NET does not serialise as JSON:
    // `StringOutputFormatter` claims a raw string for `text/plain`, so the route
    // answered `text/plain: hi` against node's `application/json: "hi"`.
    // Measured on a booted app once the route was reachable — `curl -D-` on the
    // pre-fix build reported `Content-Type: text/plain; charset=utf-8` and an
    // unquoted `hi`, and the emitted e2e client failed with "expected JSON, got
    // \"hi\"".  int / bool / decimal / an entity DTO already fall through to the
    // JSON formatter, which is why only this arm changes.
    const ctrl = await fileEndingWith(CLEAN_SRC("dotnet"), "Api/ARoutesController.cs");
    expect(ctrl).toContain("return new JsonResult(result);");
  });

  it("dotnet leaves a NON-string scalar on Ok() (the formatter does not touch it)", async () => {
    const intSrc = CLEAN_SRC("dotnet")
      .replace(
        "commandHandler Echo(text: string): string { return text }",
        "queryHandler Sum(a: int, b: int): int { return a + b }",
      )
      .replace('route POST "/echo/{text}" -> Sales.Echo', 'route GET "/sum/{a}/{b}" -> Sales.Sum');
    const ctrl = await fileEndingWith(intSrc, "Api/ARoutesController.cs");
    expect(ctrl).toContain("return Ok(result);");
    expect(ctrl).not.toContain("JsonResult");
  });

  it("java puts /api on the @*Mapping", async () => {
    const ctrl = await fileEndingWith(CLEAN_SRC("java"), "api/ARoutesController.java");
    expect(ctrl).toContain('@PostMapping("/api/echo/{text}")');
    expect(ctrl).not.toContain('@PostMapping("/echo/{text}")');
  });

  it('elixir splices the route into `scope "/api"`, not the root scope', async () => {
    const router = await fileEndingWith(CLEAN_SRC("elixir"), "lib/d_web/router.ex");
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    expect(apiBlock).toContain('post "/echo/:text", ARoutesController, :echo');
    // The root scope keeps ONLY the genuinely-root routes (the OpenAPI document).
    const rootBlock = router.slice(router.indexOf('scope "/" do'), router.indexOf('scope "/api"'));
    expect(rootBlock).not.toContain("ARoutesController");
    expect(rootBlock).toContain("OpenapiController");
  });

  it("elixir answers the handler's value UNWRAPPED", async () => {
    // The same envelope defect python had, and equally invisible: while the
    // route sat at the root, every request to `/api/echo/hi` 404'd, so no caller
    // ever saw `respond/2`'s body.  Measured on a booted Phoenix app the moment
    // the path was fixed: `{"result":"hi"}` against node's `"hi"`.
    const ctrl = await fileEndingWith(
      CLEAN_SRC("elixir"),
      "lib/d_web/controllers/a_routes_controller.ex",
    );
    expect(ctrl).toContain("|> json(serialize(result))");
    expect(ctrl).not.toContain("json(%{result:");
  });

  it("python answers the handler's scalar UNWRAPPED (path was already right)", async () => {
    const routes = await fileEndingWith(CLEAN_SRC("python"), "app/http/a_routes.py");
    expect(routes).toContain('@router.post("/echo/{text}"');
    expect(routes).toContain("    return result");
    // The divergence this closes: python was the lone backend to envelope.
    expect(routes).not.toContain('return {"result"');
    // `Any`, not `dict[str, object]` — FastAPI reads the return annotation as
    // the response_model and would validate a bare scalar against a mapping.
    expect(routes).toContain("-> Any:");
    expect(routes).toContain("from typing import Annotated, Any");
    // …and the router is still mounted under the api base.
    const main = await fileEndingWith(CLEAN_SRC("python"), "app/main.py");
    expect(main).toContain('app.include_router(a_router, prefix="/api")');
  });
});

describe("D-EXPLICIT-ROUTE-WINS — an explicit route owns its slot; the derived surface yields it", () => {
  it('elixir serves every scaffolded route from `scope "/api"`, after the derived routes', async () => {
    const router = await fileEndingWith(SCAFFOLD_SRC("elixir"), "lib/api_web/router.ex");
    const rootBlock = router.slice(router.indexOf('scope "/" do'), router.indexOf('scope "/api"'));
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    expect(rootBlock).not.toContain("SalesApiRoutesController");
    for (const line of [
      'get "/orders/by_status", SalesApiRoutesController, :by_status_order',
      'get "/orders/:order_id", SalesApiRoutesController, :get_order',
      'post "/orders", SalesApiRoutesController, :create_order',
      'post "/orders/:order_id/cancel", SalesApiRoutesController, :cancel_order',
      'delete "/orders/:order_id", SalesApiRoutesController, :destroy_order',
    ])
      expect(apiBlock).toContain(line);
    // The derived routes for those slots are gone — two clauses on one slot is
    // an unreachable `do_match` and a `--warnings-as-errors` build failure.
    for (const action of [":show", ":create", ":delete", ":cancel", ":by_status"])
      expect(apiBlock).not.toContain(`OrderController, ${action}\n`);
    // Slots no explicit route claims stay derived: the list read and the probe.
    expect(apiBlock).toContain('get "/orders", OrderController, :index');
    expect(apiBlock).toContain('get "/orders/:id/can_cancel", OrderController, :can_cancel');
    // Phoenix matches in order: the static find precedes the `:order_id` read
    // that would otherwise swallow `/orders/by_status`.
    expect(apiBlock.indexOf('"/orders/by_status"')).toBeLessThan(
      apiBlock.indexOf('get "/orders/:order_id"'),
    );
  });

  it("dotnet mounts the explicit templates under /api and drops the derived actions", async () => {
    const files = await generateSystemFiles(SCAFFOLD_SRC("dotnet"));
    const explicit = [...files].find(([k]) => k.endsWith("Api/SalesApiRoutesController.cs"))![1];
    const derived = [...files].find(([k]) => k.endsWith("Api/OrdersController.cs"))![1];
    expect(explicit).toContain('[HttpGet("/api/orders/{orderId}")]');
    expect(explicit).toContain('[HttpDelete("/api/orders/{orderId}")]');
    expect(derived).not.toContain('[HttpGet("{id}")]');
    expect(derived).not.toContain("[HttpDelete");
    expect(derived).not.toContain("[HttpPost");
    // The unclaimed probe and list read stay on the derived controller.
    expect(derived).toContain('[HttpGet("{id}/can_cancel")]');
    expect(derived).toContain("[HttpGet]");
  });

  it("java maps the explicit routes under /api and drops the derived mappings", async () => {
    const files = await generateSystemFiles(SCAFFOLD_SRC("java"));
    const explicit = [...files].find(([k]) => k.endsWith("api/SalesApiRoutesController.java"))![1];
    const derived = [...files].find(([k]) => /\/Orders?Controller\.java$/.test(k))![1];
    expect(explicit).toContain('@GetMapping("/api/orders/{orderId}")');
    expect(explicit).toContain('@DeleteMapping("/api/orders/{orderId}")');
    expect(derived).not.toContain("getOrderById(");
    expect(derived).not.toContain("@DeleteMapping");
    expect(derived).not.toContain("@PostMapping");
    expect(derived).toContain('@GetMapping("/{id}/can_cancel")');
  });

  it("node and python register each slot once, on the explicit router", async () => {
    const node = await generateSystemFiles(SCAFFOLD_SRC("node"));
    const nodeDerived = [...node].find(([k]) => k.endsWith("http/order.routes.ts"))![1];
    for (const id of [
      "getOrderById",
      "createOrder",
      "destroyOrder",
      "cancelOrder",
      "byStatusOrder",
    ])
      expect(nodeDerived).not.toContain(`operationId: "${id}"`);
    expect(nodeDerived).toContain('operationId: "can_cancelOrder"');
    expect(nodeDerived).toContain('operationId: "allOrder"');

    const py = await generateSystemFiles(SCAFFOLD_SRC("python"));
    const pyDerived = [...py].find(([k]) => k.endsWith("http/order_routes.py"))![1];
    expect(pyDerived).not.toContain('@router.get("/{id}"');
    expect(pyDerived).not.toContain("@router.post(");
    expect(pyDerived).not.toContain("@router.delete(");
    expect(pyDerived).toContain('@router.get("/{id}/can_cancel"');
  });

  it("a hand-written route claiming only get-by-id: .NET's create still answers a Location", async () => {
    // The derived create action normally names the derived read in
    // `CreatedAtAction(nameof(GetOrderById), …)`.  With that action yielded to
    // the explicit route there is nothing to name, so the path is spelled.
    const src = CLEAN_SRC("dotnet")
      .replace(
        "commandHandler Echo(text: string): string { return text }",
        "queryHandler Fetch(orderId: string): string { return orderId }",
      )
      .replace(
        "status: string\n",
        "status: string\n        create(code: string) { code := code }\n",
      )
      .replace(
        'route POST "/echo/{text}" -> Sales.Echo',
        'route GET "/orders/{orderId}" -> Sales.Fetch',
      );
    const derived = await fileEndingWith(src, "Api/OrdersController.cs");
    expect(derived).not.toContain("CreatedAtAction(");
    expect(derived).toContain('return Created($"/api/orders/{id.Value}", ');
    expect(derived).toContain("[HttpPost]");
  });

  it("elixir: a hand-written route taking over get-by-id registers AFTER the derived static find", async () => {
    // Only `GET /orders/{orderId}` is claimed; `find byStatus` stays derived.
    // Spliced `first`, the explicit `:order_id` clause would match
    // `/orders/by_status` before the derived find route ever saw it.
    const src = CLEAN_SRC("elixir")
      .replace(
        "commandHandler Echo(text: string): string { return text }",
        "queryHandler Fetch(orderId: string): string { return orderId }",
      )
      .replace(
        "repository Orders for Order { }",
        "repository Orders for Order { find byStatus(status: string): Order[] where this.status == status }",
      )
      .replace(
        'route POST "/echo/{text}" -> Sales.Echo',
        'route GET "/orders/{orderId}" -> Sales.Fetch',
      );
    const router = await fileEndingWith(src, "lib/d_web/router.ex");
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    expect(apiBlock).toContain('get "/orders/by_status", OrderController, :by_status');
    expect(apiBlock).not.toContain("OrderController, :show");
    expect(apiBlock.indexOf('get "/orders/by_status"')).toBeLessThan(
      apiBlock.indexOf('get "/orders/:order_id", ARoutesController'),
    );
  });

  it("a route on a slot the derived surface does not occupy goes `first` (the rule is per-route)", async () => {
    // `POST /orders` on an aggregate with NO canonical `create` claims nothing —
    // the auto-derived surface exposes no POST there (the REST create gates on
    // an explicit `create`) — and neither does `/quotes/{sku}`.
    const src = `
system ExternHandlerSys {
  subdomain Sales {
    context Sales {
      aggregate Order {
        customerId: string
        status: string
      }
      repository Orders for Order { }
      extern commandHandler PlaceOrder(customerId: string): Order id;
      extern queryHandler   GetQuote(sku: string): string;
    }
  }
  api SalesApi from Sales {
    route POST "/orders"        -> Sales.PlaceOrder
    route GET  "/quotes/{sku}"  -> Sales.GetQuote
  }
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d {
    platform: elixir
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}
`;
    const router = await fileEndingWith(src, "lib/d_web/router.ex");
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    expect(apiBlock).toContain('post "/orders", SalesApiRoutesController, :place_order');
    expect(apiBlock).toContain('get "/quotes/:sku", SalesApiRoutesController, :get_quote');
    // `GET /api/orders` (the auto index) and `POST /api/orders` (the explicit
    // route) differ in METHOD, so they are two slots, not one.
    expect(apiBlock).toContain('get "/orders", OrderController, :index');
  });
});
