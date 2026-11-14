// The playground's message broker: one state, three broker behaviours.
//
// Every deployable's `ChannelTransport` talks to one model per host (the
// playground's infra worker holds one), so the state a real broker owns is
// owned once here too:
//
//   redis     pub/sub — every subscriber of the address gets every message
//             while it is subscribed; nothing is kept, acknowledged or
//             dead-lettered (a failed handler only logs).
//   rabbitmq  a fanout exchange per address; one queue per consumer group
//             (the generated driver names the queue after the group), bound
//             to the exchange.  A queue keeps its messages while no consumer
//             is attached.  Consumers of one queue compete, round-robin, with
//             one unacknowledged message each (`prefetch(1)`).  A nack is
//             retried until its RABBIT_MAX_ATTEMPTS-th delivery and then
//             dead-lettered through `loom.dlx` into `loom.dlq.<address>`.
//   kafka     a topic per address with KAFKA_PARTITIONS partitions (record →
//             partition by key); a consumer group owns one committed offset
//             per partition and its members split the partitions.  A NEW
//             group starts at the earliest retained offset when the binding
//             says `fromBeginning`, at the end otherwise; a group that has
//             committed resumes where it stopped.  A partition delivers one
//             record at a time and advances on ack; a nack parks the record
//             on `<address>.dlq` and advances (the generated driver's v1).
//
// Pure: no worker or Node globals.  The playground's infra worker wires `send`
// to the client's port; tests drive the model directly.

import {
  type BrokerDelivery,
  type BrokerInspectResult,
  type BrokerJournalEntry,
  type BrokerKind,
  type BrokerNackResult,
  type BrokerPublishParams,
  type BrokerRedriveParams,
  type BrokerSeekParams,
  type BrokerSubscribeParams,
  KAFKA_PARTITIONS,
  RABBIT_MAX_ATTEMPTS,
} from "./broker-protocol.js";

/** Records retained per kafka partition before the oldest is dropped. */
export const KAFKA_RETAINED_PER_PARTITION = 10_000;
const JOURNAL_SIZE = 1_000;
const INSPECT_TAIL = 50;

/** What the emulation knowingly does differently from the real brokers, for
 *  a model that keeps `retained` records per kafka partition. */
function emulationNotes(retained: number): BrokerInspectResult["emulated"] {
  return [
    {
      transport: "kafka",
      note: `retention keeps the last ${retained} records per partition (no time- or size-based retention)`,
    },
    ...FIXED_NOTES,
  ];
}

const FIXED_NOTES: BrokerInspectResult["emulated"] = [
  {
    transport: "kafka",
    note: "an offset reset (seek) is refused only while a moved partition has a delivery in flight; the real broker refuses it while the group has any active member",
  },
  {
    transport: "kafka",
    note: "partition by a stable string hash of the key, not kafkajs's murmur2 partitioner",
  },
  { transport: "kafka", note: "a topic is created on its first publish or subscribe" },
  {
    transport: "rabbitmq",
    note: "queues and messages live in memory: a Reset or a reload loses them (no disk persistence)",
  },
  {
    transport: "redis",
    note: "no connection loss: a subscriber never misses a message while subscribed",
  },
];

export const BROKER_EMULATION_NOTES: BrokerInspectResult["emulated"] = emulationNotes(
  KAFKA_RETAINED_PER_PARTITION,
);

interface Sub {
  id: string;
  client: string;
  transport: BrokerKind;
  address: string;
  /** rabbitmq queue / kafka group the subscription consumes from. */
  group: string | null;
}

interface Envelope {
  id: string;
  type: string;
}

function peek(body: string): Envelope {
  try {
    const parsed = JSON.parse(body) as { id?: unknown; type?: unknown };
    return {
      id: typeof parsed.id === "string" ? parsed.id : "?",
      type: typeof parsed.type === "string" ? parsed.type : "?",
    };
  } catch {
    return { id: "?", type: "?" };
  }
}

// -- rabbitmq ----------------------------------------------------------------

