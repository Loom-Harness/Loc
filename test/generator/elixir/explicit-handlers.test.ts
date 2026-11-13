// Plain Ecto/Phoenix emission for the explicit application/transport layer
// (`commandHandler` / `queryHandler` → `<App>.<Ctx>.Handlers.<Name>` `run/1`
// modules + one `<Api>RoutesController` spliced into `scope "/api"`).
//
// The runtime claims — load → mutate → save → return, the router under `/api`,
// path/body param binding with a value-object body, an aggregate return
// projected to its response, a repository delete, the not-found rung, and a
// paged `queryHandler` over `run(<Criterion>)` answering its filtered envelope —
// are driven on every backend by the corpus fixtures `handler-aggregate-ops`
// (a live row), `handler-triad` (an empty table) and `handler-paged-run`,
// against one wire golden each.  What stays here is what no booted request
// can observe:
//   • route ORDER in router.ex (ahead of the derived routes) and the root-scoped
//     scaffold-duplicate DELETE — collisions no fixture declares;
//   • the `extern` scaffold-once impl: `extern-handlers` proves the routed
//     handler fails loudly, but a 500 cannot tell the stub's throw from any
//     other server error, so the delegation stays pinned here;
//   • scaffolded record-param flattening: a `scaffoldApi` create answers a
//     bare id where the derived create answered `{ id }` (#4299), so no
//     `test e2e` block can hold the row it creates;
//   • the paged route's `page`/`pageSize`/`sort`/`dir` binding and bounds — a
//     routed handler's e2e arguments are its declared params only — and that
//     the synthesized find gets no route of its own.
import { describe, expect, it } from "vitest";
import { elixirDocumentedOperations } from "../../_helpers/elixir-openapi-ops.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order {
        code: string
        status: string
        operation cancel() { status := "cancelled" }
      }
      repository Orders for Order { }
      commandHandler CancelOrder(orderId: Order id): Order id {
        let o = Orders.get(orderId)
        o.cancel()
        return o.id
      }
      queryHandler GetStatus(orderId: Order id): string {
        let o = Orders.get(orderId)
        return o.status
      }
    }
  }
  api SalesApi from Sales {
    route POST "/orders/{orderId}/cancellations" -> Ordering.CancelOrder
    route GET  "/orders/{orderId}/status"        -> Ordering.GetStatus
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

async function files(): Promise<Map<string, string>> {
  return generateSystemFiles(SRC);
}

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

describe("elixir — explicit commandHandler/queryHandler → plain Ecto/Phoenix", () => {
  it('splices the explicit routes into `scope "/api"`, ahead of the derived routes (braces → :wireName path params)', async () => {
    // M-T6.73 — an explicit route is a DOMAIN route, so it serves under
    // `API_BASE_PATH` like every other route class.  It used to land in the root
    // `scope "/"`, where `POST /api/orders/.../cancellations` (the path every
    // caller asks for, including the one `src/system/e2e-render.ts` emits) 404'd
    // while the project compiled clean.
    //
    // Inside `scope "/api", ApiWeb` the controller is written in its BARE
    // (aliased) form, and the routes lead the scope: Phoenix matches in
    // declaration order and the explicit emitter runs after the per-aggregate
    // one, so an appended route with a static segment where a derived route has
    // a param would never match.
    const router = fileEndingWith(await files(), "lib/api_web/router.ex");
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    expect(apiBlock).toContain(
      'post "/orders/:orderId/cancellations", SalesApiRoutesController, :cancel_order',
    );
    expect(apiBlock).toContain(
      'get "/orders/:orderId/status", SalesApiRoutesController, :get_status',
    );
    // Ahead of the derived aggregate routes.
    expect(apiBlock.indexOf("SalesApiRoutesController")).toBeLessThan(
      apiBlock.indexOf("OrderController"),
    );
    // …and NOT the `!root:`-spliced, Web-qualified form the root scope emits.
    expect(router).not.toContain("ApiWeb.SalesApiRoutesController");
  });
});

// Regression (A3.3 review): a scaffolded `destroy` produces an explicit
// `DELETE /orders/{orderId}` route whose Phoenix path (`/orders/:orderId`) is
// identical — param names aside — to the always-on auto-CRUD `DELETE
// /orders/:id`.  Nesting the explicit route under `scope "/api"` made the
// auto-CRUD clause shadow it, failing `mix compile --warnings-as-errors`.
// Root-scoping keeps the two at distinct paths (`/orders/...` vs
// `/api/orders/...`), so they coexist and compile — matching every other backend.
const DESTROY_SRC = `
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
  deployable api { platform: elixir, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("elixir — scaffolded destroy route does not collide with auto-CRUD", () => {
  it("serves the explicit DELETE from /api and drops the auto-CRUD delete it took over", async () => {
    const router = fileEndingWith(await generateSystemFiles(DESTROY_SRC), "lib/api_web/router.ex");
    const rootBlock = router.slice(router.indexOf('scope "/" do'), router.indexOf('scope "/api"'));
    const apiBlock = router.slice(router.indexOf('scope "/api"'));
    // The explicit route owns the slot (D-EXPLICIT-ROUTE-WINS) …
    expect(apiBlock).toContain(
      'delete "/orders/:orderId", SalesApiRoutesController, :destroy_order',
    );
    expect(rootBlock).not.toContain("SalesApiRoutesController");
    // … so the derived delete is not registered: one clause per slot.
    expect(apiBlock).not.toContain("OrderController, :delete");
  });
});

// M-T5.10 handler-param rewrite — the scaffold now emits explicit
// commandHandler/queryHandlers that take a SINGLE `command`/`query` RECORD param
// (and reads declare `<Agg>Response`).  On Phoenix a handler works off a
// string-keyed `run/1` params map, so the record param is FLATTENED into its
// fields: each field destructures off `params` by the SAME snake key an
// equivalent flat param used (wire-preserving), and the body's `cmd.<field>` /
// `query.<field>` reads resolve to those flat locals.
const SCAFFOLD_SRC = `
system HandlerScaffold {
  subdomain Sales {
    context Ordering with scaffoldHandlers {
      valueobject Money { amount: decimal  currency: string  invariant amount >= 0 }
      enum Priority { low  high }
      aggregate Order {
        code: string
        status: string
        priority: Priority
        total: Money
        create(code: string, priority: Priority, status: string, total: Money) { }
        operation reprice(newTotal: Money) { total := newTotal }
        operation cancel() { status := "cancelled" }
        destroy { }
      }
      repository Orders for Order { }
      criterion OrdersByStatus(status: string) of Order = this.status == status
    }
  }
  api SalesApi with scaffoldApi(of: Sales)
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: elixir  contexts: [Ordering]  dataSources: [st]  serves: SalesApi  port: 5001 }
}
`;

describe("elixir — scaffolded record-param handlers flatten wire-preservingly", () => {
  it("create: flattens the command record into its fields; cmd.<field> → flat local", async () => {
    const h = fileEndingWith(
      await generateSystemFiles(SCAFFOLD_SRC),
      "lib/api/ordering/handlers/create_order.ex",
    );
    // The CreateOrderCommand record's fields destructure off the string-keyed
    // run/1 map by their wire keys (identical to the flat-param form)…
    expect(h).toContain(
      '%{"code" => code, "status" => status, "priority" => priority, "total" => total} = params',
    );
    // …and `cmd.<field>` in the factory body resolves to the flat destructured
    // local, NOT struct-dot on an unbound `cmd`.
    expect(h).toContain(
      "Context.create_order(%{code: code, status: status, priority: priority, total: total})",
    );
    expect(h).not.toContain("cmd");
    expect(h).toContain("{:ok, o.id}");
  });

  it("operation: path-scalar id + a command record field destructure together, op keyed by param name", async () => {
    const h = fileEndingWith(
      await generateSystemFiles(SCAFFOLD_SRC),
      "lib/api/ordering/handlers/reprice_order.ex",
    );
    // orderId (path scalar) + newTotal (flattened from RepriceOrderCommand), in
    // declaration order, both off the same string-keyed map.
    expect(h).toContain('%{"orderId" => order_id, "newTotal" => new_total} = params');
    expect(h).toContain("with {:ok, o} <- (case Context.get_order(order_id) do");
    // op-call keyed by the DECLARED op param name, valued by the flat local.
    expect(h).toContain('{:ok, _} <- Context.reprice_order(o, %{"newTotal" => new_total})');
    expect(h).not.toContain("cmd");
  });

  it("getById read: query record flattens; body returns the entity, projected by serialize/1", async () => {
    const h = fileEndingWith(
      await generateSystemFiles(SCAFFOLD_SRC),
      "lib/api/ordering/handlers/get_order.ex",
    );
    // query.orderId → the flat `order_id` off the wire key `orderId`, the same
    // key an id param uses.
    expect(h).toContain('%{"orderId" => order_id} = params');
    expect(h).toContain("with {:ok, o} <- (case Context.get_order(order_id) do");
    // The body returns the raw entity (returnType is OrderResponse — normalised
    // back to the entity); the boundary projects it via the controller serialize.
    expect(h).toContain("{:ok, o}");
    expect(h).not.toContain("query");
  });

  it("controller serialize/1 projects a collection element-wise (find returns an entity list)", async () => {
    const ctrl = fileEndingWith(
      await generateSystemFiles(SCAFFOLD_SRC),
      "lib/api_web/controllers/sales_api_routes_controller.ex",
    );
    // A list result maps serialize over each element — a bare Ecto-struct list is
    // not Jason-encodable, so without this a find would 500 on encode.
    expect(ctrl).toContain(
      "defp serialize(list) when is_list(list), do: Enum.map(list, &serialize/1)",
    );
    // single-struct + scalar clauses unchanged (wire-preserving).
    expect(ctrl).toContain(
      "defp serialize(%_{} = struct), do: struct |> Map.from_struct() |> Map.drop([:__meta__, :__struct__])",
    );
  });
});

// An `extern` handler is bodyless: the generated dispatch delegates to a
// scaffold-once, user-owned impl the user fills in (extern-handler Phase 1).
const EXTERN_SRC = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order { code: string }
      repository Orders for Order { }
      extern commandHandler PlaceOrder(code: string): Order id;
      extern queryHandler GetQuote(orderId: Order id): string;
    }
  }
  api SalesApi from Sales {
    route POST "/orders" -> Ordering.PlaceOrder
    route GET  "/orders/{orderId}/quote" -> Ordering.GetQuote
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;
describe("elixir — extern commandHandler / queryHandler", () => {
  it("the dispatch module delegates to the scaffold-once impl via config", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const dispatch = fileEndingWith(m, "lib/api/ordering/handlers/place_order.ex");
    expect(dispatch).toContain(
      "Application.get_env(:api, __MODULE__, Api.Ordering.Handlers.PlaceOrderImpl).run(params)",
    );
  });

  it("emits a scaffold-once impl module that raises", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const impl = fileEndingWith(m, "lib/api/ordering/handlers/place_order_impl.ex");
    expect(impl.split("\n")[0]).toContain("loom:scaffold-once");
    expect(impl).toContain("defmodule Api.Ordering.Handlers.PlaceOrderImpl do");
    expect(impl).toContain("raise Api.NotImplementedError,");
  });
});

// paged-run queryHandler (`queryHandler H(...): <Agg> paged { let r =
// Repo.run(<Criterion>(args))  return r }`) → the api routes controller action
// calls the aggregate context's synthesized paged FIND function directly
// (`<find>_<agg>`), coercing page/pageSize with the shared `page_param/3`, and
// renders the `{items,…}` envelope with items serialised.  No `run/1` handler
// module is emitted for it, and the aggregate controller does not auto-expose it.
const PAGED_SRC = `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        let r = Orders.all(InRegion(rgn))
        return r
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: elixir, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`;
describe("elixir — paged-run queryHandler over run(criterion)", () => {
  it("the routes controller action bounds page/pageSize from the query string", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const ctrl = fileEndingWith(m, "lib/d_web/controllers/a_routes_controller.ex");
    expect(ctrl).toContain('page_param(params, "page", 1, 1000000)');
    expect(ctrl).toContain("defp page_param(params, key, default, limit) do");
  });

  it("emits no run/1 handler module for the paged queryHandler", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    expect([...m.keys()].some((k) => k.endsWith("handlers/list_in_region.ex"))).toBe(false);
  });

  it("registers only the queryHandler route (synthesized find not auto-exposed)", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const router = fileEndingWith(m, "lib/d_web/router.ex");
    expect(router).toContain('get "/orders/projections/in_region"');
    expect(router).not.toContain("find_all_by_in_region");
  });
});

