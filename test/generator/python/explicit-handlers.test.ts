// Python / FastAPI emission for the explicit application/transport layer
// (`commandHandler` / `queryHandler` → `app/application/<name>.py`, and
// `route <M> "<path>" -> <Ctx>.<Handler>` → one APIRouter per served api).
//
// M-T9.42 slice 2: the RUNTIME claims this file used to pin as emitted text —
// the handler modules (load → mutate → save → return), the router registered
// under `/api` in main.py, the `<Handler>Body` model carrying non-path params
// incl. a value object, and an aggregate return projected through `to_wire` —
// are now driven on all five backends by the corpus fixtures
// `handler-aggregate-ops` (a live row) and `handler-triad` (an empty table)
// against one wire golden.  What stays here is what no booted request can
// observe:
//   • the `extern` scaffold-once impl (a user-owned stub that raises by design);
//   • scaffolded record-param flattening and the paged-run shape, which neither
//     fixture declares (the next promotion candidates, not covered yet).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

// M-T5.10 handler-param rewrite — a scaffolded handler takes a SINGLE
// `command`/`query` RECORD param.  The Python handler FLATTENS the record into
// its fields as flat domain-typed `def` params (byte-identical to the flat-param
// form), renders the body's `cmd.<field>` as the flat field local, and — for a
// read — declares `<Agg>Response`, mapped back to the entity and projected via
// `repo.to_wire(...)` (a collection read comprehends each element).  The router's
// `<Handler>Body` Pydantic model carries the SAME flat fields, so the wire is
// unchanged.
const SCAFFOLD_SRC = `
system Shop {
  subdomain Sales {
    context Ordering with scaffoldHandlers {
      valueobject Money { amount: decimal  currency: string }
      aggregate Order {
        code: string
        status: string
        total: Money
        create(code: string) { }
        operation reprice(newTotal: Money) { total := newTotal }
      }
      repository Orders for Order {
        find byStatus(status: string): Order[] where this.status == status
      }
    }
  }
  api SalesApi with scaffoldApi(of: Sales)
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: python, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("python — scaffolded handlers consume record params (M-T5.10)", () => {
  it("create handler flattens the command record into flat def params + reads cmd.<field>", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    const h = fileEndingWith(m, "app/application/create_order.py");
    // The `cmd: CreateOrderCommand` record is FLATTENED into its fields as flat
    // domain-typed def params (not a single `cmd` object param).
    expect(h).toContain(
      "async def create_order(session: AsyncSession, code: str, status: str, total: Money) -> OrderId:",
    );
    // Body reads `cmd.code` / `cmd.status` / `cmd.total` as the flat field locals.
    expect(h).toContain("o = Order.create(code=code, status=status, total=total)");
    expect(h).toContain("return o.id");
    // The aggregate domain class is imported for the `Order.create(...)` factory.
    expect(h).toContain("from app.domain.order import Order");
  });

  it("operation handler flattens the command record + reads the VO field local", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    const h = fileEndingWith(m, "app/application/reprice_order.py");
    // Path-bound id stays a separate flat param; the record field flattens in.
    expect(h).toContain(
      "async def reprice_order(session: AsyncSession, order_id: OrderId, new_total: Money) -> None:",
    );
    expect(h).toContain("o.reprice(new_total)");
  });

  it("find handler projects the <Agg>Response collection via to_wire per element", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    const h = fileEndingWith(m, "app/application/by_status_order.py");
    // The declared `ByStatusQuery` record flattens to `status`; the `OrderResponse[]`
    // return normalises to the entity and projects each element via to_wire.
    expect(h).toContain(
      "async def by_status_order(session: AsyncSession, status: str) -> list[dict[str, object]]:",
    );
    expect(h).toContain("r = await orders.by_status(status)");
    expect(h).toContain("return [orders.to_wire(__e) for __e in r]");
  });

  it("get-by-id handler projects the single <Agg>Response via to_wire", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    const h = fileEndingWith(m, "app/application/get_order.py");
    expect(h).toContain(
      "async def get_order(session: AsyncSession, order_id: OrderId) -> dict[str, object]:",
    );
    expect(h).toContain("return orders.to_wire(o)");
  });

  it("the router's <Handler>Body carries the SAME flat fields as the record (wire-invariant)", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    const ctrl = fileEndingWith(m, "app/http/sales_api_routes.py");
    // The command record's fields ARE the request body fields (byte-identical to
    // the flat-param form); Money rides as its wire model MoneyModel.
    expect(ctrl).toContain("class CreateOrderBody(BaseModel):");
    expect(ctrl).toContain("    code: WireStr");
    expect(ctrl).toContain("    status: WireStr");
    expect(ctrl).toContain("    total: MoneyModel");
    // Call args flatten in declared order; the VO field coerces to the domain class.
    expect(ctrl).toContain(
      "result = await create_order(session, body.code, body.status, Money(body.total.amount, body.total.currency))",
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
  deployable api { platform: python, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;
describe("python — extern commandHandler / queryHandler", () => {
  it("the dispatch module delegates to the scaffold-once impl", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const dispatch = fileEndingWith(m, "app/application/place_order.py");
    expect(dispatch).toContain(
      "from app.application.impl.place_order_impl import place_order_impl",
    );
    expect(dispatch).toContain("return await place_order_impl(code)");
  });

  it("emits a scaffold-once impl that raises", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const impl = fileEndingWith(m, "app/application/impl/place_order_impl.py");
    expect(impl.split("\n")[0]).toContain("loom:scaffold-once");
    expect(impl).toContain("async def place_order_impl(code: str)");
    expect(impl).toContain("raise NotImplementedError(");
  });
});

// paged-run queryHandler (`queryHandler H(...): <Agg> paged { let r =
// Repo.run(<Criterion>(args))  return r }`) → a GET whose criterion params ride
// the query string alongside page/pageSize/sort/dir; the handler module calls
// the synthesized paged FIND repo method and returns the wire envelope.
const PAGED_SRC = `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        let r = Orders.run(InRegion(rgn))
        return r
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: python, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`;
describe("python — paged-run queryHandler over run(criterion)", () => {
  it("emits a paged handler module returning the wire envelope", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const handler = fileEndingWith(m, "app/application/list_in_region.py");
    expect(handler).toContain(
      "async def list_in_region(session: AsyncSession, rgn: str, page: int, page_size: int, sort: str, dir: str) -> dict[str, object]:",
    );
    expect(handler).toContain(
      "result = await orders.find_all_by_in_region(rgn, page, page_size, sort, dir)",
    );
    expect(handler).toContain('"items": [orders.to_wire(__e) for __e in result.items]');
    expect(handler).toContain('"pageSize": result.page_size');
    expect(handler).toContain('"totalPages": result.total_pages');
  });

  it("the route exposes page/pageSize/sort/dir query params and calls the handler", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const routes = fileEndingWith(m, "app/http/a_routes.py");
    expect(routes).toContain('@router.get("/orders/projections/in_region"');
    expect(routes).toMatch(
      // `rgn` is a wire string bound for a SQL text parameter, so it carries the
      // NUL guard (F20); `sort`/`dir` are framework knobs, not wire values.
      /rgn: WireStr, session: SessionDep, page: Annotated\[int, Query\(ge=1, le=1000000\)\] = 1, pageSize: Annotated\[int, Query\(ge=1, le=500\)\] = 20, sort: str = "id", dir: str = "asc"/,
    );
    expect(routes).toContain(
      "return await list_in_region(session, rgn, page, pageSize, sort, dir)",
    );
  });

  it("the aggregate router does NOT auto-expose the synthesized find", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const orderRoutes = fileEndingWith(m, "app/http/order_routes.py");
    expect(orderRoutes).not.toContain("in_region");
    expect(orderRoutes).not.toContain("find_all_by_in_region");
  });
});