interface RabbitMessage {
  body: string;
  /** The attempt number of the message's next delivery (x-loom-attempts + 1). */
  attempts: number;
  redelivered: boolean;
}

interface RabbitQueue {
  name: string;
  /** The address its dead letters are routed with (the DLX routing key). */
  address: string;
  ready: RabbitMessage[];
  /** deliveryId → message, per consumer. */
  unacked: Map<number, { sub: string; msg: RabbitMessage }>;
  consumers: string[];
  turn: number;
}

// -- kafka -------------------------------------------------------------------

interface KafkaRecord {
  offset: number;
  key: string | null;
  body: string;
}

interface KafkaPartition {
  /** The first retained offset. */
  start: number;
  records: KafkaRecord[];
}

interface KafkaGroup {
  name: string;
  members: string[];
  /** Next offset to consume, per partition. */
  committed: number[];
  /** The delivery in flight per partition. */
  inflight: (number | null)[];
}

interface KafkaTopic {
  name: string;
  partitions: KafkaPartition[];
  groups: Map<string, KafkaGroup>;
}

type Inflight =
  | { transport: "redis"; sub: string; address: string; body: string }
  | { transport: "rabbitmq"; sub: string; queue: string }
  | {
      transport: "kafka";
      sub: string;
      topic: string;
      group: string;
      partition: number;
      offset: number;
    };

/** A stable 32-bit string hash (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface BrokerModelOptions {
  /** Hand a delivery to the subscribing client. */
  send: (client: string, delivery: BrokerDelivery) => void;
  /** Defer a delivery off the publisher's call (as a broker does).  Tests may
   *  pass a synchronous scheduler. */
  schedule?: (fn: () => void) => void;
  now?: () => number;
  /** rabbitmq: the delivery attempt after which a failed message is
   *  dead-lettered.  Default RABBIT_MAX_ATTEMPTS. */
  maxAttempts?: number;
  /** kafka: records kept per partition.  Default KAFKA_RETAINED_PER_PARTITION. */
  retainedPerPartition?: number;
  /** Journal lines kept.  Default 1000. */
  journalSize?: number;
  /** kafka: the newest records per partition `inspect()` returns.  Default 50. */
  inspectTail?: number;
  /** Where a dead letter is parked: rabbitmq's queue and the exchange that
   *  routes to it, and kafka's topic.  Defaults are the generated drivers'
   *  names. */
  deadLetter?: {
    exchange?: string;
    rabbitmq?: (address: string) => string;
    kafka?: (topic: string) => string;
  };
}

export class BrokerModel {
  private readonly send: BrokerModelOptions["send"];
  private readonly schedule: (fn: () => void) => void;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly retained: number;
  private readonly journalSize: number;
  private readonly inspectTail: number;
  private readonly dlx: string;
  private readonly rabbitDlq: (address: string) => string;
  private readonly kafkaDlq: (topic: string) => string;

  private nextSub = 1;
  private nextDelivery = 1;
  private seq = 0;
  private readonly subs = new Map<string, Sub>();
  private readonly inflight = new Map<number, Inflight>();
  private readonly journal: BrokerJournalEntry[] = [];

  private readonly redisChannels = new Map<string, Set<string>>();
  /** Exchange (= address) → bound queue names. */
  private readonly exchanges = new Map<string, Set<string>>();
  private readonly queues = new Map<string, RabbitQueue>();
  private readonly topics = new Map<string, KafkaTopic>();

  constructor(opts: BrokerModelOptions) {
    this.send = opts.send;
    this.schedule = opts.schedule ?? ((fn) => setTimeout(fn, 0));
    this.now = opts.now ?? (() => Date.now());
    this.maxAttempts = opts.maxAttempts ?? RABBIT_MAX_ATTEMPTS;
    this.retained = opts.retainedPerPartition ?? KAFKA_RETAINED_PER_PARTITION;
    this.journalSize = opts.journalSize ?? JOURNAL_SIZE;
    this.inspectTail = opts.inspectTail ?? INSPECT_TAIL;
    this.dlx = opts.deadLetter?.exchange ?? "loom.dlx";
    this.rabbitDlq = opts.deadLetter?.rabbitmq ?? ((address) => `loom.dlq.${address}`);
    this.kafkaDlq = opts.deadLetter?.kafka ?? ((topic) => `${topic}.dlq`);
  }