// A routed handler's `run/1` receives Phoenix's `params` with the keys the client
// sent, so it must match each param by the name the route's OWN spec publishes —
// a multi-word query param is `commitSha` on the wire, and matching
// `"commit_sha"` turned every well-formed request into a MatchError (500).
const WIRE_KEY_SRC = `
system Delivery {
  subdomain Ci {
    context Builds {
      aggregate Build with crudish {
        commitSha: string
      }
      repository Builds for Build { }
      criterion BySha(commitSha: string) of Build = this.commitSha == commitSha
      queryHandler GetBuildBySha(commitSha: string): Build {
        if let b = Builds.find(BySha(commitSha)) {
          return b
        } else {
          notFound "not_found"
        }
      }
      queryHandler GetBuildByShaAt(buildId: Build id, commitSha: string): Build {
        if let b = Builds.find(BySha(commitSha)) {
          return b
        } else {
          notFound "not_found"
        }
      }
    }
  }
  api CiApi from Ci {
    route GET "/builds/by_sha" -> Builds.GetBuildBySha
    route GET "/builds/{buildId}/by_sha" -> Builds.GetBuildByShaAt
  }
  storage pg { type: postgres }
  resource st { for: Builds, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Builds], dataSources: [st], serves: CiApi, port: 5001 }
}
`;

