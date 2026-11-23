// Gate for D-COMMAND-BUS (docs/decisions).
// Java's typed command bus: every request record of a context implements a
// sealed `<Ctx>Request`, and `<Ctx>Bus.send(<Ctx>Request)` is a pattern
// `switch` over it, so a record with no case does not compile; one overload per
// record answers that record's own result type.  These assertions are for
// wiring no booted tier observes (the bus has no caller yet) and for absence
// (no bean lookup); the `javac` proof is the java corpus leg over `send-routes`.

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
    }
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d {
    platform: java
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

describe("java command bus", () => {
  it("seals the request interface over every record, which implements it", async () => {
    expect(await file("OrderingRequest.java")).toContain(
      "public sealed interface OrderingRequest permits ShipOrder, GetOrderCarrier {}",
    );
    expect(await file("ShipOrder.java")).toContain("implements OrderingRequest {}");
    expect(await file("GetOrderCarrier.java")).toContain("implements OrderingRequest {}");
  });

  it("switches exhaustively over the sealed interface and overloads send per record", async () => {
    const bus = await file("OrderingBus.java");
    expect(bus).toContain("public void send(ShipOrder request) {");
    expect(bus).toContain("public String send(GetOrderCarrier request) {");
    expect(bus).toContain("return switch (request) {");
    expect(bus).toContain("case ShipOrder r -> { dispatch.shipOrder(r); yield null; }");
    expect(bus).toContain("case GetOrderCarrier r -> dispatch.getOrderCarrier(r);");
    expect(bus, "no default arm: the sealed switch is the exhaustiveness check").not.toContain(
      "default",
    );
  });

  it("looks no bean up by name", async () => {
    const bus = await file("OrderingBus.java");
    expect(bus).not.toMatch(/ApplicationContext|getBean|Map<String/);
  });
});