  // -- public surface --------------------------------------------------------

  publish(client: string | null, p: BrokerPublishParams): void {
    const env = peek(p.body);
    this.record({ transport: p.transport, kind: "published", address: p.address, ...env, client });
    switch (p.transport) {
      case "redis":
        for (const subId of this.redisChannels.get(p.address) ?? []) {
          const sub = this.subs.get(subId);
          if (!sub) continue;
          const deliveryId = this.nextDelivery++;
          this.inflight.set(deliveryId, {
            transport: "redis",
            sub: subId,
            address: p.address,
            body: p.body,
          });
          this.deliver(sub, deliveryId, p.body, 1, false, null);
        }
        return;
      case "rabbitmq": {
        // The driver asserts the exchange before publishing; a message to an
        // exchange with no bound queue is dropped, as on the real broker.
        const bound = this.exchange(p.address);
        for (const name of bound) {
          const q = this.queues.get(name);
          if (!q) continue;
          q.ready.push({ body: p.body, attempts: 1, redelivered: false });
          this.pumpQueue(q);
        }
        return;
      }
      case "kafka":
        this.append(p.address, p.key, p.body);
        return;
    }
  }

  subscribe(client: string, p: BrokerSubscribeParams): string {
    const id = `sub-${this.nextSub++}`;
    switch (p.transport) {
      case "redis": {
        this.subs.set(id, { id, client, transport: "redis", address: p.address, group: null });
        const set = this.redisChannels.get(p.address) ?? new Set<string>();
        set.add(id);
        this.redisChannels.set(p.address, set);
        return id;
      }
      case "rabbitmq": {
        // The generated driver's topology: the queue IS the consumer group.
        const queueName = p.group ?? p.address;
        this.exchange(p.address);
        this.exchange(this.dlx);
        const dlq = this.assertQueue(this.rabbitDlq(p.address), p.address);
        this.exchange(this.dlx).add(dlq.name);
        const q = this.assertQueue(queueName, p.address);
        this.exchange(p.address).add(q.name);
        this.subs.set(id, {
          id,
          client,
          transport: "rabbitmq",
          address: p.address,
          group: queueName,
        });
        q.consumers.push(id);
        this.pumpQueue(q);
        return id;
      }
      case "kafka": {
        const groupName = p.group ?? p.address;
        const topic = this.topic(p.address);
        let group = topic.groups.get(groupName);
        if (!group) {
          // A new group picks its start point once; afterwards it resumes
          // from what it committed.
          group = {
            name: groupName,
            members: [],
            committed: topic.partitions.map((part) =>
              p.fromBeginning ? part.start : part.start + part.records.length,
            ),
            inflight: topic.partitions.map(() => null),
          };
          topic.groups.set(groupName, group);
        }
        this.subs.set(id, { id, client, transport: "kafka", address: p.address, group: groupName });
        group.members.push(id);
        this.rebalance(topic, group);
        return id;
      }
    }
  }

