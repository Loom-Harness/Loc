// The broker service's protocol: the infra worker's twin of the redis /
// rabbitmq / kafka sidecars in `docker-compose.yml`.
//
// A deployable reaches it through its `InfraPort` (see `../infra-port.ts`)
// with the generated `ChannelTransport` calls translated one to one: publish,
// subscribe, and — per delivery — ack or nack.  The state (topics, queues,
// consumer groups, offsets, dead-letter queues) lives once, in the infra
// worker, so delivery to one member of a group, the kafka log and the
// dead-letter queues hold across deployables.
//
// Types only: the main thread and the deployable workers import this file.

/** The broker a binding rides — `ChannelBinding.transport` of the generated
 *  `CHANNEL_BINDINGS`. */
export type BrokerKind = "redis" | "rabbitmq" | "kafka";

export interface BrokerPublishParams {
  transport: BrokerKind;
  address: string;
  /** The CloudEvents envelope as the driver puts it on the wire (JSON text). */
  body: string;
  /** Kafka's partition key: `loomkey` ?? envelope id. */
  key: string | null;
}

export interface BrokerSubscribeParams {
  transport: BrokerKind;
  address: string;
  /** Null for broadcast; the deployable's consumer group otherwise. */
  group: string | null;
  /** Kafka only: a NEW group starts at the earliest offset. */
  fromBeginning: boolean;
}

export type BrokerOp =
  | { op: "publish"; params: BrokerPublishParams }
  | { op: "subscribe"; params: BrokerSubscribeParams }
  | { op: "unsubscribe"; params: { subId: string } }
  /** The handler resolved. */
  | { op: "ack"; params: { deliveryId: number } }
  /** The handler threw (or the body did not parse). */
  | { op: "nack"; params: { deliveryId: number; error: string; poison?: boolean } }
  | { op: "inspect"; params: Record<string, never> }
  /** Move a kafka group's committed offset (replay from an offset). */
  | { op: "seek"; params: BrokerSeekParams }
  /** Put a dead-letter queue's / topic's messages back on its address. */
  | { op: "redrive"; params: BrokerRedriveParams };

export interface BrokerSeekParams {
  topic: string;
  group: string;
  /** Every partition when absent. */
  partition?: number;
  /** Clamped to the retained range: 0 is the earliest retained record. */
  offset: number;
}

export interface BrokerSeekResult {
  /** The partitions moved. */
  partitions: number[];
}

export interface BrokerRedriveParams {
  transport: "rabbitmq" | "kafka";
  /** `loom.dlq.<address>` (rabbitmq) or `<topic>.dlq` (kafka). */
  deadLetter: string;
}

export interface BrokerRedriveResult {
  /** Messages put back on the address. */
  moved: number;
}

export interface BrokerSubscribeResult {
  subId: string;
}

/** What a nack did with the message — the facade logs it the way the
 *  generated driver would. */
export interface BrokerNackResult {
  outcome: "dropped" | "retried" | "dead-lettered";
  /** Delivery attempts so far (rabbitmq's `x-loom-attempts`). */
  attempts: number;
  /** Where a dead-lettered message was parked. */
  parkedAt?: string;
}

/** Pushed to the subscribing deployable, one per delivery.  Every delivery
 *  is answered with `ack` or `nack`; until then a rabbitmq consumer holds
 *  its one prefetch slot and a kafka partition does not advance. */
export interface BrokerDelivery {
  push: "broker";
  subId: string;
  deliveryId: number;
  body: string;
  /** 1 on first delivery. */
  attempts: number;
  redelivered: boolean;
}

// -- inspection (Events panel, tests) ----------------------------------------

export interface BrokerInspectMessage {
  /** The envelope id (or `?` for a body that does not parse). */
  id: string;
  type: string;
  attempts: number;
  /** The envelope as it is on the wire. */
  body: string;
}

/** A retained kafka record, as inspect lists it. */
export interface BrokerInspectRecord {
  partition: number;
  offset: number;
  key: string | null;
  id: string;
  type: string;
  body: string;
}

export interface BrokerInspectQueue {
  name: string;
  /** Messages waiting (not delivered yet). */
  ready: number;
  /** Delivered, awaiting ack. */
  unacked: number;
  consumers: number;
  messages: BrokerInspectMessage[];
}

export interface BrokerInspectGroup {
  group: string;
  members: string[];
  /** Committed offset per partition. */
  offsets: number[];
}

export interface BrokerInspectTopic {
  name: string;
  /** Records retained per partition (start offset … end offset). */
  partitions: { start: number; end: number }[];
  groups: BrokerInspectGroup[];
  /** The newest retained records of each partition (`INSPECT_TAIL`). */
  records: BrokerInspectRecord[];
}

export interface BrokerInspectChannel {
  name: string;
  subscribers: string[];
}

/** One line of the broker's journal: what happened to which envelope. */
export interface BrokerJournalEntry {
  seq: number;
  at: number;
  transport: BrokerKind;
  kind:
    | "published"
    | "delivered"
    | "acked"
    | "nacked"
    | "retried"
    | "dead-lettered"
    | "dropped"
    | "seeked"
    | "redriven";
  address: string;
  /** Envelope id. */
  id: string;
  type: string;
  /** The deployable that published or consumed. */
  client: string | null;
  /** Consumer group / queue, where one applies. */
  group?: string | null;
  error?: string;
}

export interface BrokerInspectResult {
  redis: { channels: BrokerInspectChannel[] };
  rabbitmq: { exchanges: { name: string; queues: string[] }[]; queues: BrokerInspectQueue[] };
  kafka: { topics: BrokerInspectTopic[] };
  journal: BrokerJournalEntry[];
  /** Where the emulation knowingly differs from the real broker — shown as
   *  "emulated" next to the state. */
  emulated: { transport: BrokerKind; note: string }[];
}

/** The production policy the model mirrors, kept beside the protocol so the
 *  facade and the model agree on one number: rabbitmq retries a failed
 *  delivery until its 5th attempt, then dead-letters it — the generated
 *  driver's `CHANNEL_MAX_ATTEMPTS`. */
export const RABBIT_MAX_ATTEMPTS = 5;

/** The generated kafka driver's partition count (`createTopics` with the
 *  broker defaults the compose sidecar sets: 3 partitions). */
export const KAFKA_PARTITIONS = 3;
