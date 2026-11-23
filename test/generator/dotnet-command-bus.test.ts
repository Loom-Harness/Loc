// Gate for D-COMMAND-BUS (docs/decisions).
// .NET's bus is the Mediator source generator (`mediator.Send(request)`, typed
// per request at compile time).  Mediator itself reports a request with no
// handler only when it is sent, so each dispatched request record carries a
// compile-time binding to its handler class: it names the handler as a type
// argument constrained to the handler interface of that record, and does not
// compile when the class is missing or handles something else.  These
// assertions are for wiring no booted tier observes and for absence (a handler
// no record is dispatched through carries none); the build proof is the dotnet
// corpus leg over `send-routes`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SOURCE = `system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        code: string
        carrier: string = ""
        operation ship(c: string) { carrier := c }
      }
      repository Orders for Order { }
      command ShipOrder { id: Order id  carrier: string }
      commandHandler ShipOrderHandler(cmd: ShipOrder) {
        let o = Orders.get(cmd.id)
        o.ship(cmd.carrier)
      }
      query GetOrderCarrier { id: Order id  prefix: string }
      queryHandler GetOrderCarrierHandler(q: GetOrderCarrier): string {
        let o = Orders.get(q.id)
        return q.prefix + o.carrier
      }
      commandHandler LegacyShip(orderId: Order id) {
        let o = Orders.get(orderId)
        o.ship("x")
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d {
    platform: dotnet
    contexts: [Ordering]
    dataSources: [st]
    port: 4000
  }
}`;

async function file(name: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const hit = [...files.entries()].find(([p]) => p.endsWith(`/${name}`));
  expect(hit, `no ${name} emitted`).toBeDefined();
  return hit![1];
}

describe("dotnet command bus", () => {
  it("binds a command record to its handler class at compile time", async () => {
    const src = await file("ShipOrderHandlerCommand.cs");
    expect(src).toContain("file static class ShipOrderHandlerCommandBinding");
    expect(src).toContain("where THandler : ICommandHandler<ShipOrderHandlerCommand, Unit> { }");
    expect(src).toContain("Handler<ShipOrderHandlerHandler>();");
  });

  it("binds a query record to its handler class with the result type", async () => {
    const src = await file("GetOrderCarrierHandlerQuery.cs");
    expect(src).toContain(
      "where THandler : IQueryHandler<GetOrderCarrierHandlerQuery, string> { }",
    );
    expect(src).toContain("Handler<GetOrderCarrierHandlerHandler>();");
  });

  it("adds no binding to a handler no record is dispatched through", async () => {
    expect(await file("LegacyShipCommand.cs")).not.toContain("Binding");
  });
});