  unsubscribe(subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    this.subs.delete(subId);
    switch (sub.transport) {
      case "redis":
        this.redisChannels.get(sub.address)?.delete(subId);
        for (const [id, f] of this.inflight) if (f.sub === subId) this.inflight.delete(id);
        return;
      case "rabbitmq": {
        const q = this.queues.get(sub.group ?? "");
        if (!q) return;
        q.consumers = q.consumers.filter((c) => c !== subId);
        // A closed consumer's unacknowledged messages go back to the queue's
        // head, flagged redelivered — the queue itself stays (durable).
        const back: RabbitMessage[] = [];
        for (const [deliveryId, u] of q.unacked) {
          if (u.sub !== subId) continue;
          q.unacked.delete(deliveryId);
          this.inflight.delete(deliveryId);
          back.push({ ...u.msg, redelivered: true });
        }
        q.ready.unshift(...back);
        this.pumpQueue(q);
        return;
      }
      case "kafka": {
        const topic = this.topics.get(sub.address);
        const group = topic?.groups.get(sub.group ?? "");
        if (!topic || !group) return;
        group.members = group.members.filter((m) => m !== subId);
        // Uncommitted records of the leaving member are redelivered to the
        // partition's next owner; the group and its offsets stay.
        group.inflight = group.inflight.map((d) => {
          if (d === null) return null;
          const f = this.inflight.get(d);
          if (f?.sub !== subId) return d;
          this.inflight.delete(d);
          return null;
        });
        this.rebalance(topic, group);
        return;
      }
    }
  }

  /** Drop every subscription of a client (its deployable stopped). */
  disconnect(client: string): void {
    for (const sub of [...this.subs.values()]) if (sub.client === client) this.unsubscribe(sub.id);
  }

  ack(deliveryId: number): void {
    const f = this.inflight.get(deliveryId);
    if (!f) return;
    this.inflight.delete(deliveryId);
    const sub = this.subs.get(f.sub);
    switch (f.transport) {
      case "redis":
        this.record({
          transport: "redis",
          kind: "acked",
          address: f.address,
          ...peek(f.body),
          client: sub?.client ?? null,
        });
        return;
      case "rabbitmq": {
        const q = this.queues.get(f.queue);
        const u = q?.unacked.get(deliveryId);
        if (!q || !u) return;
        q.unacked.delete(deliveryId);
        this.record({
          transport: "rabbitmq",
          kind: "acked",
          address: q.address,
          ...peek(u.msg.body),
          client: sub?.client ?? null,
          group: q.name,
        });
        this.pumpQueue(q);
        return;
      }
      case "kafka": {
        const topic = this.topics.get(f.topic);
        const group = topic?.groups.get(f.group);
        if (!topic || !group || group.inflight[f.partition] !== deliveryId) return;
        const rec = this.recordAt(topic, f.partition, f.offset);
        group.inflight[f.partition] = null;
        group.committed[f.partition] = f.offset + 1;
        if (rec) {
          this.record({
            transport: "kafka",
            kind: "acked",
            address: topic.name,
            ...peek(rec.body),
            client: sub?.client ?? null,
            group: group.name,
          });
        }
        this.pumpGroup(topic, group);
        return;
      }
    }
  }

