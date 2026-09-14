// Auto-generated.
// Broker transport for the deployable's wired channels (channels.md).
// CloudEvents 1.0 envelopes between deployables;
// the consumer loop feeds received events into the same in-process
// dispatcher local reactors use.
import { Redis } from "ioredis";
import type { DomainEvent, DomainEventDispatcher } from "../domain/events.ts";
import { baseLogger } from "../obs/log.ts";

/** CloudEvents 1.0 JSON envelope — the cross-backend wire contract
 * (loom envelope pin, src/util/channels.ts).  `id` doubles as the
 * consumer-side idempotency key: relay-published (durable) events carry
 * their outbox row id, so saga markers dedup broker redeliveries. */
export interface LoomEventEnvelope {
  specversion: "1.0";
  id: string;
  type: string;
  source: string;
  time: string;
  datacontenttype: "application/json";
  loomchannel: string;
  data: Record<string, unknown>;
}

/** The publish/subscribe seam every transport implements — in-process,
 * the broker drivers, and the realtime relay all sit on this
 * interface.  `group` is null for broadcast (every subscriber sees every
 * envelope); a group name makes replicas competing consumers.
 *
 * `subscribe` resolves only once the broker has ACKNOWLEDGED the
 * subscription, which is what lets boot block until the consumer is
 * actually listening.  It cannot return the unsubscribe handle
 * synchronously: an envelope published between `serve()` and the
 * broker ack is dropped outright on an ephemeral pub/sub channel, and
 * no consumer-side timeout can recover it. */
export interface ChannelTransport {
  publish(address: string, envelope: LoomEventEnvelope): Promise<void>;
  subscribe(
    address: string,
    group: string | null,
    handler: (envelope: LoomEventEnvelope) => Promise<void>,
  ): Promise<() => void>;
  close(): Promise<void>;
}

/** Redis (Valkey) driver — pub/sub over ioredis.  A dedicated
 * subscriber connection is required by the redis protocol (a
 * connection in subscribe mode can't publish). */
