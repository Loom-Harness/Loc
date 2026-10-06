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
// The second describe is the REGRESSION half, and it is why
// `src/generator/_api/explicit-route-mount.ts` exists at all.  `with
// scaffoldHandlers` + `with scaffoldApi` synthesises one explicit handler per
// create / operation / find / get-by-id / destroy, so the explicit route list
// becomes a 1:1 duplicate of the always-on auto-derived REST surface.  Moving
// THOSE under `/api` puts two handlers on one slot, which elixir reports as a
// `mix compile --warnings-as-errors` failure (an unreachable `do_match` clause),
// .NET as `AmbiguousMatchException`, and java as `Ambiguous handler methods
// mapped` — all at the price of a route that already works.  A colliding route
// therefore keeps its historical root-absolute mounting.
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

/** `scaffoldHandlers` + `scaffoldApi`: every explicit route duplicates an
 *  auto-derived one, so every one of them must stay where it was. */
const SCAFFOLD_SRC = (platform: string) => `
system Shop {
  subdomain Sales {
    context Ordering with scaffoldHandlers {
      aggregate Order {
        code: string
        status: string
        operation cancel() { status := "cancelled" }
        destroy { }
      }
      repository Orders for Order { }
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

describe("M-T6.73 — a route that DUPLICATES an auto-derived one keeps its root mounting", () => {
  it("elixir leaves the scaffold-duplicate routes in the root scope", async () => {
    const router = await fileEndingWith(SCAFFOLD_SRC("elixir"), "lib/api_web/router.ex");
    const rootBlock = router.slice(router.indexOf('scope "/" do'), router.indexOf('scope "/api"'));
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    // `GET /orders/:order_id` would collide with the auto-CRUD `GET
    // /api/orders/:id` — Phoenix ignores param names, so the second clause is
    // unreachable and `mix compile --warnings-as-errors` fails.
    expect(rootBlock).toContain(
      'get "/orders/:order_id", ApiWeb.SalesApiRoutesController, :get_order',
    );
    expect(rootBlock).toContain(
      'delete "/orders/:order_id", ApiWeb.SalesApiRoutesController, :destroy_order',
    );
    // The derived routes own the `/api` slots, alone.
    expect(apiBlock).toContain('get "/orders/:id", OrderController, :show');
    expect(apiBlock).not.toContain("SalesApiRoutesController");
  });

  it("dotnet leaves the scaffold-duplicate templates root-absolute", async () => {
    const ctrl = await fileEndingWith(SCAFFOLD_SRC("dotnet"), "Api/SalesApiRoutesController.cs");
    expect(ctrl).toContain('[HttpGet("/orders/{orderId}")]');
    expect(ctrl).toContain('[HttpDelete("/orders/{orderId}")]');
    // Nothing moved under /api, where AmbiguousMatchException would fire.
    expect(ctrl).not.toContain('("/api/orders/{orderId}")');
  });

  it("java leaves the scaffold-duplicate mappings un-prefixed", async () => {
    const ctrl = await fileEndingWith(SCAFFOLD_SRC("java"), "api/SalesApiRoutesController.java");
    expect(ctrl).toContain('@GetMapping("/orders/{orderId}")');
    expect(ctrl).toContain('@DeleteMapping("/orders/{orderId}")');
    expect(ctrl).not.toContain('@GetMapping("/api/orders/{orderId}")');
  });

  it("a NON-duplicate route in the same api still moves (the rule is per-route)", async () => {
    // `POST /orders` on an aggregate with NO canonical `create` is not a
    // duplicate — the auto-derived surface exposes no POST there (the REST
    // create gates on an explicit `create`) — so it moves, while `/quotes/{sku}`
    // obviously does.  Proves the collision test is per-route, not per-api.
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