  /** The handler failed.  `poison`: the body never parsed, so no retry can
   *  help (the drivers park such a message at once). */
  nack(deliveryId: number, error: string, poison = false): BrokerNackResult {
    const f = this.inflight.get(deliveryId);
    if (!f) return { outcome: "dropped", attempts: 0 };
    this.inflight.delete(deliveryId);
    const sub = this.subs.get(f.sub);
    const client = sub?.client ?? null;
    switch (f.transport) {
      case "redis":
        // Fire-and-forget: the subscriber logged it; the message is gone.
        this.record({
          transport: "redis",
          kind: "dropped",
          address: f.address,
          ...peek(f.body),
          client,
          error,
        });
        return { outcome: "dropped", attempts: 1 };
      case "rabbitmq": {
        const q = this.queues.get(f.queue);
        const u = q?.unacked.get(deliveryId);
        if (!q || !u) return { outcome: "dropped", attempts: 0 };
        q.unacked.delete(deliveryId);
        const env = peek(u.msg.body);
        const attempts = u.msg.attempts;
        if (!poison && attempts < this.maxAttempts) {
          // The driver republishes to the queue's tail with the attempt
          // header bumped, then acks the original.
          q.ready.push({ body: u.msg.body, attempts: attempts + 1, redelivered: false });
          this.record({
            transport: "rabbitmq",
            kind: "retried",
            address: q.address,
            ...env,
            client,
            group: q.name,
            error,
          });
          this.pumpQueue(q);
          return { outcome: "retried", attempts };
        }
        // nack without requeue → the queue's DLX `loom.dlx`, routing key
        // = the address → `loom.dlq.<address>`.
        const dlq = this.assertQueue(this.rabbitDlq(q.address), q.address);
        dlq.ready.push({ body: u.msg.body, attempts, redelivered: false });
        this.record({
          transport: "rabbitmq",
          kind: "dead-lettered",
          address: q.address,
          ...env,
          client,
          group: q.name,
          error,
        });
        this.pumpQueue(q);
        this.pumpQueue(dlq);
        return { outcome: "dead-lettered", attempts, parkedAt: dlq.name };
      }
      case "kafka": {
        const topic = this.topics.get(f.topic);
        const group = topic?.groups.get(f.group);
        if (!topic || !group || group.inflight[f.partition] !== deliveryId) {
          return { outcome: "dropped", attempts: 0 };
        }
        const rec = this.recordAt(topic, f.partition, f.offset);
        // v1 dead letter: park onto `<address>.dlq` and advance, so the
        // partition keeps moving.
        const parkedAt = this.kafkaDlq(topic.name);
        if (rec) this.append(parkedAt, rec.key, rec.body, false);
        group.inflight[f.partition] = null;
        group.committed[f.partition] = f.offset + 1;
        this.record({
          transport: "kafka",
          kind: "dead-lettered",
          address: topic.name,
          ...peek(rec?.body ?? ""),
          client,
          group: group.name,
          error,
        });
        this.pumpGroup(topic, group);
        return { outcome: "dead-lettered", attempts: 1, parkedAt };
      }
    }
  }

  reset(): void {
    this.subs.clear();
    this.inflight.clear();
    this.journal.length = 0;
    this.redisChannels.clear();
    this.exchanges.clear();
    this.queues.clear();
    this.topics.clear();
  }

  inspect(): BrokerInspectResult {
    const clientOf = (subId: string): string => this.subs.get(subId)?.client ?? subId;
    return {
      redis: {
        channels: [...this.redisChannels].map(([name, set]) => ({
          name,
          subscribers: [...set].map(clientOf),
        })),
      },
      rabbitmq: {
        exchanges: [...this.exchanges].map(([name, queues]) => ({ name, queues: [...queues] })),
        queues: [...this.queues.values()].map((q) => ({
          name: q.name,
          ready: q.ready.length,
          unacked: q.unacked.size,
          consumers: q.consumers.length,
          messages: [...q.ready, ...[...q.unacked.values()].map((u) => u.msg)].map((m) => ({
            ...peek(m.body),
            attempts: m.attempts,
            body: m.body,
          })),
        })),
      },
      kafka: {
        topics: [...this.topics.values()].map((t) => ({
          name: t.name,
          partitions: t.partitions.map((p) => ({
            start: p.start,
            end: p.start + p.records.length,
          })),
          groups: [...t.groups.values()].map((g) => ({
            group: g.name,
            members: g.members.map(clientOf),
            offsets: [...g.committed],
          })),
          records: t.partitions.flatMap((p, partition) =>
            p.records.slice(-this.inspectTail).map((r) => ({
              partition,
              offset: r.offset,
              key: r.key,
              ...peek(r.body),
              body: r.body,
            })),
          ),
        })),
      },
      journal: [...this.journal],
      emulated: emulationNotes(this.retained),
    };
  }

