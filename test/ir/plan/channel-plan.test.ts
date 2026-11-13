// The channel plan's answers for a producer and a consumer deployable that
// share one durable rabbitmq channel, plus an unbound durable channel and an
// unbound ephemeral one on the producer.

import { describe, expect, it } from "vitest";
import { channelPlan, deliversLocally, eventRoute } from "../../../src/ir/plan/index.js";
import type { EnrichedSystemIR } from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SOURCE = `
system Acme {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        status: string
        operation place() {
          precondition status == "Draft"
          status := "Placed"
          emit OrderPlaced { order: id }
          emit OrderAudited { order: id }
          emit OrderNoted { order: id }
        }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id }
      event OrderAudited { order: Order id }
      event OrderNoted { order: Order id }
      channel Lifecycle {
        carries: OrderPlaced
        delivery: queue
        retention: work
      }
      channel Audit {
        carries: OrderAudited
        delivery: queue
        retention: work
      }
      channel Notices {
        carries: OrderNoted
        delivery: broadcast
        retention: ephemeral
      }
    }
  }
  subdomain Fulfilment {
    context Shipping {
      aggregate Shipment with crudish {
        orderRef: Order id
        status: string
      }
      repository Shipments for Shipment {}
      workflow Fulfil {
        orderId: Order id
        create(p: OrderPlaced) by p.order {
          let s = Shipment.create(orderRef: p.order, status: "Pending")
        }
      }
    }
  }
  storage primary { type: postgres }
  storage bus { type: rabbitmq }
  resource ordersState { for: Orders, kind: state, use: primary }
  resource shippingState { for: Shipping, kind: state, use: primary }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable salesApi { platform: node contexts: [Orders] dataSources: [ordersState] channels: [lifecycleBus] port: 3000 }
  deployable shipApi  { platform: node contexts: [Shipping] dataSources: [shippingState] channels: [lifecycleBus] port: 3001 }
}
`;

async function plans() {
  const loom = await buildLoomModel(SOURCE);
  const sys = loom.systems[0] as EnrichedSystemIR;
  const contexts = sys.subdomains.flatMap((d) => d.contexts);
  const planFor = (name: string) => {
    const deployable = sys.deployables.find((d) => d.name === name);
    if (!deployable) throw new Error(`no deployable ${name}`);
    return channelPlan(
      contexts.filter((c) => deployable.contextNames.includes(c.name)),
      { deployable, sys },
    );
  };
  return { producer: planFor("salesApi"), consumer: planFor("shipApi") };
}

describe("channelPlan", () => {
  it("routes each raised event by its channel's retention and binding", async () => {
    const { producer } = await plans();
    expect(eventRoute(producer, "OrderPlaced")).toBe("broker-outbox");
    expect(eventRoute(producer, "OrderAudited")).toBe("outbox-local");
    expect(eventRoute(producer, "OrderNoted")).toBe("inline-local");
    expect([...producer.hostedDurable].sort()).toEqual(["OrderAudited", "OrderPlaced"]);
    expect([...producer.durableBrokerEvents]).toEqual(["OrderPlaced"]);
    expect(producer.hasOutbox).toBe(true);
  });

  it("a deployable with durable events and no subscriber is the producer-only shape", async () => {
    const { producer } = await plans();
    expect(producer.subscriptions).toEqual([]);
    expect(producer.producerOnly).toBe(true);
    expect(producer.consumesFromBroker).toBe(false);
    expect(producer.foreignChannels).toEqual([]);
  });

  it("a consumer of a foreign durable channel dedupes it but owns no outbox", async () => {
    const { consumer } = await plans();
    expect(consumer.foreignChannels.map((c) => [c.name, c.delivery, c.retention])).toEqual([
      ["Lifecycle", "queue", "work"],
    ]);
    expect([...consumer.foreignDurable]).toEqual(["OrderPlaced"]);
    expect(consumer.hostedDurable.size).toBe(0);
    expect(consumer.hasOutbox).toBe(false);
    expect(consumer.consumesFromBroker).toBe(true);
    expect([...consumer.brokerConsumedEvents]).toEqual(["OrderPlaced"]);
    expect([...consumer.dedupedEvents]).toEqual(["OrderPlaced"]);
    expect(consumer.subscriptions.map((s) => [s.event, s.channel, s.workflow])).toEqual([
      ["OrderPlaced", "Lifecycle", "Fulfil"],
    ]);
  });

  it("a broker-carried event leaves the in-process dispatcher", async () => {
    const { producer, consumer } = await plans();
    expect(deliversLocally(consumer, "OrderPlaced")).toBe(false);
    expect(deliversLocally(producer, "OrderAudited")).toBe(true);
  });

  it("one binding per channelSource", async () => {
    const { producer } = await plans();
    expect(producer.uniqueBindings.map((b) => b.csName)).toEqual(["lifecycleBus"]);
  });

  it("without a system nothing is wired and every route is local", async () => {
    const loom = await buildLoomModel(SOURCE);
    const all = loom.systems[0].subdomains.flatMap((d) => d.contexts);
    const plan = channelPlan(all);
    expect(plan.bindings).toEqual([]);
    expect(plan.hasOutbox).toBe(true);
    expect(eventRoute(plan, "OrderPlaced")).toBe("outbox-local");
    expect(eventRoute(plan, "OrderNoted")).toBe("inline-local");
  });

  it("a durable event nobody consumes and no broker carries needs no outbox", async () => {
    const loom = await buildLoomModel(SOURCE);
    const orders = loom.systems[0].subdomains[0].contexts;
    const plan = channelPlan(orders);
    expect(plan.hostedDurable.size).toBe(2);
    expect(plan.hasOutbox).toBe(false);
    expect(plan.outboxEvents.size).toBe(0);
    expect(eventRoute(plan, "OrderPlaced")).toBe("inline-local");
  });

  it("a projection fold over a broker-carried event makes the deployable a broker consumer", async () => {
    const loom = await buildLoomModel(corpusSourceFor("channels-broker-projection", "node"));
    const sys = loom.systems[0] as EnrichedSystemIR;
    const deployable = sys.deployables.find((d) => d.name === "shipApi");
    if (!deployable) throw new Error("no shipApi");
    const contexts = sys.subdomains
      .flatMap((d) => d.contexts)
      .filter((c) => deployable.contextNames.includes(c.name));
    const plan = channelPlan(contexts, { deployable, sys });
    expect(plan.subscriptions.every((s) => s.projection)).toBe(true);
    expect(plan.consumesFromBroker).toBe(true);
    expect([...plan.brokerConsumedEvents]).toEqual(["OrderPlaced"]);
  });
});
