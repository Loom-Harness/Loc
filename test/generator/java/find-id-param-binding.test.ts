// B15 (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/behavioral-parity-bugs-2026-07.md): a read route with an
// ID-typed query param (`scaffoldGet` over `criterion ShipmentsByOrder(order:
// Order id)`) must bind the RAW underlying type on the controller
// (`@RequestParam UUID order`) and wrap it into the id class at the handler
// call (`new OrderId(order)`) — Spring has no `String → OrderId` value-type
// converter, so binding `@RequestParam OrderId` throws at request time (500).
// Mirrors the getById path variable.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Fulfil {
  subdomain F {
    context F with scaffoldGet(of: ShipmentsByOrder) {
      aggregate Order with crudish { code: string }
      repository Orders for Order
      aggregate Shipment with crudish {
        orderRef: Order id
        status: string
      }
      repository Shipments for Shipment
      criterion ShipmentsByOrder(order: Order id) of Shipment = this.orderRef == order
    }
  }
  api FApi with scaffoldGetApi(of: ShipmentsByOrder) from F
  storage pg { type: postgres }
  resource st { for: F, kind: state, use: pg }
  deployable d { platform: java, contexts: [F], dataSources: [st], serves: FApi, port: 4000 }
}
`;

describe("java read route — id-typed query param binds the raw type + wraps (B15)", () => {
  it("controller binds @RequestParam UUID and wraps into the id class", async () => {
    const files = await generateSystemFiles(SRC);
    const key = [...files.keys()].find((k) => /FApiRoutesController\.java$/.test(k));
    expect(key, "routes controller").toBeDefined();
    const ctrl = files.get(key!)!;
    // Raw UUID param — NOT the OrderId wrapper (which has no String converter).
    expect(ctrl).toContain("getShipmentByShipmentsByOrder(@RequestParam UUID order)");
    expect(ctrl).not.toContain("@RequestParam OrderId order");
    // Wrapped into the id class at the handler call.
    expect(ctrl).toContain("getShipmentByShipmentsByOrderHandler.handle(new OrderId(order))");
    // The raw type's import rides in.
    expect(ctrl).toContain("import java.util.UUID;");
  });
});
