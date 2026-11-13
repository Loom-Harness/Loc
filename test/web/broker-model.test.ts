import { describe, expect, it } from "vitest";
import { BrokerModel } from "../../src/emulation/broker-model.js";
import type { BrokerDelivery, BrokerKind } from "../../src/emulation/broker-protocol.js";

// The playground's emulated broker (one state in the infra worker, shared by
// every deployable).  These pin the per-broker semantics the generated
// drivers rely on — the in-process stand-in it replaces got broadcast right
// and the rest wrong.  The browser-level proof (two booted deployables on
// one channel) is web/e2e/channels-broker.spec.ts.

interface Received {
  client: string;
  delivery: BrokerDelivery;
}

function harness() {
  const received: Received[] = [];
  const model = new BrokerModel({
    send: (client, delivery) => received.push({ client, delivery }),
    schedule: (fn) => fn(),
  });
  let n = 0;
  const publish = (transport: BrokerKind, address: string, key: string | null = null): string => {
    const id = `e${++n}`;
    model.publish("producer", {
      transport,
      address,
      body: JSON.stringify({ id, type: "Ctx.Happened", data: {} }),
      key: key ?? id,
    });
    return id;
  };
  const idOf = (r: Received): string => (JSON.parse(r.delivery.body) as { id: string }).id;
  /** Ack everything delivered so far (and whatever that releases). */
  const ackAll = (): void => {
    let i = 0;
    while (i < received.length) model.ack((received[i++] as Received).delivery.deliveryId);
  };
  return { model, received, publish, idOf, ackAll };
}

describe("broker model — redis (broadcast, ephemeral)", () => {
  it("delivers every message to every subscriber, keeps nothing", () => {
    const { model, received, publish } = harness();
    publish("redis", "loom.A.Ch"); // nobody subscribed: gone
    model.subscribe("admin", {
      transport: "redis",
      address: "loom.A.Ch",
      group: "loom.A.Ch.admin",
      fromBeginning: false,
    });
    model.subscribe("shop", {
      transport: "redis",
      address: "loom.A.Ch",
      group: "loom.A.Ch.shop",
      fromBeginning: false,
    });
    publish("redis", "loom.A.Ch");
    expect(received.map((r) => r.client).sort()).toEqual(["admin", "shop"]);
  });

  it("a failed handler drops the message", () => {
    const { model, received, publish } = harness();
    model.subscribe("admin", {
      transport: "redis",
      address: "a",
      group: null,
      fromBeginning: false,
    });
    publish("redis", "a");
    expect(model.nack((received[0] as Received).delivery.deliveryId, "boom").outcome).toBe(
      "dropped",
    );
    expect(received).toHaveLength(1);
  });
});

