// Gate for D-COMMAND-BUS (docs/decisions).
// A command or query record has one handler: a handler whose only parameter is
// that record, or a workflow create that takes the command record.

import { describe, expect, it } from "vitest";
import { busEntries, handlerFor, handlersOf } from "../../../src/ir/plan/index.js";
import type { BoundedContextIR } from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";

const base = (extra: string): string => `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        carrier: string?
        operation ship(c: string) { carrier := c }
      }
      repository Orders for Order { }
      command ShipOrder { orderId: Order id  carrier: string }
      query GetOrder { orderId: Order id }
      command StartFulfilment { orderId: Order id }
      command Orphan { orderId: Order id }
      commandHandler ShipOrderHandler(cmd: ShipOrder) {
        let o = Orders.get(cmd.orderId)
        o.ship(cmd.carrier)
      }
      queryHandler GetOrderHandler(q: GetOrder): Order {
        let o = Orders.get(q.orderId)
        return o
      }
      workflow Fulfilment {
        create(cmd: StartFulfilment) {
          let o = Orders.get(cmd.orderId)
          o.ship("dhl")
        }
      }
      ${extra}
    }
  }
}
`;

async function ordering(extra = ""): Promise<BoundedContextIR> {
  const loom = await buildLoomModel(base(extra));
  const ctx = enrichedContexts(loom).find((c) => c.name === "Ordering");
  if (!ctx) throw new Error("Ordering not found");
  return ctx;
}

describe("handlerFor", () => {
  it("binds a command record to its commandHandler", async () => {
    const ctx = await ordering();
    // `ShipOrderHandler` declares no result, so the binding carries no type.
    expect(handlerFor(ctx, "ShipOrder")).toEqual({
      kind: "command",
      context: "Ordering",
      record: "ShipOrder",
      handler: { form: "commandHandler", name: "ShipOrderHandler" },
    });
  });

  it("binds a query record to its queryHandler", async () => {
    const ctx = await ordering();
    expect(handlerFor(ctx, "GetOrder")?.handler).toEqual({
      form: "queryHandler",
      name: "GetOrderHandler",
    });
    expect(handlerFor(ctx, "GetOrder")?.kind).toBe("query");
    expect(handlerFor(ctx, "GetOrder")?.returnType).toMatchObject({
      kind: "entity",
      name: "Order",
    });
  });

  it("binds a command record to the workflow create that takes it", async () => {
    const ctx = await ordering();
    expect(handlerFor(ctx, "StartFulfilment")?.handler).toEqual({
      form: "workflow-create",
      name: "create",
      workflow: "Fulfilment",
    });
    expect(handlerFor(ctx, "StartFulfilment")?.returnType).toBeUndefined();
  });

  it("answers nothing for a record without a handler", async () => {
    const ctx = await ordering();
    expect(handlersOf(ctx, "Orphan")).toEqual([]);
    expect(handlerFor(ctx, "Orphan")).toBeUndefined();
  });

  it("lists two candidates and answers nothing when two handlers catch a record", async () => {
    const ctx = await ordering(`
      commandHandler ShipOrderAgain(cmd: ShipOrder) {
        let o = Orders.get(cmd.orderId)
        o.ship(cmd.carrier)
      }`);
    expect(handlersOf(ctx, "ShipOrder").map((b) => b.handler.name)).toEqual([
      "ShipOrderHandler",
      "ShipOrderAgain",
    ]);
    expect(handlerFor(ctx, "ShipOrder")).toBeUndefined();
  });

  it("does not count a handler of the other kind as a candidate", async () => {
    const ctx = await ordering(`
      queryHandler WrongKind(q: ShipOrder): Order {
        let o = Orders.get(q.orderId)
        return o
      }`);
    expect(handlersOf(ctx, "ShipOrder").map((b) => b.handler.name)).toEqual(["ShipOrderHandler"]);
  });

  it("does not count a handler with a scalar parameter", async () => {
    const ctx = await ordering(`
      commandHandler Scalar(orderId: Order id) {
        let o = Orders.get(orderId)
        o.ship("x")
      }`);
    expect(handlersOf(ctx, "Orphan")).toEqual([]);
    expect(busEntries(ctx).map((b) => b.handler.name)).not.toContain("Scalar");
  });
});

describe("busEntries", () => {
  it("lists each record that has one handler, in declaration order", async () => {
    const ctx = await ordering();
    expect(busEntries(ctx).map((b) => `${b.kind}:${b.record}`)).toEqual([
      "command:ShipOrder",
      "query:GetOrder",
      "command:StartFulfilment",
    ]);
  });
});
