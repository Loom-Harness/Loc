// The broker model's operator ops (seek, redrive), the message bodies
// `inspect()` exposes, and its config seams.  The delivery semantics
// themselves are pinned in test/web/broker-model.test.ts.
import { describe, expect, it } from "vitest";
import {
  BROKER_EMULATION_NOTES,
  type BrokerModelOptions,
  createBroker,
} from "../../src/emulation/broker-model.js";
import type { BrokerDelivery, BrokerKind } from "../../src/emulation/broker-protocol.js";

function harness(opts: Partial<BrokerModelOptions> = {}) {
  const received: { client: string; delivery: BrokerDelivery }[] = [];
  const model = createBroker({
    send: (client, delivery) => received.push({ client, delivery }),
    schedule: (fn) => fn(),
    ...opts,
  });
  let n = 0;
  const publish = (transport: BrokerKind, address: string, key: string | null = "k"): string => {
    const id = `e${++n}`;
    model.publish("producer", {
      transport,
      address,
      body: JSON.stringify({ specversion: "1.0", id, type: "Ctx.Happened", data: { n } }),
      key,
    });
    return id;
  };
  const idOf = (d: BrokerDelivery): string => (JSON.parse(d.body) as { id: string }).id;
  const last = () => received[received.length - 1]?.delivery as BrokerDelivery;
  return { model, received, publish, idOf, last };
}

const rabbitSub = {
  transport: "rabbitmq" as const,
  address: "loom.A.Ch",
  group: "loom.A.Ch.d",
  fromBeginning: false,
};
const kafkaSub = {
  transport: "kafka" as const,
  address: "loom.A.Ch",
  group: "loom.A.Ch.d",
  fromBeginning: true,
};

describe("broker model — redrive", () => {
  it("rabbitmq: a dead letter goes back to the address's queues with its attempts started over", () => {
    const { model, received, publish, idOf, last } = harness();
    model.subscribe("d", rabbitSub);
    const id = publish("rabbitmq", "loom.A.Ch");
    for (let i = 0; i < 5; i++) model.nack(last().deliveryId, "boom");
    const dlq = model.inspect().rabbitmq.queues.find((q) => q.name === "loom.dlq.loom.A.Ch");
    expect(dlq?.messages.map((m) => [m.id, m.attempts])).toEqual([[id, 5]]);
    expect(JSON.parse(dlq?.messages[0]?.body ?? "{}").data).toEqual({ n: 1 });

    const before = received.length;
    expect(model.redrive({ transport: "rabbitmq", deadLetter: "loom.dlq.loom.A.Ch" })).toEqual({
      moved: 1,
    });
    expect(received.length).toBe(before + 1);
    expect(idOf(last())).toBe(id);
    expect(last().attempts).toBe(1);
    expect(
      model.inspect().rabbitmq.queues.find((q) => q.name === "loom.dlq.loom.A.Ch")?.ready,
    ).toBe(0);
    expect(
      model
        .inspect()
        .journal.filter((j) => j.kind === "redriven")
        .map((j) => j.id),
    ).toEqual([id]);
  });

  it("kafka: a parked record is appended back onto its topic and the .dlq topic is emptied", () => {
    const { model, publish, idOf, last } = harness();
    model.subscribe("d", kafkaSub);
    const id = publish("kafka", "loom.A.Ch");
    model.nack(last().deliveryId, "boom");
    const dlqTopic = () => model.inspect().kafka.topics.find((t) => t.name === "loom.A.Ch.dlq");
    expect(dlqTopic()?.records.map((r) => r.id)).toEqual([id]);

    expect(model.redrive({ transport: "kafka", deadLetter: "loom.A.Ch.dlq" })).toEqual({
      moved: 1,
    });
    expect(idOf(last())).toBe(id);
    expect(dlqTopic()?.records).toEqual([]);
  });

  it("refuses a dead letter it does not know", () => {
    const { model } = harness();
    expect(() => model.redrive({ transport: "rabbitmq", deadLetter: "nope" })).toThrow(/nope/);
    expect(() => model.redrive({ transport: "kafka", deadLetter: "nope.dlq" })).toThrow(/nope/);
  });
});