describe("broker model — rabbitmq (queue, DLQ)", () => {
  it("one consumer of a group gets each message; distinct groups each get it", () => {
    const { model, received, publish, ackAll } = harness();
    const sub = (client: string, group: string) =>
      model.subscribe(client, {
        transport: "rabbitmq",
        address: "loom.A.Q",
        group,
        fromBeginning: false,
      });
    sub("admin#1", "loom.A.Q.admin");
    sub("admin#2", "loom.A.Q.admin");
    sub("shop", "loom.A.Q.shop");
    publish("rabbitmq", "loom.A.Q");
    publish("rabbitmq", "loom.A.Q");
    ackAll();
    const admin = received.filter((r) => r.client.startsWith("admin"));
    const shop = received.filter((r) => r.client === "shop");
    expect(admin).toHaveLength(2);
    expect(new Set(admin.map((r) => r.client)).size).toBe(2); // round-robin
    expect(shop).toHaveLength(2);
  });

  it("holds one unacked message per consumer (prefetch 1)", () => {
    const { model, received, publish } = harness();
    model.subscribe("admin", {
      transport: "rabbitmq",
      address: "q",
      group: "g",
      fromBeginning: false,
    });
    publish("rabbitmq", "q");
    publish("rabbitmq", "q");
    expect(received).toHaveLength(1);
    model.ack((received[0] as Received).delivery.deliveryId);
    expect(received).toHaveLength(2);
  });

  it("a queue keeps messages while its consumer is gone", () => {
    const { model, received, publish, idOf } = harness();
    const first = model.subscribe("shop", {
      transport: "rabbitmq",
      address: "q",
      group: "g",
      fromBeginning: false,
    });
    model.unsubscribe(first);
    const id = publish("rabbitmq", "q");
    model.subscribe("shop", {
      transport: "rabbitmq",
      address: "q",
      group: "g",
      fromBeginning: false,
    });
    expect(received.map(idOf)).toEqual([id]);
  });

  it("an unacked message returns to the queue when its consumer leaves", () => {
    const { model, received, publish } = harness();
    const a = model.subscribe("a", {
      transport: "rabbitmq",
      address: "q",
      group: "g",
      fromBeginning: false,
    });
    publish("rabbitmq", "q");
    model.unsubscribe(a);
    model.subscribe("b", { transport: "rabbitmq", address: "q", group: "g", fromBeginning: false });
    expect(received.map((r) => [r.client, r.delivery.redelivered])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("a nack is retried until the 5th attempt, then lands in loom.dlq.<address>", () => {
    const { model, received, publish } = harness();
    model.subscribe("shop", {
      transport: "rabbitmq",
      address: "loom.A.Q",
      group: "loom.A.Q.shop",
      fromBeginning: false,
    });
    publish("rabbitmq", "loom.A.Q");
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = (received[i] as Received).delivery;
      expect(d.attempts).toBe(i + 1);
      outcomes.push(model.nack(d.deliveryId, "reactor failed").outcome);
    }
    expect(outcomes).toEqual(["retried", "retried", "retried", "retried", "dead-lettered"]);
    expect(received).toHaveLength(5);
    const dlq = model.inspect().rabbitmq.queues.find((q) => q.name === "loom.dlq.loom.A.Q");
    expect(dlq?.ready).toBe(1);
    expect(model.inspect().rabbitmq.queues.find((q) => q.name === "loom.A.Q.shop")?.ready).toBe(0);
  });

  it("a malformed body is parked at once", () => {
    const { model, received } = harness();
    model.subscribe("shop", {
      transport: "rabbitmq",
      address: "q",
      group: "g",
      fromBeginning: false,
    });
    model.publish(null, { transport: "rabbitmq", address: "q", body: "{not json", key: null });
    const res = model.nack(
      (received[0] as Received).delivery.deliveryId,
      "malformed envelope",
      true,
    );
    expect(res).toMatchObject({ outcome: "dead-lettered", parkedAt: "loom.dlq.q" });
  });
});

describe("broker model — kafka (log, groups, replay)", () => {
  const sub = (model: BrokerModel, client: string, group: string, fromBeginning: boolean) =>
    model.subscribe(client, { transport: "kafka", address: "loom.A.Log", group, fromBeginning });

  it("each group reads the whole log; members of one group split it", () => {
    const { model, received, publish, ackAll, idOf } = harness();
    sub(model, "admin#1", "loom.A.Log.admin", false);
    sub(model, "admin#2", "loom.A.Log.admin", false);
    sub(model, "shop", "loom.A.Log.shop", false);
    const ids = Array.from({ length: 12 }, () => publish("kafka", "loom.A.Log"));
    ackAll();
    const admin = received.filter((r) => r.client.startsWith("admin"));
    expect(admin.map(idOf).sort()).toEqual([...ids].sort()); // exactly once in the group
    expect(new Set(admin.map((r) => r.client)).size).toBe(2); // the partitions are split
    expect(
      received
        .filter((r) => r.client === "shop")
        .map(idOf)
        .sort(),
    ).toEqual([...ids].sort());
  });

  it("a NEW group with fromBeginning replays from the earliest offset; without it starts at the end", () => {
    const { model, received, publish, ackAll, idOf } = harness();
    const before = [publish("kafka", "loom.A.Log"), publish("kafka", "loom.A.Log")];
    sub(model, "late", "loom.A.Log.late", true);
    sub(model, "tail", "loom.A.Log.tail", false);
    const after = publish("kafka", "loom.A.Log");
    ackAll();
    expect(
      received
        .filter((r) => r.client === "late")
        .map(idOf)
        .sort(),
    ).toEqual([...before, after].sort());
    expect(received.filter((r) => r.client === "tail").map(idOf)).toEqual([after]);
  });

  it("a group that committed resumes where it stopped", () => {
    const { model, received, publish, ackAll, idOf } = harness();
    const s = sub(model, "shop", "g", true);
    publish("kafka", "loom.A.Log");
    ackAll();
    model.unsubscribe(s);
    const missed = publish("kafka", "loom.A.Log");
    received.length = 0;
    sub(model, "shop", "g", true);
    ackAll();
    expect(received.map(idOf)).toEqual([missed]);
  });

  it("keeps per-key order: a partition delivers one record at a time", () => {
    const { model, received, publish, idOf } = harness();
    sub(model, "shop", "g", false);
    const a = publish("kafka", "loom.A.Log", "order-1");
    const b = publish("kafka", "loom.A.Log", "order-1");
    expect(received.map(idOf)).toEqual([a]);
    model.ack((received[0] as Received).delivery.deliveryId);
    expect(received.map(idOf)).toEqual([a, b]);
  });

  it("a nack parks the record on <address>.dlq and advances", () => {
    const { model, received, publish, idOf } = harness();
    sub(model, "shop", "g", false);
    const a = publish("kafka", "loom.A.Log", "k");
    const b = publish("kafka", "loom.A.Log", "k");
    expect(model.nack((received[0] as Received).delivery.deliveryId, "boom")).toMatchObject({
      outcome: "dead-lettered",
      parkedAt: "loom.A.Log.dlq",
    });
    expect(received.map(idOf)).toEqual([a, b]);
    const dlq = model.inspect().kafka.topics.find((t) => t.name === "loom.A.Log.dlq");
    expect(dlq?.partitions.reduce((n, p) => n + p.end - p.start, 0)).toBe(1);
  });
});

describe("broker model — lifecycle", () => {
  it("disconnect drops a client's subscriptions; reset drops everything", () => {
    const { model, received, publish } = harness();
    model.subscribe("admin", {
      transport: "redis",
      address: "a",
      group: null,
      fromBeginning: false,
    });
    model.disconnect("admin");
    publish("redis", "a");
    expect(received).toHaveLength(0);
    publish("kafka", "t");
    model.reset();
    const state = model.inspect();
    expect(state.kafka.topics).toEqual([]);
    expect(state.journal).toEqual([]);
    expect(state.emulated.length).toBeGreaterThan(0);
  });
});
