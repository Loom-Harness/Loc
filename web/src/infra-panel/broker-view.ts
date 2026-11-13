// Pure shaping for the Broker tab: which addresses a test message can go to,
// what a dead-letter queue / topic is, consumer lag, and the CloudEvents
// envelope a test publish carries (the generated `LoomEventEnvelope`).

import type {
  BrokerInspectResult,
  BrokerInspectTopic,
  BrokerKind,
  BrokerPublishParams,
} from "../runtime/infra/broker-protocol";

export interface BrokerAddress {
  transport: BrokerKind;
  address: string;
}

const RABBIT_DLX = "loom.dlx";
const RABBIT_DLQ = "loom.dlq.";
const KAFKA_DLQ = ".dlq";

/** The address a rabbitmq dead-letter queue / kafka dead-letter topic parks
 *  messages for; null for every other queue / topic. */
export function deadLetterOf(transport: "rabbitmq" | "kafka", name: string): string | null {
  if (transport === "rabbitmq") return name.startsWith(RABBIT_DLQ) ? name.slice(RABBIT_DLQ.length) : null;
  return name.endsWith(KAFKA_DLQ) ? name.slice(0, -KAFKA_DLQ.length) : null;
}

/** Every address a deployable publishes or subscribes on, per transport —
 *  the broker plumbing (DLX, dead-letter queues and topics) left out. */
export function brokerAddresses(state: BrokerInspectResult): BrokerAddress[] {
  const out: BrokerAddress[] = [];
  const seen = new Set<string>();
  const add = (transport: BrokerKind, address: string): void => {
    const k = `${transport} ${address}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ transport, address });
  };
  for (const c of state.redis.channels) add("redis", c.name);
  for (const e of state.rabbitmq.exchanges) if (e.name !== RABBIT_DLX) add("rabbitmq", e.name);
  for (const t of state.kafka.topics) if (deadLetterOf("kafka", t.name) === null) add("kafka", t.name);
  for (const j of state.journal) {
    if (j.transport === "kafka" && deadLetterOf("kafka", j.address) !== null) continue;
    add(j.transport, j.address);
  }
  return out;
}

/** Records a group has yet to consume, per partition. */
export function groupLag(topic: BrokerInspectTopic, offsets: readonly number[]): number[] {
  return topic.partitions.map((p, i) => Math.max(0, p.end - Math.max(offsets[i] ?? 0, p.start)));
}

/** The CloudEvent type most recently seen on `address` — a test message's
 *  default type, so the consumer's handler recognises it. */
export function lastTypeOn(state: BrokerInspectResult, address: string): string | null {
  for (let i = state.journal.length - 1; i >= 0; i--) {
    const j = state.journal[i];
    if (j && j.address === address && j.type !== "?") return j.type;
  }
  return null;
}

/** A test message, enveloped the way the generated `envelope()` does it. */
export function testPublish(
  target: BrokerAddress,
  type: string,
  data: unknown,
  id: string,
  now: Date,
  key: string | null = null,
): BrokerPublishParams {
  const context = type.includes(".") ? type.slice(0, type.indexOf(".")) : "";
  const envelope = {
    specversion: "1.0",
    id,
    type,
    source: `/loom/${context}`,
    time: now.toISOString(),
    datacontenttype: "application/json",
    loomchannel: target.address,
    ...(key === null ? {} : { loomkey: key }),
    data,
  };
  return { transport: target.transport, address: target.address, body: JSON.stringify(envelope), key: key ?? id };
}