  /** Move a kafka consumer group's committed offset — on one partition, or on
   *  every partition — clamped to what is retained, then resume delivery from
   *  there.  Refused while a moved partition has a delivery in flight: a real
   *  group's offsets can only be reset while it is not consuming them. */
  seek(p: BrokerSeekParams): { partitions: number[] } {
    const topic = this.topics.get(p.topic);
    const group = topic?.groups.get(p.group);
    if (!topic || !group) throw new Error(`no consumer group '${p.group}' on topic '${p.topic}'`);
    const partitions =
      p.partition === undefined ? topic.partitions.map((_, i) => i) : [p.partition];
    for (const i of partitions) {
      if (!topic.partitions[i]) throw new Error(`topic '${p.topic}' has no partition ${i}`);
      if (group.inflight[i] !== null) {
        throw new Error(`partition ${i} of '${p.topic}' has a delivery in flight for '${p.group}'`);
      }
    }
    for (const i of partitions) {
      const part = topic.partitions[i] as KafkaPartition;
      const offset = Math.min(Math.max(p.offset, part.start), part.start + part.records.length);
      group.committed[i] = offset;
      this.record({
        transport: "kafka",
        kind: "seeked",
        address: topic.name,
        id: String(offset),
        type: `partition ${i}`,
        client: null,
        group: group.name,
      });
    }
    this.pumpGroup(topic, group);
    return { partitions };
  }

  /** Send every parked dead letter back where it failed: a rabbitmq DLQ's
   *  ready messages to the queues bound to its address (attempts start over),
   *  a kafka `.dlq` topic's retained records onto the topic it names (the
   *  `.dlq` topic is emptied). */
  redrive(p: BrokerRedriveParams): { moved: number } {
    if (p.transport === "rabbitmq") {
      const dlq = this.queues.get(p.deadLetter);
      if (!dlq) throw new Error(`no dead-letter queue '${p.deadLetter}'`);
      const messages = dlq.ready.splice(0);
      const targets = [...this.exchange(dlq.address)]
        .filter((name) => name !== dlq.name)
        .map((name) => this.queues.get(name))
        .filter((q): q is RabbitQueue => q !== undefined);
      for (const m of messages) {
        this.record({
          transport: "rabbitmq",
          kind: "redriven",
          address: dlq.address,
          ...peek(m.body),
          client: null,
          group: dlq.name,
        });
        for (const q of targets) q.ready.push({ body: m.body, attempts: 1, redelivered: false });
      }
      for (const q of targets) this.pumpQueue(q);
      return { moved: messages.length };
    }
    const origin = [...this.topics.keys()].find((t) => this.kafkaDlq(t) === p.deadLetter);
    const dlq = this.topics.get(p.deadLetter);
    if (!origin || !dlq) throw new Error(`no dead-letter topic '${p.deadLetter}'`);
    let moved = 0;
    for (const part of dlq.partitions) {
      for (const r of part.records) {
        this.record({
          transport: "kafka",
          kind: "redriven",
          address: origin,
          ...peek(r.body),
          client: null,
          group: dlq.name,
        });
        this.append(origin, r.key, r.body);
        moved++;
      }
      part.start += part.records.length;
      part.records = [];
    }
    return { moved };
  }

  // -- internals -------------------------------------------------------------

  private record(e: Omit<BrokerJournalEntry, "seq" | "at">): void {
    this.journal.push({ seq: ++this.seq, at: this.now(), ...e });
    if (this.journal.length > this.journalSize)
      this.journal.splice(0, this.journal.length - this.journalSize);
  }

  private deliver(
    sub: Sub,
    deliveryId: number,
    body: string,
    attempts: number,
    redelivered: boolean,
    group: string | null,
  ): void {
    this.record({
      transport: sub.transport,
      kind: "delivered",
      address: sub.address,
      ...peek(body),
      client: sub.client,
      group,
    });
    const delivery: BrokerDelivery = {
      push: "broker",
      subId: sub.id,
      deliveryId,
      body,
      attempts,
      redelivered,
    };
    this.schedule(() => {
      // Delivered to a subscription that has since gone: nothing to do — its
      // in-flight state was already returned when it left.
      if (!this.subs.has(sub.id)) return;
      this.send(sub.client, delivery);
    });
  }

  private exchange(name: string): Set<string> {
    let ex = this.exchanges.get(name);
    if (!ex) {
      ex = new Set();
      this.exchanges.set(name, ex);
    }
    return ex;
  }

  private assertQueue(name: string, address: string): RabbitQueue {
    let q = this.queues.get(name);
    if (!q) {
      q = { name, address, ready: [], unacked: new Map(), consumers: [], turn: 0 };
      this.queues.set(name, q);
    }
    return q;
  }