describe("elixir — a routed handler matches its params by wire name", () => {
  it("query and path params bind by the name the router and spec publish", async () => {
    const files = await generateSystemFiles(WIRE_KEY_SRC);
    const h = fileEndingWith(files, "handlers/get_build_by_sha.ex");
    const hAt = fileEndingWith(files, "handlers/get_build_by_sha_at.ex");
    const router = fileEndingWith(files, "lib/api_web/router.ex");
    const spec = elixirDocumentedOperations(files).get("get /api/builds/by_sha");
    expect(spec, "the routed action declares its operation").toBeDefined();
    expect(spec).toContain("name: :commitSha, in: :query");
    expect(h).toContain('%{"commitSha" => commit_sha} = params');
    // The path segment and the handler agree on the key, too.
    expect(router).toContain('get "/builds/:buildId/by_sha"');
    expect(hAt).toContain('"commitSha" => commit_sha');
    expect(hAt).not.toMatch(/"commit_sha"|"build_id"/);
  });
});

// Phoenix hands a routed action every query/path value as a binary, and
// nothing between the router and `run/1` checks it: a missing required param
// is a MatchError in `run/1`'s destructure (500), a malformed int a raise in
// the coercion (500), and a paged criterion param reaches the query as a raw
// string.  Each action checks its query/path params against the published
// type first (the `field-invalid` 422), then hands `run/1` / the paged find the
// coerced values, keyed by the wire name the router binds.
const CHECKED_SRC = `
system Catalog {
  subdomain Core {
    context Shop with scaffoldPaged(of: OrdersOver), scaffoldGet(of: ByCustomer) {
      aggregate Order with crudish {
        customerId: string
        total: int
      }
      repository Orders for Order
      criterion OrdersOver(minTotal: int) of Order = this.total >= minTotal
      criterion ByCustomer(customerId: string) of Order = this.customerId == customerId
      queryHandler Sum(leftValue: int, rightValue: int, note: string?): int { return leftValue + rightValue }
    }
  }
  api CatalogApi with scaffoldPagedApi(of: OrdersOver), scaffoldGetApi(of: ByCustomer) from Core {
    route GET "/sum/{leftValue}" -> Shop.Sum
  }
  storage pg { type: postgres }
  resource orderState { for: Shop, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Shop], dataSources: [orderState], serves: CatalogApi, port: 4000 }
}
`;