export function createRedisTransport(url: string): ChannelTransport {
  const pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  const sub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  const handlers = new Map<string, Set<(e: LoomEventEnvelope) => Promise<void>>>();
  sub.on("message", (address: string, message: string) => {
    const set = handlers.get(address);
    if (!set) return;
    let envelope: LoomEventEnvelope;
    try {
      envelope = JSON.parse(message) as LoomEventEnvelope;
    } catch {
      baseLogger.warn({ event: "channel_consume_failed", address, error: "malformed envelope" });
      return;
    }
    for (const h of set) {
      void h(envelope).catch((err) => {
        baseLogger.warn({
          event: "channel_consume_failed",
          address,
          type: envelope.type,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });
  return {
    async publish(address, envelope) {
      await pub.publish(address, JSON.stringify(envelope));
    },
    async subscribe(address, _group, handler) {
      let set = handlers.get(address);
      if (!set) {
        set = new Set();
        handlers.set(address, set);
        await sub.subscribe(address);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
        if (set.size === 0) {
          handlers.delete(address);
          void sub.unsubscribe(address);
        }
      };
    },
    async close() {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    },
  };
}

// The deployable's wired bindings: broker address + consumer group per
// channelSource, with the connection URL injected by compose/k8s as
// LOOM_CHANNEL_<NAME>_URL.
export const CHANNEL_BINDINGS = [
  { csName: "woBus", address: "loom.Field.WorkOrderEvents", envVar: "LOOM_CHANNEL_WO_BUS_URL", context: "Field", transport: "redis", group: "loom.Field.WorkOrderEvents.api", queue: false },
] as const;

// event type -> broker address.  Ephemeral events publish inline in the
// tee; durable (`work`) events pass through to the outbox and publish on
// relay drain (design §5).
export const CHANNEL_ROUTING: Record<string, string> = {
  WorkOrderCompleted: "loom.Field.WorkOrderEvents",
};

export const DURABLE_CHANNEL_ROUTING: Record<string, string> = {
};

let counter = 0;
function envelopeFor(event: DomainEvent, address: string): LoomEventEnvelope {
  const { type, __loomEventId, ...data } = event as unknown as {
    type: string;
    __loomEventId?: string;
  } & Record<string, unknown>;
  const context = CHANNEL_BINDINGS.find((b) => b.address === address)?.context ?? "";
  counter += 1;
  return {
    specversion: "1.0",
    // Relay-published events reuse their outbox row id — the stable
    // consumer-side idempotency key across broker redeliveries.
    id: __loomEventId ?? `${Date.now().toString(36)}-${process.pid.toString(36)}-${counter.toString(36)}`,
    type: `${context}.${type}`,
    source: `/loom/${context}`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    loomchannel: address,
    data,
  };
}

/** One shared transport per broker URL for the process (publisher tee +
 * consumer loop reuse the same connections). */
export function createChannelTransports(): Map<string, ChannelTransport> {
  const byUrl = new Map<string, ChannelTransport>();
  const byEnv = new Map<string, ChannelTransport>();
  for (const b of CHANNEL_BINDINGS) {
    const url = process.env[b.envVar];
    if (!url) {
      throw new Error(
        `channel binding '${b.csName}' needs ${b.envVar} (the broker URL compose/k8s injects)`,
      );
    }
    let t = byUrl.get(url);
    if (!t) {
      t = createRedisTransport(url);
      byUrl.set(url, t);
    }
    byEnv.set(b.csName, t);
  }
  return byEnv;
}

/** Close every distinct transport (producer-only shutdown; the consumer
 * loop's stop function closes them itself). */
export async function closeChannelTransports(
  transports: Map<string, ChannelTransport>,
): Promise<void> {
  await Promise.allSettled([...new Set(transports.values())].map((t) => t.close()));
}

function transportForAddress(
  transports: Map<string, ChannelTransport>,
  address: string,
): ChannelTransport {
  const binding = CHANNEL_BINDINGS.find((b) => b.address === address);
  const t = binding ? transports.get(binding.csName) : undefined;
  if (!t) throw new Error(`no transport wired for channel address ${address}`);
  return t;
}

/** Producer tee — the delivery-uniformity rule (design §4): an event
 * carried by a broker-bound channel is PUBLISHED and not fanned out
 * locally; co-located consumers receive it through their subscription
 * exactly like remote ones.
 *
 * Two modes (design §5): on the request path (default) ephemeral events
 * publish inline while durable events pass to `inner` (the outbox
 * dispatcher captures them in the write tx); in relay mode the drained
 * durable rows publish here instead of re-entering the local chain. */
export function channelPublishTee(
  transports: Map<string, ChannelTransport>,
  inner: DomainEventDispatcher,
  opts: { fromRelay?: boolean } = {},
): DomainEventDispatcher {
  return {
    async dispatch(event: DomainEvent): Promise<void> {
      const durableAddress = DURABLE_CHANNEL_ROUTING[event.type];
      if (durableAddress) {
        if (!opts.fromRelay) return inner.dispatch(event); // outbox captures; relay publishes
        const envelope = envelopeFor(event, durableAddress);
        await transportForAddress(transports, durableAddress).publish(durableAddress, envelope);
        baseLogger.info({ event: "channel_published", address: durableAddress, type: event.type, id: envelope.id });
        return;
      }
      const address = CHANNEL_ROUTING[event.type];
      if (!address) return inner.dispatch(event);
      const envelope = envelopeFor(event, address);
      await transportForAddress(transports, address).publish(address, envelope);
      baseLogger.info({ event: "channel_published", address, type: event.type, id: envelope.id });
    },
    // The write-tx outbox capture passes straight through: the repository
    // calls it inside its save transaction and the outbox dispatcher
    // underneath writes the row on that tx handle (design §1).  Dropping it
    // here would silently demote the durable path back to a second,
    // post-commit transaction.
    recordDurable: inner.recordDurable?.bind(inner),
  };
}

/** Consumer loop — subscribes every wired address (competing-consumer
 * group on `queue` channels, broadcast otherwise) and dispatches received
 * envelopes into the given (in-process) dispatcher, so reactors and
 * event-triggered creates run identically for local and remote events.
 * The envelope id rides along as the idempotency marker.
 *
 * Awaited, not fired-and-forgotten: it resolves once every binding is
 * subscribed, so the caller can hold `serve()` — and therefore /ready —
 * until the consumer is genuinely listening. */
export async function startChannelConsumers(
  transports: Map<string, ChannelTransport>,
  dispatcher: DomainEventDispatcher,
): Promise<() => Promise<void>> {
  const unsubs: Array<() => void> = [];
  for (const b of CHANNEL_BINDINGS) {
    const t = transports.get(b.csName);
    if (!t) continue;
    unsubs.push(
      await t.subscribe(b.address, b.queue ? b.group : null, async (envelope) => {
        const bare = envelope.type.includes(".") ? envelope.type.slice(envelope.type.indexOf(".") + 1) : envelope.type;
        const event = {
          type: bare,
          ...envelope.data,
          __loomEventId: envelope.id,
        } as unknown as DomainEvent;
        await dispatcher.dispatch(event);
        baseLogger.info({
          event: "channel_consumed",
          address: b.address,
          type: envelope.type,
          id: envelope.id,
        });
      }),
    );
  }
  return async () => {
    for (const u of unsubs) u();
    await Promise.allSettled([...new Set(transports.values())].map((t) => t.close()));
  };
}
