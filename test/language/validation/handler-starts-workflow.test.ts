import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// `loom.handler-starts-workflow`: nothing starts a workflow by naming it.  A
// command handler, a workflow `create` and a workflow `on` reaction all start
// one only by emitting an event its event-started `create` reacts to.  A name
// the caller binds itself (param, field, `let`, `if let`) shadows the workflow.

const wrap = (members: string) => `
  system Shop {
    subdomain Sales {
      context Ordering {
        aggregate Order { code: string }
        repository Orders for Order { }
        event OrderPlaced { orderId: Order id }
        workflow Fulfillment {
          orderId: Order id
          create(orderId: Order id) { let o = Orders.get(orderId) }
        }
        ${members}
      }
    }
    storage pg { type: postgres }
    resource st { for: Ordering, kind: state, use: pg }
    deployable api { platform: node, contexts: [Ordering], dataSources: [st], serves: none, port: 4000 }
  }
`;

const hits = async (src: string): Promise<string[]> =>
  (await parseString(src)).diagnostics
    .filter((d) => d.code === "loom.handler-starts-workflow")
    .map((d) => String(d.message));

describe("validator: loom.handler-starts-workflow", () => {
  it("refuses a command handler that starts a workflow (statement and let forms)", async () => {
    const found = await hits(
      wrap(`commandHandler Start(orderId: Order id) {
        Fulfillment.create(orderId)
        let w = Fulfillment.create(orderId: orderId)
      }`),
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("commandHandler 'Start' names workflow 'Fulfillment'");
    expect(found[0]).toContain("event-started create");
  });

  it("refuses a workflow create body that starts another workflow", async () => {
    const found = await hits(
      wrap(`workflow Kickoff {
        orderId: Order id
        create(orderId: Order id) { Fulfillment.create(orderId) }
      }`),
    );
    expect(found).toEqual([
      expect.stringContaining("workflow 'Kickoff' create names workflow 'Fulfillment'"),
    ]);
  });

  it("refuses a workflow on reaction that starts another workflow", async () => {
    const found = await hits(
      wrap(`workflow Kickoff {
        orderId: Order id
        create(orderId: Order id) { let o = Orders.get(orderId) }
        on(e: OrderPlaced) by e.orderId { Fulfillment.create(e.orderId) }
      }`),
    );
    expect(found).toEqual([
      expect.stringContaining("workflow 'Kickoff' on(OrderPlaced) names workflow 'Fulfillment'"),
    ]);
  });

  it("does not report a name the caller binds itself", async () => {
    const found = await hits(
      wrap(`queryHandler Mine(Fulfillment: Order id): Order {
        let o = Orders.get(Fulfillment)
        return o
      }`),
    );
    expect(found).toEqual([]);
  });
});
