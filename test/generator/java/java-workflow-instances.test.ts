// Read-only workflow-instance endpoints (workflow-instance-visibility.md) on
// Java — saga slice 3.  A correlation-bearing workflow gets a
// <Wf>InstanceResponse record and a <Ctx>WorkflowInstancesController exposing
// GET workflows/<snake>/instances + .../instances/{id} over the persisted
// <Wf>State saga row (read through its Spring Data repository) — the read-side
// analogue of an aggregate's GET list / GET-by-id, parity with .NET / python.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `system S { subdomain O { context O {
  aggregate Order { status: string  operation place() { status := "P"  emit OrderPlaced { order: id } } }
  repository Orders for Order { }
  aggregate Shipment { orderRef: Order id  status: string  operation mark() { status := "T" } }
  repository Shipments for Shipment { }
  event OrderPlaced { order: Order id }
  event ShipmentRequested { shipment: Shipment id, order: Order id }
  channel L { carries: OrderPlaced, ShipmentRequested  delivery: broadcast  retention: ephemeral }
  enum FulfillmentStatus { Pending, Shipped }
  workflow OrderFulfillment { orderId: Order id  attempts: int  status: FulfillmentStatus
    create(p: OrderPlaced) by p.order { let s = Shipment.create(orderRef: p.order, status: "P") emit ShipmentRequested { shipment: s.id, order: p.order } }
    on(s: ShipmentRequested) by s.order { let sh = Shipments.get(s.shipment) sh.mark() } }
} } api A from O storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: java contexts: [O] serves: A dataSources: [oState] port: 8080 } }`;

// A workflow with no correlation field — a pure command workflow, no saga row,
// so no instance surface.
const PLAIN = `system S { subdomain O { context O {
  aggregate Order { total: int  operation bump() { total := total + 1 } }
  repository Orders for Order { }
  workflow BumpAll { create(order: Order id) { let o = Orders.get(order) o.bump() } }
} } api A from O storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: java contexts: [O] serves: A dataSources: [oState] port: 8080 } }`;

async function gen(src: string): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

const find = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1];

describe("java workflow instance read endpoints", () => {
  it("publishes the instance routes' OpenAPI metadata", async () => {
    // Wiring this suite boots nothing for: the byId route declares its 404 /
    // 422 problem responses, and the instance record its required set (every
    // non-optional wire field), as Hono / .NET / Python / Phoenix publish.
    const files = await gen(SRC);
    const ctl = find(files, "WorkflowInstancesController.java");
    expect(ctl, "instance controller not emitted").toBeDefined();
    const byId = ctl!.slice(ctl!.indexOf('@GetMapping("/order_fulfillment/instances/{id}")'));
    const head = byId.slice(0, byId.indexOf(" public "));
    expect([...head.matchAll(/responseCode = "(\d{3})"/g)].map((m) => m[1])).toEqual([
      "200",
      "404",
      "422",
    ]);
    expect(find(files, "OrderFulfillmentInstanceResponse.java")).toContain(
      'requiredProperties = {"attempts", "orderId", "status"}',
    );
  });

  it("emits no instance surface for a workflow without a correlation field", async () => {
    const files = await gen(PLAIN);
    expect([...files.keys()].some((k) => k.endsWith("WorkflowInstancesController.java"))).toBe(
      false,
    );
    expect([...files.keys()].some((k) => k.endsWith("InstanceResponse.java"))).toBe(false);
  });
});
