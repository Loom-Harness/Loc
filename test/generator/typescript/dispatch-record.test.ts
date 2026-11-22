// Node's `dispatch<Record>`: a handler taking one request record runs through
// one exported module function, and its route only binds the record and
// answers the result.  The route's behaviour is the `send-routes` corpus
// fixture's (its golden runs on all five backends); this pins the wiring no
// booted tier observes yet — the exported function a later caller (the
// command bus, a workflow `send`) reaches, and the route calling it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SOURCE = `system SendRoutes {
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
  api SalesApi from Sales {
    route POST "/orders/{id}/dispatch" send Ordering.ShipOrder
    route POST "/orders/{id}/dispatch-again" send Ordering.ShipOrder
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

describe("node dispatch<Record> (wiring)", () => {
  it("exports one dispatch function per record, which the routes call", async () => {
    const files = await generateSystemFiles(SOURCE);
    const routes = [...files.entries()].find(([p]) => /http\/salesApi-routes\.ts$/.test(p));
    expect(routes, "no salesApi-routes.ts emitted").toBeDefined();
    const src = routes![1];

    const ship = src.match(/^export async function dispatchShipOrder\(/gm) ?? [];
    expect(ship, "two routes sending ShipOrder share ONE dispatch function").toHaveLength(1);
    expect(src).toMatch(/^export async function dispatchGetOrderCarrier\(/m);

    expect(src).toContain("await dispatchShipOrder(db, events, cmd);");
    expect(src).toContain("const __result = await dispatchGetOrderCarrier(db, events, q);");

    // The function owns the body; the HTTP edge stays in the route.
    const fn = src.slice(src.indexOf("export async function dispatchShipOrder("));
    const fnBody = fn.slice(0, fn.indexOf("\n}\n"));
    expect(fnBody).toContain("db.transaction(");
    expect(fnBody, "the dispatch function must not answer HTTP").not.toContain("httpCtx");
  });
});