describe("broker model — seek", () => {
  it("moves a group's offset back and redelivers from there, clamped to what is retained", () => {
    const { model, received, publish, idOf, last } = harness();
    model.subscribe("d", kafkaSub);
    const ids = [
      publish("kafka", "loom.A.Ch"),
      publish("kafka", "loom.A.Ch"),
      publish("kafka", "loom.A.Ch"),
    ];
    for (let i = 0; i < 3; i++) model.ack(last().deliveryId);
    expect(received.map((r) => idOf(r.delivery))).toEqual(ids);

    // Every record shares the key "k", so one partition holds them all.
    const partition = model.inspect().kafka.topics[0]?.records[0]?.partition as number;
    expect(
      model.seek({ topic: "loom.A.Ch", group: "loom.A.Ch.d", offset: -10, partition }),
    ).toEqual({
      partitions: [partition],
    });
    for (let i = 0; i < 3; i++) model.ack(last().deliveryId);
    expect(received.slice(3).map((r) => idOf(r.delivery))).toEqual(ids);
    expect(model.inspect().journal.some((j) => j.kind === "seeked")).toBe(true);
  });

  it("is refused while the moved partition has a delivery in flight", () => {
    const { model, publish } = harness();
    model.subscribe("d", kafkaSub);
    publish("kafka", "loom.A.Ch"); // delivered, not acked
    expect(() => model.seek({ topic: "loom.A.Ch", group: "loom.A.Ch.d", offset: 0 })).toThrow(
      /in flight/,
    );
  });

  it("refuses an unknown group", () => {
    const { model } = harness();
    expect(() => model.seek({ topic: "t", group: "g", offset: 0 })).toThrow(/no consumer group/);
  });
});

describe("broker model — inspect bodies and config seams", () => {
  it("returns only the newest `inspectTail` records per partition", () => {
    const { model, publish } = harness({ inspectTail: 2 });
    for (let i = 0; i < 5; i++) publish("kafka", "loom.A.Ch");
    const records = model.inspect().kafka.topics[0]?.records ?? [];
    expect(records.map((r) => r.offset)).toEqual([3, 4]);
    expect(records.every((r) => r.body.includes('"specversion"'))).toBe(true);
  });

  it("maxAttempts and the dead-letter names are configuration, not constants", () => {
    const { model, last } = harness({
      maxAttempts: 1,
      deadLetter: {
        exchange: "x.dlx",
        rabbitmq: (a) => `parked.${a}`,
        kafka: (t) => `${t}-parked`,
      },
    });
    model.subscribe("d", rabbitSub);
    model.subscribe("d", kafkaSub);
    model.publish("p", { transport: "rabbitmq", address: "loom.A.Ch", body: "{}", key: null });
    expect(model.nack(last().deliveryId, "boom")).toMatchObject({
      outcome: "dead-lettered",
      parkedAt: "parked.loom.A.Ch",
    });
    model.publish("p", { transport: "kafka", address: "loom.A.Ch", body: "{}", key: null });
    expect(model.nack(last().deliveryId, "boom")).toMatchObject({ parkedAt: "loom.A.Ch-parked" });
    expect(model.inspect().rabbitmq.exchanges.map((e) => e.name)).toContain("x.dlx");
  });

  it("the emulation notes state the instance's own retention", () => {
    const { model, publish } = harness({ retainedPerPartition: 2 });
    for (let i = 0; i < 4; i++) publish("kafka", "loom.A.Ch");
    expect(model.inspect().kafka.topics[0]?.records.map((r) => r.offset)).toEqual([2, 3]);
    expect(model.inspect().emulated[0]?.note).toMatch(/last 2 records/);
    expect(BROKER_EMULATION_NOTES[0]?.note).toMatch(/last 10000 records/);
  });
});
