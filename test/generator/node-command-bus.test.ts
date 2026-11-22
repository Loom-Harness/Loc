// Gate for D-COMMAND-BUS (docs/decisions).
// Node's typed command bus: every record the plan dispatches (`busEntries`)
// has a `dispatch<Record>` in its context's dispatch module, routed or not,
// and the bus maps each record to its dispatch through a tagged union, one
// overload per record and an exhaustive `switch` whose `never` check fails the
// generated project's `tsc` when a record has no case.  These assertions are
// for wiring no booted tier observes (the bus has no caller yet) and for
// absence (no string-keyed lookup); the `tsc` proof is the corpus-tsc leg over
// `send-routes`.

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
      command Unrouted { id: Order id }
      commandHandler UnroutedHandler(cmd: Unrouted) {
        let o = Orders.get(cmd.id)
        o.ship("x")
      }
      query GetOrderCarrier { id: Order id  prefix: string }
      queryHandler GetOrderCarrierHandler(q: GetOrderCarrier): string {
        let o = Orders.get(q.id)
        return q.prefix + o.carrier
      }
    }
  }
  api SalesApi from Sales {
    route POST "/orders/{id}/dispatch" send Ordering.ShipOrder
    route GET "/orders/{id}/carrier" send Ordering.GetOrderCarrier
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [Ordering]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}`;

async function file(re: RegExp): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const hit = [...files.entries()].find(([p]) => re.test(p));
  expect(hit, `no file matching ${re}`).toBeDefined();
  return hit![1];
}

describe("node command bus", () => {
  it("dispatches a record no route sends", async () => {
    const dispatch = await file(/http\/ordering-dispatch\.ts$/);
    expect(dispatch).toMatch(/^export async function dispatchUnrouted\(/m);
    expect(dispatch).toContain("export type Unrouted = { id: Ids.OrderId };");
    const routes = await file(/http\/salesApi-routes\.ts$/);
    expect(routes).not.toContain("dispatchUnrouted");
  });

  it("maps every record to its dispatch by an exhaustive tagged switch", async () => {
    const bus = await file(/http\/ordering-bus\.ts$/);
    for (const record of ["ShipOrder", "Unrouted", "GetOrderCarrier"]) {
      expect(bus).toContain(`{ type: "${record}"; record: ${record} }`);
      expect(bus).toContain(`case "${record}":`);
      expect(bus).toContain(
        `return (await dispatch${record}(db, events, bus.record)) as BusResults[R["type"]];`,
      );
      expect(bus).toContain(`${record}: Awaited<ReturnType<typeof dispatch${record}>>;`);
    }
    expect(bus).toContain('Promise<BusResults[R["type"]]>');
    expect(bus).toContain("const tag = bus.type;");
    expect(bus).toContain("const unreachable: never = tag;");
  });

  it("looks nothing up by name", async () => {
    const bus = await file(/http\/ordering-bus\.ts$/);
    expect(bus).not.toMatch(/new Map|Record<string|\[\s*request\.type\s*\]/);
  });
});
