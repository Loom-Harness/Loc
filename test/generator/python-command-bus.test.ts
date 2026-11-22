// Gate for D-COMMAND-BUS (docs/decisions).
// Python's typed command bus: `app/application/<context>_bus.py` overloads
// `send` per record (each answering that record's result type), matches the
// record's class, and ends in `assert_never`, so `mypy --strict` rejects a
// record with no case.  These assertions are for wiring no booted tier
// observes (the bus has no caller yet) and for absence (no name lookup); the
// `mypy` proof is the python corpus leg over `send-routes`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (handlers: string): string => `system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        code: string
        carrier: string = ""
        operation ship(c: string) { carrier := c }
      }
      repository Orders for Order { }
${handlers}
    }
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d {
    platform: python
    contexts: [Ordering]
    dataSources: [st]
    port: 4000
  }
}`;

const TWO = system(`      command ShipOrder { id: Order id  carrier: string }
      commandHandler ShipOrderHandler(cmd: ShipOrder) {
        let o = Orders.get(cmd.id)
        o.ship(cmd.carrier)
      }
      query GetOrderCarrier { id: Order id  prefix: string }
      queryHandler GetOrderCarrierHandler(q: GetOrderCarrier): string {
        let o = Orders.get(q.id)
        return q.prefix + o.carrier
      }`);

const ONE = system(`      command ShipOrder { id: Order id  carrier: string }
      commandHandler ShipOrderHandler(cmd: ShipOrder) {
        let o = Orders.get(cmd.id)
        o.ship(cmd.carrier)
      }`);

async function bus(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const hit = [...files.entries()].find(([p]) => /app\/application\/ordering_bus\.py$/.test(p));
  expect(hit, "no ordering_bus.py emitted").toBeDefined();
  return hit![1];
}

describe("python command bus", () => {
  it("overloads send per record and matches each record's class", async () => {
    const src = await bus(TWO);
    expect(src).toContain("BusRequest = ShipOrder | GetOrderCarrier");
    expect(src).toContain("async def send(session: AsyncSession, request: ShipOrder) -> None: ...");
    expect(src).toContain(
      "async def send(session: AsyncSession, request: GetOrderCarrier) -> str: ...",
    );
    expect(src).toContain("case ShipOrder():");
    expect(src).toContain("return await dispatch_get_order_carrier(session, request)");
    expect(src).toContain("assert_never(request)");
  });

  it("is a plain function for a one-record bus (a single overload is a mypy error)", async () => {
    const src = await bus(ONE);
    expect(src).not.toContain("@overload");
    expect(src).toContain("async def send(session: AsyncSession, request: BusRequest) -> None:");
    expect(src).toContain("assert_never(request)");
  });

  it("looks nothing up by name", async () => {
    const src = await bus(TWO);
    expect(src).not.toMatch(/getattr\(|globals\(\)|dict\[str,/);
  });
});
