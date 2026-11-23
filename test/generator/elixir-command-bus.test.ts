// Gate for D-COMMAND-BUS (docs/decisions).
// Elixir's typed command bus: `<Ctx>.Bus.dispatch/2` takes a request tagged by
// its record and has one clause per bus entry, each calling that record's
// `Dispatch` function directly, so a record whose dispatch function is missing
// fails `mix compile --warnings-as-errors`.  These assertions are for wiring no
// booted tier observes (the bus has no caller yet) and for absence (no name
// lookup); the compile proof is the elixir corpus leg over `send-routes`.

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
    platform: elixir
    contexts: [Ordering]
    dataSources: [st]
    port: 4000
  }
}`;

async function bus(): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const hit = [...files.entries()].find(([p]) => /ordering\/bus\.ex$/.test(p));
  expect(hit, "no ordering/bus.ex emitted").toBeDefined();
  return hit![1];
}

describe("elixir command bus", () => {
  it("has a clause per record, each calling that record's dispatch function", async () => {
    const src = await bus();
    expect(src).toContain("@type request :: {:ship_order, map()} | {:get_order_carrier, map()}");
    expect(src).toContain("def dispatch({:ship_order, record}, current_user),");
    expect(src).toContain("do: D.Ordering.Dispatch.ship_order(record, current_user)");
    expect(src).toContain("do: D.Ordering.Dispatch.get_order_carrier(record, current_user)");
  });

  it("looks nothing up by name", async () => {
    const src = await bus();
    expect(src).not.toMatch(/apply\(|String\.to_atom|Module\.concat|function_exported\?/);
  });
});
