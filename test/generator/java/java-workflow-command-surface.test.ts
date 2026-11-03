// Java workflow command-surface rule (channels.md): only command-surfaced
// workflows get a `@Service` method + `POST /workflows/<name>` route. An
// event-triggered (saga) workflow is invoked by the in-process dispatcher, not
// an inbound call, so emitting a Request record / route with an event-typed
// param is bogus — Java now honours the shared `workflowEmitsCommandRoute`
// facade rule every other backend already does.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const EVENT_TRIGGERED = `
system S { subdomain O { context O {
  aggregate Order { status: string  operation place() { status := "P"  emit OrderPlaced { order: id } } }
  repository Orders for Order { }
  aggregate Shipment { orderRef: Order id  status: string  operation mark() { status := "T" } }
  repository Shipments for Shipment { }
  event OrderPlaced { order: Order id }
  event ShipmentRequested { shipment: Shipment id, order: Order id }
  channel L { carries: OrderPlaced, ShipmentRequested  delivery: broadcast  retention: ephemeral }
  workflow OrderFulfillment { orderId: Order id  attempts: int
    create(p: OrderPlaced) by p.order { let s = Shipment.create(orderRef: p.order, status: "P") emit ShipmentRequested { shipment: s.id, order: p.order } }
    on(s: ShipmentRequested) by s.order { let sh = Shipments.get(s.shipment) sh.mark() } }
} } api A from O  storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: java  contexts: [O]  serves: A  dataSources: [oState]  port: 8080 } }
`;

const COMMAND = `
system S { subdomain O { context O {
  aggregate Customer { name: string  operation rename(n: string) { name := n } }
  repository Customers for Customer { }
  workflow renameCustomer { create(customerId: Customer id, newName: string) { let c = Customers.get(customerId) c.rename(newName) } }
} } api A from O  storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: java  contexts: [O]  serves: A  dataSources: [oState]  port: 8080 } }
`;

async function gen(src: string): Promise<string[]> {
  return [...(await generateSystemFiles(src)).keys()];
}

describe("java workflow command-surface rule", () => {
  it("emits no workflow service/controller/request for an event-triggered-only saga", async () => {
    const keys = await gen(EVENT_TRIGGERED);
    // The saga is invoked by the dispatcher, not POST — no bogus command surface.
    expect(
      keys.filter((k) => /workflows?\/.*Workflows?\.java|WorkflowsController\.java/i.test(k)),
    ).toEqual([]);
    expect(keys.some((k) => k.endsWith("OrderFulfillmentRequest.java"))).toBe(false);
    // The saga-state table is still derived by the (platform-neutral) migration.
    const sql =
      [...(await generateSystemFiles(EVENT_TRIGGERED)).entries()].find(([k]) =>
        k.endsWith(".sql"),
      )?.[1] ?? "";
    expect(sql).toContain("order_fulfillments");
  });

  it("still emits the service + controller for a command-triggered workflow", async () => {
    const keys = await gen(COMMAND);
    expect(keys.some((k) => k.endsWith("OWorkflows.java"))).toBe(true);
    expect(keys.some((k) => k.endsWith("OWorkflowsController.java"))).toBe(true);
    expect(keys.some((k) => k.endsWith("RenameCustomerRequest.java"))).toBe(true);
  });

  it("runs the command-workflow method in a per-dispatch child frame", async () => {
    const files = await generateSystemFiles(COMMAND);
    const svc = [...files.entries()].find(([k]) => k.endsWith("OWorkflows.java"))![1];
    // The workflow body runs in a child execution frame (parent_id <- the
    // request's root scope) so its audit/provenance rows are distinguishable
    // from a direct operation's.
    expect(svc).toContain(".config.RequestContext;");
    expect(svc).toMatch(
      /public void renameCustomer\(RenameCustomerRequest request\) \{\n\s*try \(var _ = RequestContext\.openChild\(\)\) \{/,
    );
  });
});