  /** Hand ready messages to consumers with a free prefetch slot, round-robin. */
  private pumpQueue(q: RabbitQueue): void {
    while (q.ready.length > 0) {
      const busy = new Set([...q.unacked.values()].map((u) => u.sub));
      let picked: string | null = null;
      for (let i = 0; i < q.consumers.length; i++) {
        const c = q.consumers[(q.turn + i) % q.consumers.length] as string;
        if (!busy.has(c)) {
          picked = c;
          q.turn = (q.turn + i + 1) % q.consumers.length;
          break;
        }
      }
      const sub = picked ? this.subs.get(picked) : undefined;
      if (!sub) return;
      const msg = q.ready.shift() as RabbitMessage;
      const deliveryId = this.nextDelivery++;
      q.unacked.set(deliveryId, { sub: sub.id, msg });
      this.inflight.set(deliveryId, { transport: "rabbitmq", sub: sub.id, queue: q.name });
      this.deliver(sub, deliveryId, msg.body, msg.attempts, msg.redelivered, q.name);
    }
  }

  private topic(name: string): KafkaTopic {
    let t = this.topics.get(name);
    if (!t) {
      t = {
        name,
        partitions: Array.from({ length: KAFKA_PARTITIONS }, () => ({ start: 0, records: [] })),
        groups: new Map(),
      };
      this.topics.set(name, t);
    }
    return t;
  }

  private append(topicName: string, key: string | null, body: string, journal = true): void {
    const topic = this.topic(topicName);
    const index = (key === null ? hash(body) : hash(key)) % KAFKA_PARTITIONS;
    const part = topic.partitions[index] as KafkaPartition;
    part.records.push({ offset: part.start + part.records.length, key, body });
    if (part.records.length > this.retained) {
      part.records.shift();
      part.start++;
    }
    if (!journal) return;
    for (const group of topic.groups.values()) this.pumpGroup(topic, group);
  }

  private recordAt(topic: KafkaTopic, partition: number, offset: number): KafkaRecord | undefined {
    const part = topic.partitions[partition] as KafkaPartition;
    return part.records[offset - part.start];
  }

  /** Partition p belongs to member p mod n, in join order. */
  private owner(group: KafkaGroup, partition: number): string | undefined {
    return group.members.length === 0 ? undefined : group.members[partition % group.members.length];
  }

  private rebalance(topic: KafkaTopic, group: KafkaGroup): void {
    // An in-flight record whose partition moved to another member is
    // redelivered there: the old owner's ack would commit for a partition
    // it no longer holds, so it is dropped.
    group.inflight = group.inflight.map((d, p) => {
      if (d === null) return null;
      const f = this.inflight.get(d);
      if (f && f.sub === this.owner(group, p)) return d;
      this.inflight.delete(d);
      return null;
    });
    this.pumpGroup(topic, group);
  }

  private pumpGroup(topic: KafkaTopic, group: KafkaGroup): void {
    topic.partitions.forEach((part, p) => {
      if (group.inflight[p] !== null) return;
      const owner = this.owner(group, p);
      const sub = owner ? this.subs.get(owner) : undefined;
      if (!sub) return;
      // Records retention dropped are skipped, as a consumer whose offset
      // fell off the log resets to the earliest retained one.
      const offset = Math.max(group.committed[p] as number, part.start);
      group.committed[p] = offset;
      const rec = part.records[offset - part.start];
      if (!rec) return;
      const deliveryId = this.nextDelivery++;
      group.inflight[p] = deliveryId;
      this.inflight.set(deliveryId, {
        transport: "kafka",
        sub: sub.id,
        topic: topic.name,
        group: group.name,
        partition: p,
        offset,
      });
      this.deliver(sub, deliveryId, rec.body, 1, false, group.name);
    });
  }
}

/** A fresh broker — one per host (the playground keeps one; a Node test run one
 *  per case). */
export function createBroker(opts: BrokerModelOptions): BrokerModel {
  return new BrokerModel(opts);
}