/** The body of `def <action>(conn, params) do … end`. */
function actionBody(ctrl: string, action: string): string {
  const m = ctrl.match(
    new RegExp(`  def ${action}\\(conn, params\\) do\\n([\\s\\S]*?)\\n  end\\n`),
  );
  expect(m, `action ${action} not emitted`).not.toBeNull();
  return m![1]!;
}

describe("elixir — a routed action checks and coerces its query/path params", () => {
  it("checks every query/path param before run/1 and coerces by wire name", async () => {
    const m = await generateSystemFiles(CHECKED_SRC);
    const ctrl = fileEndingWith(m, "lib/api_web/controllers/catalog_api_routes_controller.ex");
    const sum = actionBody(ctrl, "sum");
    expect(sum).toContain(
      'case __check_find_params(params, [{"leftValue", {:integer, -2147483648, 2147483647}, true}, {"rightValue", {:integer, -2147483648, 2147483647}, true}, {"note", :string, false}]) do',
    );
    expect(sum).toContain("ProblemDetails.validation_errors_response(conn, param_errors)");
    // The path param is keyed by its wire name, as the router binds it; an
    // absent optional param is bound to nil so run/1's destructure matches.
    expect(sum).toContain(
      'params = Map.merge(params, %{"leftValue" => __find_int(params["leftValue"]), "rightValue" => __find_int(params["rightValue"]), "note" => params["note"]})',
    );
    expect(sum).not.toMatch(/"left_value"|String\.to_integer/);
    expect(sum.indexOf("__check_find_params")).toBeLessThan(sum.indexOf(".run(params)"));

    const get = actionBody(ctrl, "get_order_by_customer");
    expect(get).toContain('case __check_find_params(params, [{"customerId", :string, true}]) do');

    const paged = actionBody(ctrl, "list_order_by_orders_over");
    expect(paged).toContain(
      'case __check_find_params(params, [{"minTotal", {:integer, -2147483648, 2147483647}, true}]) do',
    );
    expect(paged).toContain('__find_int(params["minTotal"]),');

    expect(ctrl).toContain("defp __check_find_params(params, specs) do");
    expect(ctrl).toContain("defp __find_int(v) when is_binary(v) do");
    const pd = fileEndingWith(m, "lib/api_web/problem_details.ex");
    expect(pd).toContain("def validation_errors_response(conn, errors) when is_list(errors) do");
  });

  it("a body-carrying route checks only its path params", async () => {
    const m = await generateSystemFiles(SRC);
    const ctrl = fileEndingWith(m, "lib/api_web/controllers/sales_api_routes_controller.ex");
    expect(actionBody(ctrl, "cancel_order")).toContain(
      'case __check_find_params(params, [{"orderId", :uuid, true}]) do',
    );
  });
});

