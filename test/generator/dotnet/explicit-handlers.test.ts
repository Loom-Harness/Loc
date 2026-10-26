// .NET Mediator emission for the explicit application/transport layer
// (`commandHandler` / `queryHandler` + `route <M> "<path>" -> <Ctx>.<Handler>`
// onto the source-generated martinothamar/Mediator seam).
//
// The runtime claims — load → mutate → save → return, the router under `/api`,
// path/body param binding with a value-object body, an aggregate return
// projected to its response, a repository delete, the not-found rung, and a
// paged `queryHandler` over `run(<Criterion>)` answering its filtered envelope —
// are driven on every backend by the corpus fixtures `handler-aggregate-ops`
// (a live row), `handler-triad` (an empty table) and `handler-paged-run`,
// against one wire golden each.  What stays here is what no booted request
// can observe:
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
import { generateSystemFiles } from "../../_helpers/generate.js";

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

// An `extern` handler is bodyless: the Mediator command/handler + route wire up
// as usual, but the handler delegates to a ctor-injected `I<Name>Handler` port
// the user's scaffold-once `<Name>HandlerImpl` ([ExternHandler]) supplies.
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
  deployable api { platform: dotnet, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe(".NET — extern commandHandler / queryHandler", () => {
  it("the Mediator handler delegates to the injected port", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const handler = fileEndingWith(m, "Application/Handlers/PlaceOrderHandler.cs");
    expect(handler).toContain("private readonly IPlaceOrderHandler _impl;");
    expect(handler).toContain("return await _impl.Handle(command.Code, cancellationToken);");
  });

  it("emits a scaffold-once [ExternHandler] impl that throws", async () => {
    const m = await generateSystemFiles(EXTERN_SRC);
    const impl = fileEndingWith(m, "Application/Handlers/PlaceOrderExternHandler.cs");
    expect(impl.split("\n")[0]).toContain("loom:scaffold-once");
    expect(impl).toContain("[ExternHandler]");
    expect(impl).toContain("public sealed class PlaceOrderExternHandler : IPlaceOrderHandler");
    expect(impl).toContain("throw new NotImplementedException(");
    // Program.cs verifies the impl is registered at startup (Scrutor scan).
    const program = fileEndingWith(m, "Program.cs");
    expect(program).toContain("Api.Application.Handlers.IPlaceOrderHandler");
  });
});

// M-T5.10 handler-param rewrite: a scaffolded handler takes a single
// `command`/`query` RECORD param.  On .NET the Mediator record FLATTENS the
// record's fields (byte-identical to the flat form) and `cmd.<field>` renders as
// `command.<Field>`; a read declares `<Agg>Response` but the handler still
// returns the entity (route projects at the boundary).
const SCAFFOLD_SRC = `
system Shop {
  subdomain Sales {
    context Ordering with scaffoldHandlers {
      aggregate Order {
        code: string
        status: string
        create(code: string, status: string) { }
        operation setNote(note: string) { status := note }
      }
      repository Orders for Order { }
      criterion OrdersByStatus(status: string) of Order = this.status == status
    }
  }
  api SalesApi with scaffoldApi(of: Sales)
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: dotnet, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

describe("dotnet — scaffolded handlers consume command/query record params", () => {
  it("flattens a command record into the Mediator record + body and reads command.<Field>", async () => {
    const files = await generateSystemFiles(SCAFFOLD_SRC);
    // Create: the command record's fields flatten into the Mediator record ctor.
    const createRec = fileEndingWith(files, "Application/Orders/Commands/CreateOrderCommand.cs");
    expect(createRec).toContain(
      "public sealed record CreateOrderCommand(string Code, string Status)",
    );
    const createH = fileEndingWith(files, "Application/Orders/Commands/CreateOrderHandler.cs");
    expect(createH).toContain("Order.Create(code: command.Code, status: command.Status)");
    // Operation: id stays a path param, the op's params ride the record → command.<Field>.
    const setNoteH = fileEndingWith(files, "Application/Orders/Commands/SetNoteOrderHandler.cs");
    expect(setNoteH).toContain("o.SetNote(command.Note)");
    // getById: query record flattens the id; the handler returns the ENTITY,
    // the route projects to OrderResponse.
    const getRec = fileEndingWith(files, "Application/Orders/Queries/GetOrderQuery.cs");
    expect(getRec).toContain("public sealed record GetOrderQuery(OrderId OrderId) : IQuery<Order>");
    const ctrl = fileEndingWith(files, "Api/SalesApiRoutesController.cs");
    expect(ctrl).toContain("[FromBody] CreateOrderBody body");
    expect(ctrl).toContain("new SetNoteOrderCommand(new OrderId(orderId), body.Note)");
  });
});

// paged-run queryHandler (`queryHandler H(...): <Agg> paged { let r =
// Repo.run(<Criterion>(args))  return r }`) → a dedicated Mediator Query +
// Handler over the synthesized paged FIND repo method (returning the
// wire-projected `Paged<Agg>Response`), plus a GET controller action with
// [FromQuery] page/pageSize/sort/dir + the criterion params.
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
  deployable d { platform: dotnet, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`;
describe("dotnet — paged-run queryHandler over run(criterion)", () => {
  it("the controller action exposes [FromQuery] page/pageSize/sort/dir and dispatches the Query", async () => {
    const ctrl = fileEndingWith(await generateSystemFiles(PAGED_SRC), "Api/ARoutesController.cs");
    expect(ctrl).toContain('[HttpGet("/api/orders/projections/in_region")]');
    expect(ctrl).toContain(
      "[FromQuery] [System.ComponentModel.DataAnnotations.Range(1, 1000000)] int page = 1",
    );
    expect(ctrl).toContain(
      "await _mediator.Send(new ListInRegionQuery(rgn, page, pageSize, sort, dir))",
    );
  });

  it("the aggregate controller does NOT auto-expose the synthesized find", async () => {
    const m = await generateSystemFiles(PAGED_SRC);
    const key = [...m.keys()].find((k) => k.endsWith("Api/OrdersController.cs"));
    if (key) expect(m.get(key)!).not.toContain("FindAllByInRegion");
  });
});
