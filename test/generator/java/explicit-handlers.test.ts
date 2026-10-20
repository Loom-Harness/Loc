// Java / Spring emission for the explicit application/transport layer
// (`commandHandler` / `queryHandler` + `route <M> "<path>" -> <Ctx>.<Handler>`
// onto a `@Service` bean per handler and one `@RestController` per served api).
//
// M-T9.42 slice 2: the RUNTIME claims this file used to pin as emitted text —
// the handler beans (load → mutate → save → return), the controller dispatching
// each route under `/api`, the {token} → @PathVariable / rest → @RequestBody
// split with a value-object body, an aggregate return projected through
// `<Agg>Response.from`, and the scalar/id return — are now driven on all five
// backends by the corpus fixtures `handler-aggregate-ops` (a live row) and
// `handler-triad` (an empty table) against one wire golden.  The id return is
// the proof the promotion was worth it: this file asserted it as
// `ResponseEntity.ok(result)`, which Jackson serialised as `{"value": "…"}` —
// the only backend not answering the bare id.  What stays here is what no
// booted request can observe:
//   • the `extern` scaffold-once impl (a user-owned stub that throws by design);
//   • scaffolded record-param flattening and the paged-run shape, which neither
//     fixture declares (the next promotion candidates, not covered yet).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

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
  deployable api { platform: java, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;
// M-T5.10 handler-param rewrite: a scaffolded handler takes a single
// `command`/`query` RECORD param.  On Java the `@Service handle(...)` FLATTENS
// the record's fields (byte-identical to the flat-param form) and `cmd.<field>`
// reads the flattened flat param; a read declares `<Agg>Response` but the
// handler still returns the ENTITY (the controller projects at the boundary).
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
        operation setNote(note: string) { status := note }
        operation reprice(newTotal: Money) { total := newTotal }
        operation cancel() { status := "cancelled" }
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
  deployable api { platform: java, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("java — scaffolded handlers consume command/query record params", () => {
  it("flattens a command record into the handle() signature + body record and reads the flat field", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    // Create: the command record's fields flatten into the handle() params, and
    // `cmd.<field>` reads them bare (no `cmd.code()` accessor).
    const createH = fileEndingWith(m, "CreateOrderHandler.java");
    expect(createH).toContain("public OrderId handle(String code, String status, Money total) {");
    expect(createH).toContain("var o = Order.create(code, status, total);");
    expect(createH).not.toContain("cmd.");
    // Operation: the id stays a flat param, the op's params ride the record.
    const setNoteH = fileEndingWith(m, "SetNoteOrderHandler.java");
    expect(setNoteH).toContain("public void handle(OrderId orderId, String note) {");
    expect(setNoteH).toContain("o.setNote(note);");
    expect(setNoteH).not.toContain("cmd.");
  });

  it("a read declares <Agg>Response but the handler returns the entity", async () => {
    const m = await generateSystemFiles(SCAFFOLD_SRC);
    // getById: the internal handle() types on the entity (not OrderResponse).
    const getH = fileEndingWith(m, "GetOrderHandler.java");
    expect(getH).toContain("public Order handle(OrderId orderId) {");
    expect(getH).toContain("return o;");
    expect(getH).not.toContain("OrderResponse");
    // find: a collection read types on List<Order>, returns the raw list.
    const byStatusH = fileEndingWith(m, "ByStatusOrderHandler.java");
    expect(byStatusH).toContain("public List<Order> handle(String status) {");
    expect(byStatusH).toContain("var r = ordersRepository.byStatus(status);");
    expect(byStatusH).toContain("return r;");
    expect(byStatusH).not.toContain("OrderResponse");
  });

  it("the controller reads the record's fields + projects the response at the boundary", async () => {
    const ctrl = fileEndingWith(
      await generateSystemFiles(SCAFFOLD_SRC),
      "SalesApiRoutesController.java",
    );
    // Body records carry the flattened fields, byte-identical to the flat form.
    expect(ctrl).toContain("record CreateOrderBody(String code, String status, Money total) {}");
    expect(ctrl).toContain("@RequestBody CreateOrderBody body");
    // Command call args read the flattened fields off the body record.
    expect(ctrl).toContain(
      "var result = createOrderHandler.handle(body.code(), body.status(), body.total());",
    );
    expect(ctrl).toContain("setNoteOrderHandler.handle(new OrderId(orderId), body.note());");
    // getById projects the entity to its wire DTO at the boundary.
    expect(ctrl).toContain("return ResponseEntity.ok(OrderResponse.from(result));");
    // find projects EACH element of the collection.
    expect(ctrl).toContain(
      "return ResponseEntity.ok(result.stream().map(OrderResponse::from).toList());",
    );
  });
});

describe("java — extern commandHandler / queryHandler", () => {
  it("the @Service handler ctor-injects the port and delegates", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const handler = fileEndingWith(m, "PlaceOrderHandler.java");
    expect(handler).toContain("private final PlaceOrderPort placeOrderPort;");
    expect(handler).toContain("return placeOrderPort.handle(code);");
    // The port interface is generated alongside.
    const port = fileEndingWith(m, "PlaceOrderPort.java");
    expect(port).toContain("public interface PlaceOrderPort {");
    expect(port).toContain("OrderId handle(String code);");
  });

  it("emits a scaffold-once @Service impl that throws", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const impl = fileEndingWith(m, "PlaceOrderHandlerImpl.java");
    expect(impl.split("\n")[0]).toContain("loom:scaffold-once");
    expect(impl).toContain("public class PlaceOrderHandlerImpl implements PlaceOrderPort");
    expect(impl).toContain("throw new UnsupportedOperationException(");
  });
});

// paged-run queryHandler (`queryHandler H(...): <Agg> paged { let r =
// Repo.run(<Criterion>(args))  return r }`) → a `@Service` bean over the
// synthesized paged FIND repo method + a GET action with page/pageSize/sort/dir
// @RequestParams returning the wire-projected `Paged<Agg>Response` envelope.
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
  deployable d { platform: java, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`;
describe("java — paged-run queryHandler over run(criterion)", () => {
  it("the handler bean delegates to the synthesized paged FIND repo method", async () => {
    const h = fileEndingWith(await generateSystemFiles(PAGED_SRC), "ListInRegionHandler.java");
    expect(h).toContain(
      "public Paged<Order> handle(String rgn, int page, int pageSize, String sort, String dir)",
    );
    expect(h).toContain(
      "return ordersRepository.findAllByInRegion(rgn, page, pageSize, sort, dir);",
    );
  });

  it("the controller action exposes page/pageSize/sort/dir and returns the projected envelope", async () => {
    const ctrl = fileEndingWith(await generateSystemFiles(PAGED_SRC), "ARoutesController.java");
    expect(ctrl).toContain('@GetMapping("/api/orders/projections/in_region")');
    expect(ctrl).toContain(
      '@RequestParam(defaultValue = "1") @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(1000000) int page',
    );
    expect(ctrl).toContain(
      "var result = listInRegionHandler.handle(rgn, page, pageSize, sort, dir);",
    );
    expect(ctrl).toContain("new Paged<>(result.items().stream().map(OrderResponse::from).toList()");
  });

  it("the aggregate controller does NOT auto-expose the synthesized find", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const key = [...m.keys()].find((k) => k.endsWith("OrderController.java"));
    if (key) expect(m.get(key)!).not.toContain("in_region");
  });
});