// A malformed `date` must be refused at the boundary: `__find_date/1` hands an
// unparseable string through unchanged, and Postgrex refuses a binary where a
// date is expected — a 500 instead of the field-invalid 422.
const DATE_PARAM_SRC = `
system Ledger {
  subdomain Core {
    context Books {
      aggregate Entry with crudish {
        bookedOn: date
      }
      repository Entries for Entry
      criterion OnDay(day: date) of Entry = this.bookedOn == day
      queryHandler CountOn(day: date): int {
        let r = Entries.all(OnDay(day))
        return r.count()
      }
    }
  }
  api LedgerApi from Core {
    route GET "/entries/count_on" -> Books.CountOn
  }
  storage pg { type: postgres }
  resource st { for: Books, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Books], dataSources: [st], serves: LedgerApi, port: 4000 }
}
`;

describe("elixir — a routed date param is checked, not passed through", () => {
  it("checks a date query param as an ISO 8601 date", async () => {
    const m = await generateSystemFiles(DATE_PARAM_SRC);
    const ctrl = fileEndingWith(m, "lib/api_web/controllers/ledger_api_routes_controller.ex");
    expect(actionBody(ctrl, "count_on")).toContain(
      'case __check_find_params(params, [{"day", :date, true}]) do',
    );
    expect(ctrl).toContain("defp __find_param_error(value, :date, _required) do");
    expect(ctrl).toContain("case Date.from_iso8601(value) do");
  });
});
